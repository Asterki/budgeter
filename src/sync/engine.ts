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
  listVersions,
  markVersionAcked,
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
import { configureRecorder, entityPayload, sameTransferFields, sharedTransferFields } from './recorder';
import {
  NewSyncSpaceError,
  type ChangesPage,
  type PushResponse,
  type QuarantinedChange,
  type RemoteChange,
  type RemoteEntity,
  type SnapshotPage,
  type SyncConfig,
  type SyncInfo,
  type SyncStatus,
} from './types';

const ACKS_HEADER = 'x-budget-sync-acks';

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
/** Upper bound on how long background writers wait for the first sync attempt. */
const SETTLE_MS = 2_000;

const idleStatus: SyncStatus = {
  configured: false,
  state: 'off',
  pending: 0,
  lastSyncAt: 0,
  error: null,
};

let status: SyncStatus = { ...idleStatus };let runtime: { config: SyncConfig; clock: HlcClock } | null = null;
let applyHandler: (() => void) | null = null;
let syncPromise: Promise<SyncResult> | null = null;
let pollTimer: number | null = null;
let hlcTimer: number | null = null;
let firstPullDone = false;
/**
 * Bumped whenever the user connects, disconnects or reconnects. Work that
 * started under an older generation must not write: its `config` belongs to a
 * space that no longer exists, and persisting it would resurrect a dead space
 * or overwrite the new one's cursor.
 */
let generation = 0;
let bound = false;
let failures = 0;
let retryAt = 0;
let settledPromise: Promise<void> | null = null;
let firstAttempt: Promise<void> | null = null;
let resolveFirstAttempt: (() => void) | null = null;

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

  // Tear down whatever was running — but only in memory and only the sync
  // metadata. Domain rows are never cleared here: connecting to a space merges
  // local data into it, it does not replace either side.
  generation += 1;
  const myGeneration = generation;
  stopLoop();
  if (hlcTimer !== null) {
    window.clearTimeout(hlcTimer);
    hlcTimer = null;
  }
  configureRecorder(null, null);
  runtime = null;
  syncPromise = null;
  settledPromise = null;
  firstAttempt = null;
  resolveFirstAttempt = null;
  failures = 0;
  retryAt = 0;
  await clearSyncStores();

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
    if (myGeneration !== generation) return { created: !head.exists };
    await writeSyncState('app', config);
    if (head.exists) await snapshotPull(config, myGeneration);
    if (myGeneration !== generation) return { created: !head.exists };
    await pushPending(config, myGeneration);
    if (myGeneration !== generation) return { created: !head.exists };
    await pullAll(config, myGeneration);
    if (myGeneration !== generation) return { created: !head.exists };
    await dropSuperseded();
    // A joining device must repaint even when its cursor already sat at head.
    applyHandler?.();
    firstPullDone = true;
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
  generation += 1;
  stopLoop();
  if (hlcTimer !== null) {
    window.clearTimeout(hlcTimer);
    hlcTimer = null;
  }
  configureRecorder(null, null);
  runtime = null;
  syncPromise = null;
  settledPromise = null;
  firstAttempt = null;
  resolveFirstAttempt = null;
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
async function domainGroups(): Promise<Array<{ kind: EntityKind; values: unknown[] }>> {
  return [
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
}

function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

function idOf(kind: EntityKind, value: unknown): string | null {
  if (!value) return null;
  return kind === 'settings' ? 'app' : ((value as { id?: string }).id ?? null);
}

async function seedLocal(
  config: SyncConfig,
  nextHlc: (kind: EntityKind, value: unknown) => string,
): Promise<void> {
  for (const group of await domainGroups()) {
    for (const value of group.values) {
      const id = idOf(group.kind, value);
      if (!id || !value) continue;
      if (await getVersion(group.kind, id)) continue;

      const hlc = nextHlc(group.kind, value);
      await putOutbox({
        changeId: crypto.randomUUID(),
        entityType: group.kind,
        entityId: id,
        hlc,
        deleted: false,
        payload: entityPayload(group.kind, value),
      });
      await putVersion({ entityType: group.kind, entityId: id, hlc, deleted: false, queued: true });
      config.lastHlc = hlc;
    }
  }
}

/**
 * Re-publishes rows the relay has never seen. Two kinds qualify: rows written
 * before sync was ever configured (no version at all), and rows whose version
 * was written but whose outbox row was lost to a closed tab or a crash between
 * the two writes. The second kind is invisible to every other repair path.
 */
export async function reconcileLocalRows(): Promise<number> {
  const active = runtime;
  if (!active) return 0;
  const config = active.config;

  const versions = new Map(
    (await listVersions()).map((row) => [entityKey(row.entityType, row.entityId), row]),
  );
  const queued = new Set(
    (await listOutbox()).map((row) => entityKey(row.entityType, row.entityId)),
  );
  let seeded = 0;

  for (const group of await domainGroups()) {
    for (const value of group.values) {
      const id = idOf(group.kind, value);
      if (!id || !value) continue;
      const key = entityKey(group.kind, id);
      const version = versions.get(key);

      if (version) {
        if (version.queued && !queued.has(key)) {
          // Reuse the assigned HLC: the row keeps the ordering it was written
          // with, so a newer edit on this device still supersedes it.
          await putOutbox({
            changeId: crypto.randomUUID(),
            entityType: group.kind,
            entityId: id,
            hlc: version.hlc,
            deleted: version.deleted,
            payload: version.deleted ? null : entityPayload(group.kind, value),
          });
          queued.add(key);
          seeded += 1;
        }
        continue;
      }

      const hlc = active.clock.next();
      await putOutbox({
        changeId: crypto.randomUUID(),
        entityType: group.kind,
        entityId: id,
        hlc,
        deleted: false,
        payload: entityPayload(group.kind, value),
      });
      await putVersion({ entityType: group.kind, entityId: id, hlc, deleted: false, queued: true });
      config.lastHlc = hlc;
      queued.add(key);
      seeded += 1;
    }
  }

  if (seeded > 0) await writeSyncState('app', config);
  return seeded;
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
  // Rows written while sync was off (or while a previous write half-finished)
  // have no outbox entry and would otherwise never reach the relay.
  await reconcileLocalRows();
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

export interface SyncResult {
  applied: number;
  error: string | null;
}

function attemptSignal(): Promise<void> {
  if (!firstAttempt) {
    firstAttempt = new Promise<void>((resolve) => {
      resolveFirstAttempt = resolve;
    });
  }
  return firstAttempt;
}

/**
 * Resolves once the first sync attempt of this session has finished — success
 * or failure — or after {@link SETTLE_MS}, whichever comes first.
 *
 * Background writers run after this so they cannot race a pull that would have
 * delivered the same rows, and so an offline boot still catches up within two
 * seconds instead of waiting for a sync that will never succeed.
 */
export function whenInitialSyncSettles(): Promise<void> {
  if (!runtime) return Promise.resolve();
  if (!settledPromise) {
    settledPromise = Promise.race([
      attemptSignal(),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, SETTLE_MS);
      }),
    ]);
  }
  return settledPromise;
}

export function syncNow(): Promise<SyncResult> {
  const idle: SyncResult = { applied: 0, error: null };
  const settle = () => {
    resolveFirstAttempt?.();
    resolveFirstAttempt = null;
  };
  if (!runtime) return Promise.resolve(idle);
  if (syncPromise) return syncPromise;
  if (Date.now() < retryAt) {
    settle();
    return Promise.resolve(idle);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    publish({ state: 'idle', error: 'Offline — changes are queued.' });
    settle();
    return Promise.resolve(idle);
  }

  const gen = generation;
  const run = withLock(async () => {
    if (!runtime || gen !== generation) return idle;
    publish({ state: 'syncing', error: null });
    try {
      await pushPending(runtime.config, gen);
      if (gen !== generation) return idle;
      let applied = await pullAll(runtime.config, gen);
      if (gen !== generation) return idle;
      applied += await reconcileTransfers();
      await dropSuperseded();
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
      // Repaint when something actually changed, and once on the first sync of
      // the session so a device that was already at head still shows the data.
      if (applied > 0 || !firstPullDone) applyHandler?.();
      firstPullDone = true;
      return { applied, error: null };
    } catch (error) {
      failures += 1;
      retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(failures - 1, 6));
      const message = error instanceof Error ? error.message : 'Sync failed.';
      publish({ state: 'error', error: message });
      return { applied: 0, error: message };
    }
  });

  syncPromise = run
    .then((result) => result ?? idle)
    .finally(() => {
      syncPromise = null;
      settle();
    });

  return syncPromise;
}

async function withLock<T>(task: () => Promise<T>): Promise<T | undefined> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return task();
  }
  return navigator.locks.request('budget-sync', { ifAvailable: true }, async (lock) => {
    if (!lock) return undefined;
    return task();
  });
}

/* ── Push / pull ──────────────────────────────────────────────────────────── */

async function sendPush(config: SyncConfig, batch: OutboxRecord[]): Promise<PushResponse> {
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
  return request<PushResponse>(config.serverUrl, config.authKey, '/v1/sync/push', {
    method: 'POST',
    headers: { [ACKS_HEADER]: '1' },
    body: JSON.stringify({ clientId: config.clientId, changes }),
  });
}

/**
 * Sends the batch one record at a time to find the one the relay rejects, so a
 * single malformed row cannot wedge the whole queue forever.
 */
async function isolatePoisonRows(
  config: SyncConfig,
  batch: OutboxRecord[],
  blocked: Set<string>,
): Promise<QuarantinedChange[]> {
  const stuck: QuarantinedChange[] = [];
  for (const row of batch) {
    try {
      await sendPush(config, [row]);
    } catch (error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        stuck.push({ changeId: row.changeId, reason: error.message });
        blocked.add(row.changeId);
        continue;
      }
      throw error;
    }
  }
  return stuck;
}

async function readQuarantine(): Promise<QuarantinedChange[]> {
  return (await readSyncState<QuarantinedChange[]>('quarantined')) ?? [];
}

async function pushPending(config: SyncConfig, gen: number): Promise<void> {
  const quarantine = await readQuarantine();
  const blocked = new Set(quarantine.map((entry) => entry.changeId));

  for (let round = 0; round < 50; round += 1) {
    if (gen !== generation) return;
    const pending = (await listOutbox()).filter((row) => !blocked.has(row.changeId));
    if (pending.length === 0) return;
    const batch = pending.slice(0, BATCH);
    const cursorAtStart = config.cursor;

    let response: PushResponse | null = null;
    try {
      response = await sendPush(config, batch);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
      const stuck = await isolatePoisonRows(config, batch, blocked);
      if (stuck.length > 0) {
        quarantine.push(...stuck);
        await writeSyncState('quarantined', quarantine);
      }
      if (stuck.length === 0) throw error;
    }

    if (response) {
      if (gen !== generation) return;
      const verdicts = response.changes;
      if (verdicts) {
        const byId = new Map(verdicts.map((verdict) => [verdict.changeId, verdict]));
        const appliedRows = batch.filter((row) => byId.get(row.changeId)?.applied);
        for (const row of appliedRows) {
          await markVersionAcked(row.entityType, row.entityId, row.hlc);
        }
        // A change the relay did not apply has already lost to a newer record
        // that lives on the relay. Dropping it here would lose the local edit
        // silently, so it stays queued until the pull supersedes it.
        await removeOutbox(appliedRows.map((row) => row.changeId));
        const rejected = batch.filter((row) => byId.get(row.changeId)?.applied !== true);
        if (rejected.length > 0) {
          // Rewind so the following pull re-delivers the winning record.
          config.cursor = Math.min(config.cursor, cursorAtStart);
        }
      } else {
        // Older relay without per-change verdicts: a 200 is the only signal.
        await removeOutbox(batch.map((row) => row.changeId));
        for (const row of batch) {
          await markVersionAcked(row.entityType, row.entityId, row.hlc);
        }
      }
    }

    const remaining = (await listOutbox()).filter((row) => !blocked.has(row.changeId));
    if (remaining.length === 0) return;
    if (pending.length <= BATCH) return;
  }
}

/** Drops queued changes the relay has already superseded. */
async function dropSuperseded(): Promise<void> {
  const stale: string[] = [];
  for (const row of await listOutbox()) {
    const version = await getVersion(row.entityType, row.entityId);
    if (version && version.hlc !== row.hlc && compareHlc(row.hlc, version.hlc) < 0) {
      stale.push(row.changeId);
    }
  }
  if (stale.length > 0) await removeOutbox(stale);
}

/* ── Transfers ────────────────────────────────────────────────────────────── */

/**
 * The two halves of a transfer are independent last-writer-wins rows, so an
 * edit applied to one leg can leave the pair describing the same movement with
 * different dates, notes or amounts. Repair copies the winner's shared fields
 * onto the loser — never the reverse, and only when they actually differ — and
 * stamps the loser with the *winner's* HLC so neither device can keep declaring
 * itself newer and the pair converges in one step.
 */
export async function reconcileTransfers(): Promise<number> {
  if (!runtime) return 0;

  return runExclusive(async () => {
    const legs = (await db.transactions.all()).filter(
      (transaction) => transaction.transferPairId !== null,
    );
    if (legs.length < 2) return 0;

    const byPair = new Map<string, Transaction[]>();
    for (const leg of legs) {
      const pairId = leg.transferPairId as string;
      const group = byPair.get(pairId);
      if (group) group.push(leg);
      else byPair.set(pairId, [leg]);
    }

    let repaired = 0;
    for (const group of byPair.values()) {
      if (group.length !== 2) continue;
      const [a, b] = group;
      if (sameTransferFields(sharedTransferFields(a), sharedTransferFields(b))) continue;

      const [versionA, versionB] = await Promise.all([
        getVersion('transaction', a.id),
        getVersion('transaction', b.id),
      ]);
      // Without both versions there is no defensible winner; leave the pair to
      // the next pull, which will bring one of them.
      if (!versionA || !versionB) continue;

      const winnerFirst = compareHlc(versionA.hlc, versionB.hlc) >= 0;
      const winner = winnerFirst ? a : b;
      const loser = winnerFirst ? b : a;
      const winnerHlc = winnerFirst ? versionA.hlc : versionB.hlc;
      const shared = sharedTransferFields(winner);

      // Keep the loser's own direction: an outflow stays an outflow.
      const sign = Math.sign(loser.amount) || -Math.sign(winner.amount) || -1;
      const repairedLeg: Transaction = {
        ...loser,
        date: shared.date,
        notes: shared.notes,
        tags: [...shared.tags],
        cleared: shared.cleared,
        amount: sign * shared.magnitude,
        accountId: winner.transferAccountId ?? loser.accountId,
        transferAccountId: winner.accountId,
        updatedAt: Date.now(),
      };

      await writeEntitySilently('transaction', repairedLeg);
      await putVersion({
        entityType: 'transaction',
        entityId: repairedLeg.id,
        hlc: winnerHlc,
        deleted: false,
        queued: false,
      });
      repaired += 1;
    }
    return repaired;
  });
}

async function pullAll(config: SyncConfig, gen: number): Promise<number> {
  let applied = 0;
  try {
    for (;;) {
      const page = await request<ChangesPage>(
        config.serverUrl,
        config.authKey,
        `/v1/sync/changes?since=${config.cursor}&limit=${BATCH}`,
      );
      for (const change of page.changes) {
        if (gen !== generation) return applied;
        if (await applyRemote(config, change, gen)) applied += 1;
      }
      if (gen !== generation) return applied;
      config.cursor = Math.max(config.cursor, page.cursor);
      await writeSyncState('app', config);
      if (!page.hasMore) break;
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 410) {
      // The relay purged history past our cursor; start again from a snapshot.
      applied += await snapshotPull(config, gen);
    } else {
      throw error;
    }
  }
  return applied;
}

async function snapshotPull(config: SyncConfig, gen: number): Promise<number> {
  let applied = 0;
  let afterType = '';
  let afterId = '';
  // The first page fixes the head. Every later page passes it back so the
  // whole sequence sees one consistent boundary even while the relay moves.
  let pinnedHead: number | null = null;

  for (;;) {
    const query = new URLSearchParams({ limit: String(BATCH) });
    if (afterType && afterId) {
      query.set('afterType', afterType);
      query.set('afterId', afterId);
    }
    if (pinnedHead !== null) query.set('head', String(pinnedHead));
    const page = await request<SnapshotPage>(
      config.serverUrl,
      config.authKey,
      `/v1/sync/snapshot?${query.toString()}`,
    );
    if (pinnedHead === null) pinnedHead = page.head;

    for (const entity of page.entities) {
      if (gen !== generation) return applied;
      if (await applyRemote(config, entity, gen)) applied += 1;
    }

    if (!page.next) break;
    afterType = page.next.type;
    afterId = page.next.id;
  }

  if (gen !== generation) return applied;
  config.cursor = Math.max(config.cursor, pinnedHead ?? 0);
  await writeSyncState('app', config);
  // Anything that landed after the pinned head is still owed to us.
  applied += await pullAll(config, gen);
  return applied;
}

/* ── Merge ────────────────────────────────────────────────────────────────── */

async function applyRemote(
  config: SyncConfig,
  change: RemoteChange | RemoteEntity,
  gen: number,
): Promise<boolean> {
  // Tasker rows can still exist in an old relay. They are ignored, never merged.
  if ((LEGACY_ENTITY_TYPES as readonly string[]).includes(change.entityType)) return false;
  if (!ENTITY_KINDS.includes(change.entityType)) return false;
  if (gen !== generation) return false;
  runtime?.clock.observe(change.hlc);

  // One exclusive slot for the compare and the write: a local edit landing
  // between them would otherwise leave the entity and its version disagreeing.
  return runExclusive(async () => {
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
        queued: false,
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
      queued: false,
    });
    // If the merge added local-only achievements or counters, publish the union
    // back so the other device receives it too.
    if (mergedSettings) await enqueueSettings(mergedSettings);
    return true;
  });
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
