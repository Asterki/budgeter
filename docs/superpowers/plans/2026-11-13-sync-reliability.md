# Sync Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two devices converge on the same ledger within ten seconds, and make a device that has drifted repair itself without the user doing anything.

**Architecture:** The wire protocol and crypto are sound and stay. What changes is the bookkeeping: one exclusive write lock so the local writer and the remote applier cannot interleave, a version gate that refuses stale writes rather than merely refusing stale versions, a relay that says whether each pushed change was actually *applied* rather than merely received, and a refresh after every applied change. Server first, so an un-updated phone never sees `426`.

**Tech Stack:** React 18 + Vite + TypeScript, native IndexedDB, Express + better-sqlite3 relay.

**Spec:** `docs/superpowers/specs/2026-11-13-budget-parity-and-sync-design.md` (§9, §10)

## Global Constraints

- pnpm only. Node >= 20. No new runtime dependencies.
- **No unit/integration/E2E test suites** (`AGENTS.md`: "STRICTLY FORBIDDEN: extensive unit, integration, or E2E test suites"). Verification per task is `pnpm typecheck`, `pnpm build`, and the stated manual check. Do not add a test framework.
- Server keeps `protocol: 2` and `schema: 6`. No IndexedDB version bump. No relay reset. Existing spaces and pairings must survive.
- Money is integer minor units. Never compute with floats.
- Sync must degrade to today's behaviour when a newer field is missing from a response.
- `pnpm typecheck` and `pnpm build` must pass at the end of every task; the app must boot with no console errors.

## Review Focus

The five conditions most likely to break a real user's ledger, most likely first:

1. **A local edit made while a pull is in flight.** Expectation: the newer of the two wins and both devices agree. Pinned by Task 3 + Task 5.
2. **Joining a space from a device that already has data.** Expectation: the remote history wins on conflict, local-only rows survive and get published. Pinned by Task 5 + Task 8.
3. **Booting offline.** Expectation: recurring rows still materialise and the app is usable. Pinned by Task 9.
4. **A single corrupt or oversized outbox row.** Expectation: the rest of the queue still syncs. Pinned by Task 7.
5. **A device whose clock is ahead, then reloads.** Expectation: its later edits still win. Pinned by Task 4.

---

### Task 1: Relay reports a verdict per change

**Files:**
- Modify: `server/src/db.ts:146-190` (`PushResult`, `pushChanges`)
- Modify: `server/src/index.ts:153-227` (push handler)

**Interfaces:**
- Consumes: nothing.
- Produces: `pushChanges(userKeyHash: string, changes: ChangeInput[]): PushResult` where `PushResult` is now
  `{ accepted: string[]; verdicts: Array<{ changeId: string; applied: boolean }> }`.
  Response body for a client sending `x-budget-sync-acks: 1`:
  `{ accepted: string[]; duplicates: number; cursor: number; changes: Array<{ changeId: string; applied: boolean; error?: string }> }`.

- [ ] **Step 1: Extend `pushChanges` to record a verdict for every input change**

In `server/src/db.ts`, inside the existing transaction, after each `insertChange` + `upsertEntity`, re-read the entity row and compute
`applied = entityRow.hlc === change.hlc`. Push `{ changeId, applied }` for **every** input change, including duplicates (`insertChange` returning `undefined` still produces a verdict — for a duplicate, `applied` is true when the stored entity HLC equals the change's HLC). Return `verdicts` alongside `accepted`.

- [ ] **Step 2: Add the opt-in header and per-change errors**

In `server/src/index.ts`, read `const acks = req.headers['x-budget-sync-acks'] === '1';`. When `acks` is true, replace the three early `res.status(400).json(...)` rejections inside the per-change loop with an `error` entry in a `verdicts`-style array and continue; invalid changes are not sent to `pushChanges`. When `acks` is false, keep the current behaviour byte-for-byte (first invalid change rejects the batch with 400).

- [ ] **Step 3: Include `changes` only for opting-in clients**

```ts
const body: Record<string, unknown> = {
  accepted: result.accepted,
  duplicates: changes.length - result.accepted.length,
  cursor: fresh.head_seq,
};
if (acks) body.changes = mergedVerdicts;
res.json(body);
```

- [ ] **Step 4: Verify both paths against a local relay**

Run: `pnpm --dir server build` then `pnpm --dir server start`, and:

```bash
# old client: invalid change must still 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/v1/sync/push" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"clientId":"x","changes":[{"changeId":"short"}]}'
# expect 400

# new client: same payload must 200 with a per-change error
curl -s -X POST "$URL/v1/sync/push" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -H 'x-budget-sync-acks: 1' \
  -d '{"clientId":"x","changes":[{"changeId":"short"}]}'
# expect 200 and {"changes":[{"changeId":"short","error":"invalid_change"}]}
```

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "feat(server): report applied verdict for every pushed change"
```

---

### Task 2: Pinned snapshot head and uncacheable sync responses

**Files:**
- Modify: `server/src/db.ts:215-256` (`snapshot`)
- Modify: `server/src/index.ts:264-293` (snapshot handler) and the `/v1/sync/*` middleware

**Interfaces:**
- Consumes: Task 1's handler shape.
- Produces: `snapshot(userId: string, limit: number, afterType: string, afterId: string, head?: number): { entities: StoredEntity[]; next: { type: string; id: string } | null; head: number }`.
  `GET /v1/sync/snapshot?head=<n>` serves that head when supplied, otherwise the current one. Every `/v1/sync/*` response carries `Cache-Control: no-store`.

- [ ] **Step 1: Accept an optional head in `snapshot`**

Add the `head` parameter; when `undefined`, use `currentHead(userId)` as today. Use the resolved head in the `seq <= head` filter **and** in the returned `head` field, so every page of one pagination reports the same value.

- [ ] **Step 2: Read `head` from the query string**

In the snapshot handler, parse `req.query.head` as a number when present and finite; ignore it otherwise.

- [ ] **Step 3: Add `no-store` to all sync routes**

Register before the routes:

```ts
app.use('/v1/sync', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
```

- [ ] **Step 4: Verify**

```bash
curl -sI "$URL/v1/sync/head" -H "Authorization: Bearer $KEY" | grep -i cache-control
# expect: cache-control: no-store
curl -s "$URL/v1/sync/snapshot?limit=2&head=1" -H "Authorization: Bearer $KEY" | jq .head
# expect: 1, not the current head
```

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "feat(server): pin snapshot to a head and disable caching"
```

---

### Task 3: One exclusive write lock, and a version gate that refuses stale writes

**Files:**
- Modify: `src/db/database.ts:150-205` (mutation notification + write primitives)
- Modify: `src/sync/recorder.ts:79-127` (`persist`, `recordMutation`)

**Interfaces:**
- Consumes: existing `getVersion`, `putVersion`, `putOutbox`, `clearOutboxForEntity`.
- Produces:
  - `export function runExclusive<T>(task: () => Promise<T>): Promise<T>` — a module-level promise chain; every write path funnels through it.
  - `export interface SyncWriter { nextHlc(): string; toChange(kind: EntityKind, id: string, value: unknown | null): { changeId: string; entityType: EntityKind; entityId: string; hlc: string; deleted: boolean; payload: unknown }; commitLastHlc(hlc: string): Promise<void>; onLocalWrite?(): void; }` (`onLocalWrite` is how Task 11 hooks the debounced post-mutation sync; the database layer calls it after a committed write.)
  - `export function setSyncWriter(writer: SyncWriter | null): void` (replaces `setMutationListener`; keep `setMutationListener` deleted, not wrapped).
  - `putValue` / `putValues` / `deleteValue` / `removeMany` return `Promise<{ written: string[] }>` — the ids actually committed.

- [ ] **Step 1: Add the exclusive lock**

```ts
let queue: Promise<unknown> = Promise.resolve();
export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}
```

- [ ] **Step 2: Make each write version-gated inside the lock**

Rewrite `putValue` so the whole operation runs in `runExclusive`: obtain `hlc = writer.nextHlc()` **before** touching IndexedDB; read `getVersion(kind, id)`; if `stored && compareHlc(hlc, stored.hlc) <= 0` → do not write the entity, do not enqueue, return `{ written: [] }`; otherwise write the entity, `putVersion({ ..., hlc })`, `clearOutboxForEntity(kind, id)`, `putOutbox({ ...toChange(...) })`, then `await writer.commitLastHlc(hlc)`. Apply the same shape to `putValues` (all rows share one `hlc`), `deleteValue` and `removeMany` (deleted: true). When `writer === null`, behave exactly as today: plain write, no version, no outbox.

- [ ] **Step 3: Delete the post-commit notification path**

Remove `emitMutation`, `mutationListener`, and the trailing `emitMutation(...)` calls — the outbox row is now written inside the same slot as the entity, so nothing is left to notify. `setMutationListener` is removed; `recorder.configureRecorder` switches to `setSyncWriter`.

- [ ] **Step 4: Point the recorder at the new interface**

`configureRecorder` builds a `SyncWriter` whose `nextHlc` is `clock.next()`, whose `toChange` builds the outbox row using the existing `entityPayload(kind, value)`, and whose `commitLastHlc(hlc)` writes `config.lastHlc = hlc` and persists state. `persist` and the `chain` serialisation are deleted; the database layer is the only writer now.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Then in the app with sync **off**: add, edit and delete a transaction, an account and a budget row; confirm all three survive a reload and that IndexedDB has **zero** rows in `sync_outbox` and `sync_versions`.

- [ ] **Step 6: Commit**

```bash
git add src/db/database.ts src/sync/recorder.ts
git commit -m "fix(sync): gate local writes on version inside one exclusive lock"
```

---

### Task 4: A clock that never goes backwards

**Files:**
- Modify: `src/sync/hlc.ts:41-76` (`HlcClock`)
- Modify: `src/sync/engine.ts:381` (runtime construction) and `:543` (`observe` call site)

**Interfaces:**
- Consumes: `runExclusive` from Task 3.
- Produces: `new HlcClock(clientId: string, last: string | null, persist?: (hlc: string) => void)`; `observe(remote: string): void` now calls `persist` with the new high-water mark; `snapshot(): string` returns the current high-water HLC.

- [ ] **Step 1: Seed from the wall clock as well as the stored value**

In the constructor, take `Math.max(parsed.ms, Date.now())` so a stored value older than now still starts from now, and never below either.

- [ ] **Step 2: Persist on observe**

After advancing `this.ms`/`this.counter`, call `persist?.(formatHlc(this.ms, this.counter, this.clientId))`. Debounce inside the engine (at most once per second) rather than inside the clock.

- [ ] **Step 3: Wire the engine**

Construct with a debounced persist that writes `config.lastHlc = max(config.lastHlc, hlc)` then `writeSyncState('app', config)` — **only if larger**; a delayed write of an older value must be discarded. `loadSyncRuntime` passes `config.lastHlc`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: connect sync, let one device receive a change, reload **without making any edit**, then add a transaction. In DevTools → Application → IndexedDB → `sync_state`, `lastHlc` must be >= the received change's HLC, and the new outbox row's HLC must be lexicographically greater than every `sync_versions` value.

- [ ] **Step 5: Commit**

```bash
git add src/sync/hlc.ts src/sync/engine.ts
git commit -m "fix(sync): persist the observed HLC so reloads never regress"
```

---

### Task 5: Apply remote changes atomically and refresh the UI

**Files:**
- Modify: `src/sync/engine.ts:394-433` (`syncNow`), `:474-532` (`pullAll`, `snapshotPull`), `:536-583` (`applyRemote`), `:250-268` (`connectSync` join path)

**Interfaces:**
- Consumes: `runExclusive` (Task 3), `HlcClock` (Task 4), server `head` param and `changes` verdicts (Tasks 1–2).
- Produces: `applyRemote` runs its version read + entity write + version write inside `runExclusive`. `syncNow(): Promise<{ applied: number; error: string | null }>`. `snapshotPull` sends `head` from its first page on every subsequent page.

- [ ] **Step 1: Serialise the merge**

Wrap the body of `applyRemote` from `getVersion` through the final `putVersion` in `runExclusive`. The version compare and the write must not be able to interleave with a local write.

- [ ] **Step 2: Refresh on join**

In `connectSync`, after `snapshotPull(config)` and after the trailing `pullAll(config)`, call `applyHandler?.()` unconditionally — not only when `changed` is true. A joining device must repaint even though its cursor already sits at head.

- [ ] **Step 3: Refresh on every applied change**

Make `pullAll` and `snapshotPull` return the count of applied changes. In `syncNow`, replace `if (changed) applyHandler?.()` with: call `applyHandler?.()` when `applied > 0`, or when `applied === 0 && config.lastSyncAt === 0` (first sync of the session). Return `{ applied, error }`.

- [ ] **Step 4: Pin the snapshot head**

In `snapshotPull`, capture `head` from the **first** page's response and send `query.set('head', String(head))` on every subsequent page; after the loop set `config.cursor = Math.max(config.cursor, pinnedHead)`, then `await pullAll(config)` so changes that landed after the head are not skipped.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual, two browsers on one relay: device B connects while device A already holds 20 transactions. B must show all 20 **without a reload**. Then add a transaction on A and confirm B shows it within 10s.

- [ ] **Step 6: Commit**

```bash
git add src/sync/engine.ts
git commit -m "fix(sync): atomic remote apply and refresh after every applied change"
```

---

### Task 6: Publish rows that were written before the recorder existed

**Files:**
- Modify: `src/sync/engine.ts:295-334` (`seedLocal`), `:374-392` (`loadSyncRuntime`)

**Interfaces:**
- Consumes: `runExclusive`, `listOutbox`, `getVersion`.
- Produces: `export async function reconcileLocalRows(): Promise<number>` — returns how many rows were seeded; called at the end of `loadSyncRuntime` when sync is enabled.

- [ ] **Step 1: Extract the seeding loop**

Split the per-entity seed loop out of `seedLocal` into `reconcileLocalRows()`, which walks every domain store, and for each row without a version enqueues an outbox row and a version stamped by the clock (not an epoch).

- [ ] **Step 2: Call it on every boot**

At the end of `loadSyncRuntime`, after `configureRecorder`, `await reconcileLocalRows()` before `startLoop()`.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: disconnect sync, add a transaction, reload (still disconnected), reconnect to the same space; the transaction must appear on the other device.

- [ ] **Step 4: Commit**

```bash
git add src/sync/engine.ts
git commit -m "fix(sync): seed rows written before the recorder was configured"
```

---

### Task 7: Only forget a change the relay actually applied

**Files:**
- Modify: `src/sync/engine.ts:448-472` (`pushPending`)
- Modify: `src/sync/types.ts` (push response type)

**Interfaces:**
- Consumes: `changes` verdicts from Task 1.
- Produces: `interface PushResponse { accepted: string[]; duplicates: number; cursor: number; changes?: Array<{ changeId: string; applied: boolean; error?: string }> }`. `pushPending` sends the `x-budget-sync-acks: 1` header and removes only `applied` rows; unapplied rows are removed too **after** the subsequent pull has had a chance to fetch the winner (see Step 3).

- [ ] **Step 1: Send the opt-in header**

Add `'x-budget-sync-acks': '1'` to the push request headers (thread it through `request()`'s header argument).

- [ ] **Step 2: Remove only applied rows**

If `response.changes` exists, compute `appliedIds` and call `removeOutbox(appliedIds)`; leave everything else in place and do **not** loop again on the same batch (that would spin). If `response.changes` is absent, keep today's behaviour: `removeOutbox(batch.map(r => r.changeId))`.

- [ ] **Step 3: Re-pull after a losing push**

When any change in the batch has `applied === false`, set `config.cursor = Math.min(config.cursor, cursorAtBatchStart)` before returning, so the following `pullAll` in `syncNow` re-delivers the winning record. Record the batch start cursor at the top of `pushPending`.

- [ ] **Step 4: Isolate a poison row**

On a 4xx, retry the batch one record at a time. A record that still fails is appended to `sync_state.quarantined` (an array of `{ changeId, reason }`) and **not** retried again; the rest proceed. Skip quarantined changeIds when selecting the next batch.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: in DevTools, add a synthetic outbox row with `entityId: ''` (invalid). Confirm the queue drains every other row, Settings shows a quarantined count, and new local edits still sync.

- [ ] **Step 6: Commit**

```bash
git add src/sync/engine.ts src/sync/types.ts
git commit -m "fix(sync): drop outbox rows only when the relay applied them"
```

---

### Task 8: Fence the runtime and never clear domain data on connect

**Files:**
- Modify: `src/sync/engine.ts:190-289` (`connectSync`, `disconnectSync`)

**Interfaces:**
- Consumes: Task 5's `syncNow` return value.
- Produces: module-level `let generation = 0;` — every `connectSync`/`disconnectSync` increments it; `pullAll`, `snapshotPull` and `pushPending` take the generation they started with and return early without writing `config` or `sync_state` when it has changed.

- [ ] **Step 1: Add the generation counter**

Increment at the top of `connectSync` (after validation, before any await that writes) and in `disconnectSync`. Capture it in `syncNow` before `withLock` and pass it down.

- [ ] **Step 2: Refuse stale writes**

Before every `writeSyncState('app', config)` inside those three functions, `if (myGeneration !== generation) return;`. `applyRemote` must also no-op when the generation changed, so a stale pull cannot write entities either.

- [ ] **Step 3: Clear metadata only**

In `connectSync`, replace `if (runtime) await disconnectSync()` with a path that always calls `clearSyncStores()` (outbox, versions, state) whether or not a runtime existed — and never touches domain stores. `disconnectSync` keeps `clearSyncStores()`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: with 5 local transactions and no sync, connect to an existing space. Afterwards all 5 local transactions still exist locally **and** appear on the other device; no domain row was removed.

- [ ] **Step 5: Commit**

```bash
git add src/sync/engine.ts
git commit -m "fix(sync): fence in-flight syncs and preserve domain data on connect"
```

---

### Task 9: Background writers wait for the first attempt, not for success

**Files:**
- Modify: `src/state/store.tsx:327-361` (boot), `:365-443` (`catchUpRecurring`), `:489-502` (visibility effect)
- Modify: `src/sync/engine.ts` (expose the settle promise)

**Interfaces:**
- Produces: `export function whenInitialSyncSettles(): Promise<void>` in `engine.ts` — resolves on success, on failure, or after 2000 ms, whichever comes first, and is idempotent per session.

- [ ] **Step 1: Expose the settle promise**

Track a module-level `initialSettled: Promise<void> | null`. On first `syncNow`, set it to `Promise.race([syncPromise.catch(() => undefined), delay(2000)])`. `whenInitialSyncSettles()` returns it, or a resolved promise when sync is not configured.

- [ ] **Step 2: Gate the boot auto-run**

In `store.tsx`, the effect that calls `catchUpRecurring()` and `evaluateClosedMonths()` awaits `whenInitialSyncSettles()` first. Explicit calls from `TransactionDetail`, `RecurringDialog` and `SettingsView` are **not** gated.

- [ ] **Step 3: Move the readiness flag**

`setReady(true)` stays where it is, but the recorder must be configured before the catch-up effect can run — reorder the boot effect so `await loadSyncRuntime()` happens before `setReady(true)`, and remove the now-unnecessary gate if the ordering alone is sufficient.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: go offline (DevTools → Network → Offline), reload. Recurring transactions due today must appear within ~2s, and the app must not show a sync error that blocks usage.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.tsx src/sync/engine.ts
git commit -m "fix(sync): run catch-up after the first sync attempt even offline"
```

---

### Task 10: Keep the two halves of a transfer in agreement

**Files:**
- Modify: `src/sync/engine.ts` (new `reconcileTransfers`, called from `syncNow` after `pullAll`)
- Modify: `src/sync/recorder.ts` (shared-field comparison helper)

**Interfaces:**
- Produces: `function sharedTransferFields(t: TransactionDb): { date: string; notes: string; tags: string[]; cleared: boolean; magnitude: number }` and
  `export async function reconcileTransfers(): Promise<number>` — returns the number of legs repaired.

- [ ] **Step 1: Compare only the shared, sign-agnostic fields**

`magnitude` is `Math.abs(t.amount)`. Two legs agree when all five fields match. Nothing else may be compared.

- [ ] **Step 2: Repair by stamping the winner's HLC**

For each transaction with a `transferPairId`, load the partner. If the shared fields differ, write the loser's entity with the winner's shared fields, **mirroring the sign** and **swapping `accountId`/`transferAccountId`**, then `putVersion` with the **winner's** HLC (not a fresh one) via `runExclusive`. Both legs then carry the same HLC and neither device can keep declaring itself newer.

- [ ] **Step 3: Skip when already equal**

If the shared fields match, do nothing — no write, no HLC, so nothing is re-pushed and two devices cannot ping-pong.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: create a transfer, then in DevTools change one leg's `notes` and set its HLC lower than the partner's `sync_versions` entry. Reload; both legs must end with the same notes and opposite-signed amounts, and `sync_outbox` must be empty.

- [ ] **Step 5: Commit**

```bash
git add src/sync/engine.ts src/sync/recorder.ts
git commit -m "fix(sync): reconcile transfer pairs on shared fields only"
```

---

### Task 11: Poll like the user expects, and make failure visible

**Files:**
- Modify: `src/sync/engine.ts:335-372` (`wake`, `bindEvents`, `startLoop`)
- Modify: `src/sync/types.ts` (`SyncState`, `SyncStatus`)
- Modify: `src/state/store.tsx` (mutation hook + landing sync)
- Modify: `src/components/ProgressHud.tsx` (status dot)

**Interfaces:**
- Produces: `SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'degraded' | 'offline'`;
  `SyncStatus` gains `quarantined: number`, `skipped: number`, `fingerprint: string`;
  `export function noteLocalMutation(): void` in `engine.ts` — debounced 750 ms `syncNow()`.

- [ ] **Step 1: Widen the status model**

Add the new states and fields; keep `publish` merging partial patches.

- [ ] **Step 2: Add the triggers**

`bindEvents` also listens for `pageshow`. `startLoop` polls every **5000 ms** while `document.visibilityState === 'visible'`. `noteLocalMutation()` schedules one `syncNow()` 750 ms after the last local write; call it from the database layer's write path (it already has the sync writer, so call `writer.onLocalWrite?.()`).

- [ ] **Step 3: Sync on landing**

In `store.tsx`, the Transactions view mount calls `syncNow()` and, when sync is configured, refreshes from the database on completion.

- [ ] **Step 4: Show it**

`ProgressHud` renders a 6px dot: hidden when `idle`, accent pulse when `syncing`, amber when `degraded`, red when `error`, grey when `offline`. Add `title` text. Settings → Sync shows the full counters.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: open both devices, add a transaction on A, time it on B — must appear within 10s without touching B. Then kill the relay: the dot turns red within one poll and a toast appears.

- [ ] **Step 6: Commit**

```bash
git add src/sync src/state/store.tsx src/components/ProgressHud.tsx
git commit -m "feat(sync): poll on mutation, focus and interval; surface status"
```

---

### Task 12: Stop the service worker caching sync traffic

**Files:**
- Modify: `public/sw.js:74-115`

**Interfaces:**
- Consumes: nothing.
- Produces: no behavioural surface; sync requests bypass Cache Storage.

- [ ] **Step 1: Bypass cache for sync paths**

At the top of the fetch handler, before the cache-first branch:

```js
const url = new URL(event.request.url);
if (url.pathname.startsWith('/v1/sync/')) return;
```

- [ ] **Step 2: Verify**

Run: `pnpm build`. Manual: DevTools → Application → Cache Storage, load a synced page, confirm no `/v1/sync/` entry exists.

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "fix(pwa): never serve sync traffic from the service worker cache"
```

---

### Task 13: Settings payload freshness, skipped records and repair

**Files:**
- Modify: `src/sync/engine.ts` (`enqueueSettings`, `pullAll` skip handling)
- Modify: `src/views/SettingsView.tsx` (Sync card: counters + Repair action)

**Interfaces:**
- Consumes: `runExclusive` (Task 3), `SyncStatus.quarantined/skipped` (Task 11), `syncNow` (Task 5).
- Produces: `export async function repairFromSnapshot(): Promise<number>`; `sync_state.skipped` is `Array<{ changeId: string; reason: 'undecryptable' | 'unknown' }>`.

- [ ] **Step 1: Serialise settings from the persisted row**

In `enqueueSettings`, read the current settings entity from the database (`readEntity<Settings>('settings', 'app')`) at push time and serialise **that**, not the payload captured when the change was queued. A progress write must never republish a stale theme or currency.

- [ ] **Step 2: Record what cannot be applied**

In `applyRemote`'s catch for `decryptPayload`, append `{ changeId, reason: 'undecryptable' }` to `sync_state.skipped` and continue — the cursor still advances. Unknown entity kinds append `reason: 'unknown'`. Presence of skipped entries sets `state: 'degraded'`.

- [ ] **Step 3: Implement repair**

`repairFromSnapshot()` runs `runExclusive`: pull every snapshot page **with the version gate disabled** (`applyRemote(config, entity, { force: true })`), so drifted versions cannot reject the repair. Entities present locally but absent from the snapshot are kept and re-seeded via `reconcileLocalRows()` — never deleted. Then clear `sync_state.skipped` and re-publish status.

- [ ] **Step 4: Surface it**

Settings → Sync shows `Pending`, `Quarantined`, `Skipped` counts and a `Repair from snapshot` button, disabled while `state === 'syncing'`. If any skipped record is `undecryptable`, show "records encrypted with a different key — re-pair with the correct passphrase" and keep the button enabled.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: change the theme on device A and confirm device B's persisted settings row carries the new theme without touching progress; then hand-edit a `sync_versions` row to a future HLC and run Repair — the entity must be overwritten with the snapshot value and the counter must return to zero.

- [ ] **Step 6: Commit**

```bash
git add src/sync/engine.ts src/views/SettingsView.tsx
git commit -m "fix(sync): fresh settings payload, skipped-record ledger and snapshot repair"
```
