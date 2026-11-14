/**
 * The sync engine: connect, poll, push, pull and merge.
 *
 * Everything here is optional. With no saved config the engine does nothing and
 * the app stays purely local. When connected, domain writes are recorded by
 * `recorder.ts`, and this module moves them to the relay in the background.
 */

import {
  db,
  clearSyncStores,
  clearOutboxForEntity,
  deleteEntitySilently,
  getVersion,
  listOutbox,
  normalizeAccount,
  normalizeBudget,
  normalizeCategory,
  normalizeCategoryGroup,
  normalizeCategoryRule,
  normalizePayee,
  normalizeRecurring,
  normalizeSettings,
  normalizeTransaction,
  putOutbox,
  putVersion,
  readEntity,
  readSyncState,
  removeOutbox,
  runExclusive,
  writeEntitySilently,
  writeSyncState,
  type EntityKind,
  type OutboxRecord,
} from '../db/database';
import type { Settings, Transaction } from '../domain/types';
import { mergeProgress } from '../domain/progress';
import { decryptPayload, deriveKeys, encryptPayload } from './crypto';
import { compareHlc, epochHlc, HlcClock } from './hlc';
import {
  IncompatibleSyncSpaceError,
  LEGACY_ENTITY_TYPES,
  PROTOCOL_HEADER,
  SCHEMA_HEADER,
  SYNC_PROTOCOL_VERSION,
  SYNC_SCHEMA_VERSION,
} from './protocol';
import { configureRecorder, entityPayload } from './recorder';
import {
  NewSyncSpaceError,
  type ChangesPage,
  type RemoteChange,
  type RemoteEntity,
  type SnapshotPage,
  type SyncConfig,
  type SyncInfo,
  type SyncStatus,
} from './types';

const ENTITY_KINDS: EntityKind[] = [
  'account',
  'category',
  'categoryGroup',
  'payee',
  'transaction',
  'budget',
  'recurring',
  'rule',
  'settings',
];
const BATCH = 200;
const POLL_MS = 10_000;
const TIMEOUT_MS = 20_000;
/** Observed remote clocks are flushed to disk at most this often. */
const HLC_PERSIST_MS = 1_000;

const idleStatus: SyncStatus = {
  configured: false,
  state: 'off',
  pending: 0,
  lastSyncAt: 0,
  error: null,
};

let status: SyncStatus = { ...idleStatus };
let runtime: { config: SyncConfig; clock: HlcClock } | null = null;
let applyHandler: (() => void) | null = null;
let syncPromise: Promise<void> | null = null;
let pollTimer: number | null = null;
let hlcTimer: number | null = null;
let bound = false;
let failures = 0;
let retryAt = 0;

const listeners = new Set<(status: SyncStatus) => void>();

/* ── Status ───────────────────────────────────────────────────────────────── */

function publish(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener({ ...status });
}

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

export function subscribeSync(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener({ ...status });
  return () => {
    listeners.delete(listener);
  };
}

export function registerApplyHandler(handler: (() => void) | null): void {
  applyHandler = handler;
}

export async function getSyncInfo(): Promise<SyncInfo | null> {
  const config = await readSyncState<SyncConfig>('app');
  if (!config?.enabled) return null;
  return {
    serverUrl: config.serverUrl,
    fingerprint: config.fingerprint,
    lastSyncAt: config.lastSyncAt,
  };
}

async function pendingCount(): Promise<number> {
  return (await listOutbox()).length;
}

/* ── Clock ────────────────────────────────────────────────────────────────── */

/**
 * Persists the observed high-water mark, coalescing bursts: a pull can observe
 * hundreds of remote HLCs and only the last one matters. The "only if larger"
 * guard means a delayed flush can never rewind what was already stored.
 */
function scheduleHlcPersist(config: SyncConfig, hlc: string): void {
  if (compareHlc(hlc, config.lastHlc) <= 0) return;
  config.lastHlc = hlc;
  if (hlcTimer !== null) return;
  hlcTimer = window.setTimeout(() => {
    hlcTimer = null;
    const active = runtime;
    if (active?.config !== config) return;
    void runExclusive(() => writeSyncState('app', config));
  }, HLC_PERSIST_MS);
}

function createClock(config: SyncConfig): HlcClock {
  return new HlcClock(config.clientId, config.lastHlc, (hlc) =>
    scheduleHlcPersist(config, hlc),
  );
}

/** Writes any pending clock advance immediately, for page teardown. */
function flushHlc(): void {
  if (hlcTimer !== null) {
    window.clearTimeout(hlcTimer);
    hlcTimer = null;
  }
  if (!runtime) return;
  void writeSyncState('app', runtime.config);
}

/* ── HTTP ─────────────────────────────────────────────────────────────────── */

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

async function request<T>(
  serverUrl: string,
  authKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${authKey}`);
  headers.set(PROTOCOL_HEADER, String(SYNC_PROTOCOL_VERSION));
  headers.set(SCHEMA_HEADER, String(SYNC_SCHEMA_VERSION));
  if (init.body) headers.set('content-type', 'application/json');

  try {
    const response = await fetch(`${serverUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        detail = parsed.message ?? parsed.error ?? text;
      } catch {
        /* keep the raw body */
      }
      if (response.status === 426) {
        throw new IncompatibleSyncSpaceError(
          detail ||
            `This relay requires Budget sync protocol ${SYNC_PROTOCOL_VERSION}. Update the app or relay.`,
        );
      }
      throw new HttpError(response.status, detail || `Request failed (${response.status})`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof HttpError || error instanceof IncompatibleSyncSpaceError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Sync server timed out.');
    }
    throw new Error('Could not reach the sync server.');
  } finally {
    window.clearTimeout(timer);
  }
}

/* ── Connect / disconnect ─────────────────────────────────────────────────── */

export async function connectSync(
  rawUrl: string,
  passphrase: string,
  allowCreate: boolean,
): Promise<{ created: boolean }> {
  const serverUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error('Enter the full relay URL, starting with http:// or https://.');
  }
  if (passphrase.trim().length < 8) {
    throw new Error('Use a passphrase of at least 8 characters.');
  }

  const keys = await deriveKeys(passphrase.trim());
  const head = await request<{ exists: boolean; head: number }>(
    serverUrl,
    keys.authKey,
    '/v1/sync/head',
  );

  // A reused Tasker passphrase must not silently start a second, invisible
  // space on the same relay. Say exactly what happened instead.
  if (!head.exists) {
    const legacyKeys = await deriveKeys(passphrase.trim(), 'tasker');
    const legacyHead = await request<{ exists: boolean; head: number }>(
      serverUrl,
      legacyKeys.authKey,
      '/v1/sync/head',
    );
    if (legacyHead.exists) {
      throw new IncompatibleSyncSpaceError(
        'That passphrase belongs to an old Tasker sync space. Budget uses a separate ' +
          'encryption context, so create a new space with a different passphrase.',
      );
    }
  }

  if (!head.exists && !allowCreate) throw new NewSyncSpaceError();

  if (runtime) await disconnectSync();
  stopLoop();

  const config: SyncConfig = {
    key: 'app',
    serverUrl,
    clientId: crypto.randomUUID(),
    authKey: keys.authKey,
    encKey: keys.encKey,
    fingerprint: keys.fingerprint,
    cursor: 0,
    enabled: true,
    lastSyncAt: 0,
    lastHlc: '',
  };

  await writeSyncState('app', config);
  runtime = { config, clock: createClock(config) };
  configureRecorder(config, runtime.clock);
  publish({ configured: true, state: 'syncing', pending: 0, lastSyncAt: 0, error: null });

  try {
    // Joining an existing space: seed at the epoch so the space's history wins
    // conflicts, while local-only rows are still inserted. Creating a space:
    // seed with real timestamps so these rows become the canonical history.
    await seedLocal(config, head.exists ? () => epochHlc(config.clientId) : () => runtime!.clock.next());
    await writeSyncState('app', config);
    if (head.exists) await snapshotPull(config);
    await pushPending(config);
    await pullAll(config);
    config.lastSyncAt = Date.now();
    await writeSyncState('app', config);
    publish({
      state: 'idle',
      pending: await pendingCount(),
      lastSyncAt: config.lastSyncAt,
      error: null,
    });
    startLoop();
    return { created: !head.exists };
  } catch (error) {
    publish({
      state: 'error',
      error: error instanceof Error ? error.message : 'Could not start syncing.',
    });
    startLoop();
    throw error;
  }
}

export async function disconnectSync(): Promise<void> {
  stopLoop();
  if (hlcTimer !== null) {
    window.clearTimeout(hlcTimer);
    hlcTimer = null;
  }
  configureRecorder(null, null);
  runtime = null;
  syncPromise = null;
  failures = 0;
  retryAt = 0;
  await clearSyncStores();
  publish({ ...idleStatus });
}

/**
 * Queues every local entity so the relay receives the complete dataset.
 * Rows are stamped by the caller: epoch for an existing space, real time for
 * a new one.
 */
async function seedLocal(
  config: SyncConfig,
  nextHlc: (kind: EntityKind, value: unknown) => string,
): Promise<void> {
  const groups: Array<{ kind: EntityKind; values: unknown[] }> = [
    { kind: 'account', values: await db.accounts.all() },
    { kind: 'categoryGroup', values: await db.categoryGroups.all() },
    { kind: 'category', values: await db.categories.all() },
    { kind: 'payee', values: await db.payees.all() },
    { kind: 'transaction', values: await db.transactions.all() },
    { kind: 'budget', values: await db.budgets.all() },
    { kind: 'recurring', values: await db.recurring.all() },
    { kind: 'rule', values: await db.rules.all() },
    { kind: 'settings', values: [await db.settings.get()] },
  ];

  for (const group of groups) {
    for (const value of group.values) {
      const id = group.kind === 'settings' ? 'app' : (value as { id?: string }).id;
      if (!id) continue;
      if (await getVersion(group.kind, id)) continue;

      const hlc = nextHlc(group.kind, value);
      const record: OutboxRecord = {
        changeId: crypto.randomUUID(),
        entityType: group.kind,
        entityId: id,
        hlc,
        deleted: false,
        payload: entityPayload(group.kind, value),
      };
      await putOutbox(record);
      await putVersion({ entityType: group.kind, entityId: id, hlc, deleted: false });
      config.lastHlc = hlc;
    }
  }
}

/* ── Loop ─────────────────────────────────────────────────────────────────── */

function wake(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  void syncNow();
}

function bindEvents(): void {
  if (bound) return;
  bound = true;
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('pagehide', flushHlc);
  document.addEventListener('visibilitychange', wake);
}

function unbindEvents(): void {
  if (!bound) return;
  bound = false;
  window.removeEventListener('online', wake);
  window.removeEventListener('focus', wake);
  window.removeEventListener('pagehide', flushHlc);
  document.removeEventListener('visibilitychange', wake);
}

export function startLoop(): void {
  stopLoop();
  if (!runtime) return;
  bindEvents();
  pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    void syncNow();
  }, POLL_MS);
}

export function stopLoop(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  unbindEvents();
}

export async function loadSyncRuntime(): Promise<void> {
  const config = await readSyncState<SyncConfig>('app');
  if (!config?.enabled) {
    publish({ ...idleStatus });
    return;
  }

  runtime = { config, clock: createClock(config) };
  configureRecorder(config, runtime.clock);
  publish({
    configured: true,
    state: 'idle',
    pending: await pendingCount(),
    lastSyncAt: config.lastSyncAt,
    error: null,
  });
  startLoop();
  void syncNow();
}

export function syncNow(): Promise<void> {
  if (!runtime) return Promise.resolve();
  if (syncPromise) return syncPromise;
  if (Date.now() < retryAt) return Promise.resolve();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    publish({ state: 'idle', error: 'Offline — changes are queued.' });
    return Promise.resolve();
  }

  syncPromise = withLock(async () => {
    if (!runtime) return;
    publish({ state: 'syncing', error: null });
    try {
      await pushPending(runtime.config);
      const changed = await pullAll(runtime.config);
      runtime.config.lastSyncAt = Date.now();
      await writeSyncState('app', runtime.config);
      failures = 0;
      retryAt = 0;
      publish({
        state: 'idle',
        pending: await pendingCount(),
        lastSyncAt: runtime.config.lastSyncAt,
        error: null,
      });
      if (changed) applyHandler?.();
    } catch (error) {
      failures += 1;
      retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(failures - 1, 6));
      publish({
        state: 'error',
        error: error instanceof Error ? error.message : 'Sync failed.',
      });
    }
  }).finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

async function withLock(task: () => Promise<void>): Promise<void> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    await task();
    return;
  }
  await navigator.locks.request('budget-sync', { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    await task();
  });
}

/* ── Push / pull ──────────────────────────────────────────────────────────── */

async function pushPending(config: SyncConfig): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const pending = await listOutbox();
    if (pending.length === 0) return;
    const batch = pending.slice(0, BATCH);

    const changes = await Promise.all(
      batch.map(async (row) => ({
        changeId: row.changeId,
        entityType: row.entityType,
        entityId: row.entityId,
        hlc: row.hlc,
        deleted: row.deleted,
        payload: row.deleted ? '' : await encryptPayload(row.payload, config.encKey),
      })),
    );

    await request(config.serverUrl, config.authKey, '/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({ clientId: config.clientId, changes }),
    });
    await removeOutbox(batch.map((row) => row.changeId));
    if (pending.length <= BATCH) return;
  }
}

async function pullAll(config: SyncConfig): Promise<boolean> {
  let changed = false;
  try {
    for (;;) {
      const page = await request<ChangesPage>(
        config.serverUrl,
        config.authKey,
        `/v1/sync/changes?since=${config.cursor}&limit=${BATCH}`,
      );
      for (const change of page.changes) {
        if (await applyRemote(config, change)) changed = true;
      }
      config.cursor = Math.max(config.cursor, page.cursor);
      await writeSyncState('app', config);
      if (!page.hasMore) break;
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 410) {
      // The relay purged history past our cursor; start again from a snapshot.
      changed = await snapshotPull(config);
    } else {
      throw error;
    }
  }
  return changed;
}

async function snapshotPull(config: SyncConfig): Promise<boolean> {
  let changed = false;
  let afterType = '';
  let afterId = '';
  let head = config.cursor;

  for (;;) {
    const query = new URLSearchParams({ limit: String(BATCH) });
    if (afterType && afterId) {
      query.set('afterType', afterType);
      query.set('afterId', afterId);
    }
    const page = await request<SnapshotPage>(
      config.serverUrl,
      config.authKey,
      `/v1/sync/snapshot?${query.toString()}`,
    );
    head = page.head;

    for (const entity of page.entities) {
      if (await applyRemote(config, entity)) changed = true;
    }

    if (!page.next) break;
    afterType = page.next.type;
    afterId = page.next.id;
  }

  config.cursor = Math.max(config.cursor, head);
  await writeSyncState('app', config);
  return changed;
}

/* ── Merge ────────────────────────────────────────────────────────────────── */

async function applyRemote(
  config: SyncConfig,
  change: RemoteChange | RemoteEntity,
): Promise<boolean> {
  // Tasker rows can still exist in an old relay. They are ignored, never merged.
  if ((LEGACY_ENTITY_TYPES as readonly string[]).includes(change.entityType)) return false;
  if (!ENTITY_KINDS.includes(change.entityType)) return false;
  runtime?.clock.observe(change.hlc);

  const stored = await getVersion(change.entityType, change.entityId);
  if (stored && compareHlc(change.hlc, stored.hlc) <= 0) return false;

  if (change.deleted) {
    if (change.entityType === 'transaction') {
      await deleteTransferPartner(change.entityId, change.hlc);
    }
    await deleteEntitySilently(change.entityType, change.entityId);
    await putVersion({
      entityType: change.entityType,
      entityId: change.entityId,
      hlc: change.hlc,
      deleted: true,
    });
    return true;
  }

  let payload: unknown;
  try {
    payload = await decryptPayload<unknown>(change.payload, config.encKey);
  } catch {
    // A payload from a different passphrase can never decrypt; skip it rather
    // than blocking every later change behind a poison record.
    console.warn('Skipping a sync change that could not be decrypted.');
    return false;
  }
  const mergedSettings = await writeMerged(change.entityType, change.entityId, payload);
  await putVersion({
    entityType: change.entityType,
    entityId: change.entityId,
    hlc: change.hlc,
    deleted: false,
  });
  // If the merge added local-only achievements or counters, publish the union
  // back so the other device receives it too.
  if (mergedSettings) await enqueueSettings(mergedSettings);
  return true;
}

async function enqueueSettings(settings: Settings): Promise<void> {
  if (!runtime) return;
  const hlc = runtime.clock.next();
  await clearOutboxForEntity('settings', 'app');
  await putOutbox({
    changeId: crypto.randomUUID(),
    entityType: 'settings',
    entityId: 'app',
    hlc,
    deleted: false,
    payload: entityPayload('settings', settings),
  });
  await putVersion({ entityType: 'settings', entityId: 'app', hlc, deleted: false });
  runtime.config.lastHlc = hlc;
  await writeSyncState('app', runtime.config);
}

/** Publishes a tombstone produced by a merge rule rather than a local edit. */
async function enqueueDelete(kind: EntityKind, id: string): Promise<void> {
  if (!runtime) return;
  const hlc = runtime.clock.next();
  await clearOutboxForEntity(kind, id);
  await putOutbox({
    changeId: crypto.randomUUID(),
    entityType: kind,
    entityId: id,
    hlc,
    deleted: true,
    payload: null,
  });
  await putVersion({ entityType: kind, entityId: id, hlc, deleted: true });
  runtime.config.lastHlc = hlc;
  await writeSyncState('app', runtime.config);
}

/**
 * A transfer is one logical row split in two. If either leg is deleted
 * remotely, remove the partner locally and publish its tombstone too.
 */
async function deleteTransferPartner(transactionId: string, hlc: string): Promise<void> {
  const local = await readEntity<Transaction>('transaction', transactionId);
  if (!local?.transferPairId) return;

  const all = await db.transactions.all();
  const partner = all.find(
    (transaction) =>
      transaction.id !== local.id && transaction.transferPairId === local.transferPairId,
  );
  if (!partner) return;

  await deleteEntitySilently('transaction', partner.id);
  await putVersion({ entityType: 'transaction', entityId: partner.id, hlc, deleted: true });
  await enqueueDelete('transaction', partner.id);
}

async function writeMerged(kind: EntityKind, id: string, payload: unknown): Promise<Settings | null> {
  if (kind === 'settings') {
    const local = await db.settings.get();
    const remote = normalizeSettings(payload as Partial<Settings>);
    const merged = normalizeSettings({
      ...local,
      ...remote,
      progress: mergeProgress(local.progress, remote.progress),
    });
    await writeEntitySilently('settings', merged);
    return JSON.stringify(merged.progress) === JSON.stringify(remote.progress) ? null : merged;
  }

  switch (kind) {
    case 'account':
      await writeEntitySilently(kind, normalizeAccount({ ...(payload as object), id } as never));
      return null;
    case 'category':
      await writeEntitySilently(kind, normalizeCategory({ ...(payload as object), id } as never));
      return null;
    case 'categoryGroup':
      await writeEntitySilently(kind, normalizeCategoryGroup({ ...(payload as object), id } as never));
      return null;
    case 'payee':
      await writeEntitySilently(kind, normalizePayee({ ...(payload as object), id } as never));
      return null;
    case 'transaction':
      await writeEntitySilently(kind, normalizeTransaction({ ...(payload as object), id } as never));
      return null;
    case 'budget':
      await writeEntitySilently(kind, normalizeBudget({ ...(payload as object), id } as never));
      return null;
    case 'recurring':
      await writeEntitySilently(kind, normalizeRecurring({ ...(payload as object), id } as never));
      return null;
    case 'rule':
      await writeEntitySilently(kind, normalizeCategoryRule({ ...(payload as object), id } as never));
      return null;
  }
}
