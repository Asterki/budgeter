/**
 * Reminder delivery endpoint — the only server-side piece of Tasker.
 *
 * Vercel Cron calls this every minute (`* * * * *`, see vercel.json):
 *
 *   GET /api/check-reminders
 *
 * The client also posts to the same URL whenever the task list changes:
 *
 *   POST /api/check-reminders   { subscription, reminders: [...] }
 *
 * Because Tasker is local-first the server has no database of its own; the
 * client mirrors just the push subscription and the upcoming reminders. The
 * mirror is stored in a KV REST store when one is configured, and in a warm
 * module-level map otherwise (fine for a single-user app on a warm instance).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import webpush from 'web-push';

/* ── Types ────────────────────────────────────────────────────────────────── */

interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface StoredReminder {
  id: string;
  taskId: string;
  title: string;
  body: string;
  /** Epoch ms at which the push should be delivered. */
  timestamp: number;
  /** Set once delivered so a reminder never fires twice. */
  sent?: boolean;
}

interface RequestLike extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[]>;
}

type ResponseLike = ServerResponse;

/* ── Storage ──────────────────────────────────────────────────────────────── */

const SUBSCRIPTION_KEY = 'tasker:subscription';
const REMINDERS_KEY = 'tasker:reminders';
const DELIVERED_KEY = 'tasker:delivered';

/**
 * Delivery window.
 *
 * Vercel Hobby only allows a once-per-day cron, while Pro allows every minute.
 * Rather than keeping two code paths, the tick delivers every reminder that has
 * come due since the previous tick:
 *
 *   - Pro / external per-minute trigger -> fires on the minute.
 *   - Hobby daily trigger               -> catches up the last 24 hours at once.
 *
 * FORWARD_SLACK absorbs cron drift; CATCH_UP is the maximum lateness we will
 * still notify about (older reminders are silently dropped as stale).
 */
const FORWARD_SLACK = 45_000;
const CATCH_UP = 24 * 60 * 60 * 1000;
/** How long delivered reminder ids are remembered, to prevent duplicates. */
const DELIVERED_RETENTION = 7 * 24 * 60 * 60 * 1000;

/** Fallback store used when no KV REST credentials are present. */
const memoryStore = new Map<string, string>();

function kvCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function storeGet(key: string): Promise<string | null> {
  const credentials = kvCredentials();
  if (!credentials) return memoryStore.get(key) ?? null;

  const response = await fetch(credentials.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(['GET', key]),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { result?: string | null };
  return data.result ?? null;
}

async function storeSet(key: string, value: string): Promise<void> {
  const credentials = kvCredentials();
  if (!credentials) {
    memoryStore.set(key, value);
    return;
  }

  await fetch(credentials.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(['SET', key, value]),
  });
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await storeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function sendJson(res: ResponseLike, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req: RequestLike): Promise<Record<string, unknown>> {
  // Vercel pre-parses JSON bodies; the local dev middleware does not.
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requestUrl(req: RequestLike): URL {
  const host = req.headers.host ?? 'localhost';
  return new URL(req.url ?? '/', `https://${host}`);
}

function isAuthorized(req: RequestLike, url: URL): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured -> open (single-user, local-first)
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${secret}` || url.searchParams.get('secret') === secret;
}

function isVapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureWebPush(): void {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
}

function normalizeSubscription(input: unknown): StoredSubscription | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof candidate.endpoint !== 'string') return null;
  return {
    endpoint: candidate.endpoint,
    keys: {
      p256dh: typeof candidate.keys?.p256dh === 'string' ? candidate.keys.p256dh : '',
      auth: typeof candidate.keys?.auth === 'string' ? candidate.keys.auth : '',
    },
  };
}

function normalizeReminders(input: unknown): StoredReminder[] {
  if (!Array.isArray(input)) return [];
  const now = Date.now();
  const reminders: StoredReminder[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<StoredReminder>;
    if (typeof candidate.timestamp !== 'number' || typeof candidate.title !== 'string') continue;
    // Ignore anything more than a day old or more than a year ahead.
    if (candidate.timestamp < now - 86_400_000 || candidate.timestamp > now + 365 * 86_400_000) continue;
    reminders.push({
      id: typeof candidate.id === 'string' ? candidate.id : `${candidate.timestamp}`,
      taskId: typeof candidate.taskId === 'string' ? candidate.taskId : `${candidate.timestamp}`,
      title: candidate.title,
      body: typeof candidate.body === 'string' ? candidate.body : 'Tasker reminder',
      timestamp: candidate.timestamp,
      sent: false,
    });
  }

  return reminders.sort((a, b) => a.timestamp - b.timestamp).slice(0, 200);
}

/* ── Handlers ─────────────────────────────────────────────────────────────── */

/** Client sync: remember the subscription and the upcoming reminders. */
async function handleSync(req: RequestLike, res: ResponseLike): Promise<void> {
  const body = await readBody(req);
  const subscription = normalizeSubscription(body.subscription);
  const hasReminders = Array.isArray(body.reminders);
  const reminders = hasReminders ? normalizeReminders(body.reminders) : [];

  if (subscription) {
    await storeSet(SUBSCRIPTION_KEY, JSON.stringify(subscription));
  }
  // A subscription-only update (e.g. from pushsubscriptionchange) must not
  // clear the reminder mirror, so only write it when the client sent one.
  if (hasReminders) {
    await storeSet(REMINDERS_KEY, JSON.stringify(reminders));
  }

  sendJson(res, 200, {
    ok: true,
    subscription: Boolean(subscription),
    reminders: hasReminders ? reminders.length : 'unchanged',
    storage: kvCredentials() ? 'kv' : 'memory',
  });
}

/** Cron tick: deliver every reminder whose timestamp has arrived. */
async function handleTick(res: ResponseLike, url: URL): Promise<void> {
  const dryRun = url.searchParams.get('dry') === '1';

  const subscription = await readJson<StoredSubscription>(SUBSCRIPTION_KEY);
  const reminders = (await readJson<StoredReminder[]>(REMINDERS_KEY)) ?? [];
  const now = Date.now();

  // Delivered ids are remembered so a client re-sync can never re-notify a task.
  const storedDelivered = await readJson<Record<string, number>>(DELIVERED_KEY);
  const freshDelivered: Record<string, number> = {};
  for (const [id, at] of Object.entries(storedDelivered ?? {})) {
    if (now - at < DELIVERED_RETENTION) freshDelivered[id] = at;
  }

  const due = reminders.filter(
    (reminder) =>
      !reminder.sent &&
      !freshDelivered[reminder.id] &&
      reminder.timestamp <= now + FORWARD_SLACK &&
      reminder.timestamp >= now - CATCH_UP,
  );

  // Diagnostics first, so `?dry=1` works before VAPID keys are configured.
  if (dryRun) {
    sendJson(res, 200, {
      ok: true,
      dryRun: true,
      due,
      pending: reminders.length,
      hasSubscription: Boolean(subscription),
      vapidConfigured: isVapidConfigured(),
      storage: kvCredentials() ? 'kv' : 'memory',
    });
    return;
  }

  if (!subscription) {
    sendJson(res, 200, { ok: true, delivered: 0, reason: 'no subscription registered' });
    return;
  }
  if (!isVapidConfigured()) {
    sendJson(res, 200, { ok: false, delivered: 0, reason: 'VAPID keys are not configured' });
    return;
  }

  if (due.length === 0) {
    sendJson(res, 200, { ok: true, delivered: 0, pending: reminders.length });
    return;
  }

  configureWebPush();
  const deliveredIds: string[] = [];
  let subscriptionGone = false;

  for (const reminder of due) {
    try {
      await webpush.sendNotification(
        subscription as webpush.PushSubscription,
        JSON.stringify({
          title: reminder.title,
          body: reminder.body,
          tag: reminder.taskId,
          url: '/',
        }),
      );
      reminder.sent = true;
      freshDelivered[reminder.id] = now;
      deliveredIds.push(reminder.id);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // The browser dropped this subscription; stop trying.
        subscriptionGone = true;
        break;
      }
    }
  }

  // Keep future work and anything still inside the catch-up window for a retry.
  const remaining = reminders.filter(
    (reminder) => !reminder.sent && reminder.timestamp > now - CATCH_UP,
  );
  await storeSet(REMINDERS_KEY, JSON.stringify(remaining));
  await storeSet(DELIVERED_KEY, JSON.stringify(freshDelivered));

  sendJson(res, 200, {
    ok: true,
    delivered: deliveredIds.length,
    deliveredIds,
    subscriptionGone,
    pending: remaining.length,
  });
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  try {
    const url = requestUrl(req);

    if (!isAuthorized(req, url)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (req.method === 'POST') {
      await handleSync(req, res);
      return;
    }

    if (req.method === 'GET') {
      await handleTick(res, url);
      return;
    }

    if (req.method === 'DELETE') {
      await storeSet(REMINDERS_KEY, '[]');
      await storeSet(DELIVERED_KEY, '{}');
      sendJson(res, 200, { ok: true, cleared: true });
      return;
    }

    res.setHeader('allow', 'GET, POST, DELETE');
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message });
  }
}

export const config = { maxDuration: 30 };
