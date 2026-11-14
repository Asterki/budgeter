# Budget: tasker parity, mobile shell, and trustworthy sync

**Date:** 2026-11-13
**Status:** design, awaiting approval
**Scope:** `budget/` only. `tasker/` is the reference and must not be modified.

---

## 1. Intent

Budget and Tasker are the same app wearing different clothes, built by the same person for the same one person. Right now they don't feel related, and Budget's sync silently lets two devices disagree about what happened to your money.

Two problems, one owner, one user:

1. **Parity.** Muscle memory from Tasker has to work in Budget. Same shell, same placement of the primary action, same mobile gestures, same feedback vocabulary.
2. **Trust.** A ledger that can quietly show different data on two devices is worse than one that refuses to sync, because you'd believe the number.

The single user is the author. No accounts, no sharing, no accessibility work, no load engineering. The phone is the primary device.

### Why now

The mobile experience is the one that gets used daily, and it currently requires navigating a desktop shell to log a coffee. Meanwhile the sync bugs have had long enough to have already bitten.

---

## 2. Goals

- Opening Budget on a phone lands on **Transactions**, with the natural-language field focused and ready to type. No navigation, no tap.
- One tap to **Accounts** and **Budgets** from the bottom bar. Forecast, Reports, Calendar, Settings live one level deeper under **More**.
- Budget's desktop shell is structurally the same as Tasker's: top bar, left rail, workspace, right detail panel. Buttons are where Tasker puts them.
- Mobile uses a real draggable bottom sheet, not a bottom-aligned modal.
- Two devices converge within **10 seconds** while both are open, and immediately on focus/visibility change, and after any local edit.
- **Convergence is self-healing.** A device that has drifted must repair itself without the user doing anything.
- No existing data is lost: IndexedDB contents and existing relay spaces survive the migration.

## 3. Non-goals

- No multi-user, sharing, permissions, or conflict-review UI. It is a single-user LWW world.
- No accessibility work: no focus traps, no `aria-current` audits, no screen-reader pass. (Touch target sizes still matter — this is a phone app.)
- No battery/network throttling. Polling hard is fine.
- No test suites (repo policy).
- No new runtime dependencies.
- No change to `tasker/`.

## 4. Anti-goals

Things that would make this a failure even if it ships:

- A sync fix that requires resetting a device or re-pairing.
- A schema/protocol bump that makes an un-updated phone fail with `426` during the deploy window.
- A shell "refresh" that keeps the desktop layout and only restyles it.
- Hiding creation behind an overflow menu on mobile.
- Losing the existing natural-language parser or its suggestion UX — it is the favourite feature.

---

## 5. What the user decided

These are the user's calls, not mine:

- **10 second** convergence target.
- Sole user: no load concern, no accessibility concern.
- Thumb does two things: open → type; tap a bottom-bar destination.
- Bottom bar = the one-tap values. Everything else is "More > X".
- **Cold open is Transactions, every single time.** Never restore the last tab.
- Both apps must have the natural-language input bar.
- The relay server is theirs and can be redeployed.

## 6. Constraints

- Money stays integer minor units; format only at display with `Intl.NumberFormat`.
- Dates stay local `YYYY-MM-DD` strings. No timezone libraries.
- One React context in `src/state/store.tsx`; mutations write through immediately.
- Native IndexedDB only, versioned schema, normalization on read.
- pnpm, Node >= 20. `pnpm typecheck` and `pnpm build` must pass at the end of each stage.
- Theme ids stay `light` / `dark` (Budget's own contract). Only the *values* move toward Tasker's palette.

---

## 7. Current state: what's actually wrong

Measured from the three audits (Tasker shell, Budget shell, sync engine + relay).

### 7.1 Shell drift

Budget is not a reskin of Tasker; it is a different shell. The concrete gaps:

| | Tasker | Budget today |
|---|---|---|
| Breakpoint | `useMediaQuery('(max-width: 860px)')`, conditional **render** | no JS breakpoint at all; CSS-only, rail stays mounted and computes balances |
| Top bar | 2 controls: search trigger, HUD, add button | 10 controls: brand, net worth, account chips, HUD, search icon, `/` hint, balances toggle, theme, settings gear, add |
| Mobile add | 48px FAB above tab bar | **hidden entirely**; creation lives inside the "More" modal |
| Mobile detail | `BottomSheet`, drag-to-dismiss | centered modal that only *aligns* to the bottom |
| Detail panel (desktop) | 380px right column | none; always a modal |
| Rail | 248px, independent scroll | 272px, `min-height:100vh` so `overflow-y:auto` never engages |
| Tab bar | 4 equal cells, 60px + safe area, active = 2px accent inset | 5 cells, 58px, active = accent text |
| Nav order | one order | three competing orders (tab bar, shortcuts `1-7`, rail starting at Accounts) |
| Add affordance | one | three (`Add transaction`, `+ New`, empty-state CTA) |
| Padding | single 24px from workspace | several views add a second 24px inside workspace |
| Motion | tokenised + `prefers-reduced-motion` | 3 ad-hoc transitions, no guard |

The dead `useMediaQuery` in `src/state/hooks.ts` is the fingerprint of an abandoned port.

### 7.2 Sync: the two defects that explain the report

**Defect A — the joining device never refreshes.** `connectSync` writes the snapshot and pull into IndexedDB and advances `cursor` to the relay head, but never calls the store's `applyHandler`. Because the cursor is already at head, every subsequent poll finds `changed === false`, and `syncNow` only refreshes when `changed` is true. The device displays its pre-connect ledger indefinitely.

**Defect B — a race produces permanently divergent state.** `applyRemote` reads the version, then writes entity and version in separate transactions. The recorder writes its own version *without comparing*. Interleave a pull with a local edit and a device can hold entity X with version Y while the relay holds the HLC winner. The relay logs the losing push and returns 200 even though its entity upsert was rejected, so the client deletes the outbox row and the cursor moves past the winner. Nothing ever repairs it.

**Supporting defects** (each independently capable of loss):

- The HLC clock's observed time is never persisted; after a reload a device can mint timestamps lower than records it already holds, so its edits lose silently.
- Snapshot pagination takes a fresh `head` per page, then the client jumps `cursor` to the final head — changes that landed mid-pagination are skipped forever.
- Rows written before `configureRecorder` (recurring catch-up, closed-month evaluation, fast user actions) get no outbox row and no version, and seeding only ever runs at connect. They are never pushed.
- A single poison outbox row wedges the whole queue permanently.
- Transfer pairs are two independent LWW rows; only deletes cascade.
- Settings is a monolithic blob; any progress write republishes stale non-progress fields.
- The service worker can cache `/v1/sync/*` responses.

---

## 8. Design — Part A: shell parity

### 8.1 One shell, two chromes

Adopt Tasker's composition exactly:

```
.app                      flex column, height:100%
  header.topbar           52px, sticky, z 40
  .app__body              flex row, min-height:0
    nav.rail               248px          (desktop only)
    main.workspace         overflow-y:auto (the scroll container)
    aside.panel            380px          (desktop only)
  nav.tabbar              60px + safe area (mobile only), z 50
  button.fab              48px          (mobile only), z 55
  sheets / dialogs        z 90 / 100
```

Replaced in `App.tsx`:

- Introduce `const isMobile = useMediaQuery('(max-width: 860px)')` (the hook already exists and is currently unused) and **conditionally render** rail, panel, tab bar, FAB. Remove the `.rail{display:none}` CSS path so the rail stops computing balances on phones.
- `isMobile` drives which chrome wraps the same body. Detail and creation components keep one implementation; only the frame differs.

### 8.2 Top bar — two controls, not a dashboard

Left → right:

1. **Search trigger** — a fake input, bordered, `bg: var(--canvas)`, muted label "Search transactions", trailing `<kbd>/</kbd>`. Clicking it focuses the ledger filter input (navigating to Transactions first if needed).
2. Spacer.
3. **ProgressHud** pill (kept as-is; it is already close to Tasker's).
4. **Primary add** — `+ Add transaction` with `<kbd>n</kbd>`, far right, green.

Removed from the top bar, with new homes:

| Control | New home |
|---|---|
| Brand block | nowhere (delete; Tasker deliberately has no logo) |
| Net worth | Accounts view header + its own summary card |
| Account balance chips | Accounts view |
| `/` hint stays | part of the search trigger |
| Balances eye toggle | Settings → Appearance |
| Theme toggle | Settings → Appearance |
| Settings gear | rail footer only (and More on mobile) |

**Mobile top bar is the HUD pill only, right-aligned** — identical to Tasker. Search lives in the ledger's FilterBar; add lives on the FAB.

### 8.3 Rail

Order, single source of truth, mirroring Tasker's shape:

1. **Views** — All transactions, Today (planned for today), Upcoming, Uncategorized
2. **Accounts** — heading with inline `+`; active accounts with dot/name/balance; collapsed Archived group
3. **Categories** — group rows with their 3-category subtitle
4. **Payees** — search + top 12 by count
5. **Footer** — Settings

Active state: `background: var(--surface-variant); font-weight: 600`, 6px radius, no left bar. Counts right-aligned in mono. Fix scrolling with `height:100%; min-height:0` on the shell and `overflow-y:auto` on `.rail__scroll`.

One nav order only: the rail order above is canonical; the tab bar and numeric shortcuts derive from it, not from their own arrays.

### 8.4 Mobile shell — the two-gesture app

**Tab bar: four cells** (not five):

| Tab | Lands on |
|---|---|
| Transactions | the ledger (default, always) |
| Accounts | Accounts view |
| Budgets | Budget view |
| More | More view |

Cell: icon above a 12px label, active = `inset 0 2px 0 var(--accent)` plus weight 600. Height `calc(60px + env(safe-area-inset-bottom))`, `padding-bottom: env(safe-area-inset-bottom)`, grid `repeat(4, 1fr)`, `z-index: 50`.

**More** becomes a **view**, not a modal — so "More > Forecast" is two taps and the back gesture has somewhere to return to. Rows, in this order: Forecast, Reports, Calendar, Settings. (Calendar moves off the tab bar, per the user's model.)

**Cold open is Transactions, always.** No persistence of last view. `?action=add` still overrides.

**Zero-navigation capture.** The `QuickAdd` field is the first thing under the Transactions header on both desktop and mobile, and on a **cold launch** (mobile only) it takes focus so the keyboard is already up. It does **not** re-focus on later tab switches or when returning from a detail view — that would steal focus mid-task.

**FAB** — 48×48, accent, 6px radius, sitting `calc(60px + 16px + env(safe-area-inset-bottom))` from the bottom, z 55, opens the "New transaction" sheet. Retained alongside the inline field because you may add from Accounts or Budget without first navigating home.

**Workspace bottom padding** on mobile: `calc(60px + 96px)` so the last row clears both tab bar and FAB.

### 8.5 Bottom sheet — port Tasker's component

New `src/components/BottomSheet.tsx`, API-compatible with Tasker's:

```ts
interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  accent?: string;
}
```

Behaviour to reproduce exactly: unmounts when closed (no exit animation); backdrop `var(--overlay)` at z 100 with click-to-close; `max-height: 92vh`; 6px top corners; 32×4 grab handle; drag-to-dismiss on the grab zone using pointer capture, closing past 28% of height or 0.7 px/ms velocity; `Escape` closes; enter animation `sheet-up 240ms cubic-bezier(0.22,1,0.36,1)`; `padding-bottom: env(safe-area-inset-bottom)`.

Used for: New transaction, Transaction detail, More (if a sheet is wanted later), User manual, and every dialog's mobile presentation.

### 8.6 Dialogs

One `Dialog` component, two chromes:

- **Desktop:** centered modal, `min(460px, 100%)`, 6px radius, `max-height: 86vh`, header strip on `--canvas-subtle` with an X. Backdrop click and Escape close.
- **Mobile:** the same body inside `BottomSheet` — grab handle, drag to dismiss.

Convention, unchanged from Budget because it is correct and Tasker has no equivalent form: **footer right-aligned, `Cancel` then the primary action**. Destructive actions stay in a separated `.dialog__danger` block in the body, never in the footer. `ConfirmDialog` (Cancel + danger) for deletes.

The three-button rule-delete dialog is collapsed to the standard two-button confirm.

### 8.7 Views

All views share `<section className="view">` + `<header className="view__header">` (space-between, `align-items: flex-end`, 8px bottom padding, 1px bottom border), `h1.view__title` 24px/600, `p.view__subtitle` 14px muted. Content column `max-width: 1280px`, padding 24px, 80px bottom. Remove the per-view double padding and the four different max-widths.

**Transactions** — header: title + count subtitle on the left; scope select on the right (mobile only, replacing the rail). Then `QuickAdd`, then `FilterBar`, then day groups. Remove `+ New` (redundant) and remove `CSV` from the header (it already exists in Settings → Data). Empty state is a dashed-border card with a one-line hint, matching Tasker.

**Accounts** — header: title + subtitle, `+ Add account` primary on the right; net-worth summary card; one-column card grid at mobile.

**Budget** — header: title + summary, month pager, stat cards (4 → 2 at mobile), rows. Bulk actions stay as secondary buttons under the header. Add no "add" button (there is no such entity).

**Forecast / Reports** — read-only, header + toolbar only. No change beyond tokens, spacing, and the shared header.

**Calendar** — unchanged except it now lives under More.

**Settings** — cards keep their order; the Appearance card absorbs the theme and balances toggles that left the top bar. Sync card gains the reliability surface described in §9.7.

### 8.8 Tokens

Keep Budget's theme ids and palette *values* mostly, but add the missing primitives Tasker relies on:

- Add `--radius-lg: 6px`, `--accent-bg`, `--secondary`, `--shadow-sm/md/lg`, `--accent` distinction from `--primary`.
- Align chrome: `--topbar-height: 52px`, `--tabbar-height: 60px`, `--rail-width: 248px`.
- Dark `--on-surface: #c9d1d9` (currently `#e6edf3`), dark `--primary: #1f883d`, `--primary-hover: #238636` — matching both Tasker and Budget's own `DESIGN.md`.
- Replace inline shadow literals with the tokens.
- Add a single `@media (prefers-reduced-motion: reduce)` block that neutralises transitions and animations.

### 8.9 Feedback and layering

- **Toasts:** app-level layer at z 320, top-center under the top bar, 6px radius, max 3, auto-dismiss 3.6s. Replaces the ad-hoc `.notice`/`window.alert` mix. Sync failures surface here, not only in Settings.
- **Undo pill:** bottom-center, 6s, for deletes.
- **Z ladder:** topbar 40, suggest 45, tabbar 50, FAB 55, HUD 60/61, modal 90, sheet 100, toasts 320. (Fixes reward toasts being hidden behind modals.)
- **Loading:** keep the single boot screen. Mutations stay optimistic write-through with no spinners.

---

## 9. Design — Part B: sync you can trust

### 9.1 Principle

Per-entity last-writer-wins by HLC is sufficient for one user. The fix is not a better algorithm; it is making the bookkeeping **atomic, acknowledgable, and self-repairing**.

Three invariants:

1. **A device never stores a version older than one it already accepted.**
2. **A queue entry is removed only when the relay says its write was actually applied**, not merely logged.
3. **After any successful sync, the UI reflects the database.**

### 9.2 Ordering of work

Server first, client second. The server must accept both current and patched clients so the deploy window is safe for an un-updated phone.

### 9.3 Server changes (backward compatible, no schema bump)

`server/src/`:

1. **Report applied vs accepted.** In `POST /v1/sync/push`, after each `upsertEntity` (which is gated on `excluded.hlc > entities.hlc`), re-read the entity's HLC and compare to the change's HLC. Return `changes: [{ changeId, applied: boolean }]` alongside the existing `accepted` / `duplicates` / `cursor` fields. Current clients ignore the extra field; patched clients use it. No migration, no protocol bump.
2. **Pin the snapshot head.** Accept an optional `head` query param on `GET /v1/sync/snapshot`; when present, serve that head instead of the current one. Current clients omit it and get today's behaviour.
3. **`Cache-Control: no-store`** on every `/v1/sync/*` response.
4. **Do not 400 the whole batch for one bad record.** Validate per change and return per-change `{ changeId, error }`, still applying the valid ones.
5. Keep `schema: 6`, `protocol: 2`, existing tables, existing retention.

### 9.4 Client: close the divergence

`src/sync/` and `src/db/database.ts`:

1. **Atomic apply.** `applyRemote` performs version-compare, entity write, and version write inside **one** IndexedDB `readwrite` transaction spanning `[entityStore, sync_versions]`. The gate becomes a true compare-and-set.
2. **Monotonic recorder.** The recorder's version write only proceeds if `newHlc > storedHlc`. Local writes and remote applies for the same entity serialize through a per-entity async lock (`withEntityLock(entityType, entityId, fn)`) so they cannot interleave across the transaction boundary.
3. **Outbox removal on acknowledgement.** `pushPending` deletes outbox rows only where `applied === true`. Where `applied === false`, the row is dropped *and* the winner is fetched by pulling from `cursor` (which still precedes that change) — the existing pull does this, provided we do not advance past it.
4. **Persist the observed clock.** `observe()` updates `config.lastHlc` monotonically and writes it (debounced, at most once per second) so a reload never restarts the clock below records already held. `HlcClock` initialises to `max(persisted, wall clock)`.
5. **Refresh after every applied change.** `syncNow` invokes `applyHandler` whenever `applied > 0` **or** when this is the first sync of the session. `connectSync` invokes it unconditionally after `snapshotPull` and after the follow-up `pullAll`.
6. **Pinned snapshot + tail pull.** `snapshotPull` takes `head` from page 1, passes it on every page, sets `cursor` to that head, then runs `pullAll` to pick up anything after it.
7. **Boot reconciliation.** After `loadSyncRuntime`, scan every domain store for rows with no version and seed them (outbox + version). Fixes the class of rows written before the recorder was wired.
8. **Gate background writers.** `catchUpRecurring` and `evaluateClosedMonths` run only after the first sync of the session completes (`initialSyncDone`), so they never race the initial pull and never stamp stale HLCs.
9. **Poison isolation.** On a 4xx for a batch, retry per record; a record that still fails is quarantined into `sync_state` (not deleted, not retried) and the queue continues. Surface the quarantine count in Settings.
10. **Disconnect fencing.** `connectSync`/`disconnectSync` bump a generation token; an in-flight `pullAll`/`pushPending` from an older generation may not write `sync_state`, `cursor`, or entities. `connectSync` always clears leftover store content when starting a new space, whether or not a runtime existed.
11. **Transfer pair reconcile.** After each successful sync, a repair pass compares the two legs of every transfer pair and copies the newer leg's fields to the older one. Deletes keep their existing cascade, extended to fire even when the receiving leg is absent but a local orphan with the same `transferPairId` exists.
12. **Settings payload freshness.** Push serialises settings from the **currently persisted** row, not from the captured snapshot, so a progress write cannot republish a stale theme/currency.
13. **Skipped records.** Unknown or undecryptable changes advance the cursor (to avoid a wedged loop) but record `{changeId, reason}` in `sync_state.skipped`; the presence of skipped records sets status to `degraded` and enables a "Repair from snapshot" action.

### 9.5 Polling

Replace the current scheduler with the user's expectation:

- **Interval:** every 5 s while the document is visible (belt-and-braces under the 10 s target).
- **Triggers:** mount of the shell, `focus`, `visibilitychange` → visible, `pageshow`, `online`, and **after every local mutation** (debounced 750 ms).
- **Landing page:** entering Transactions always triggers a sync and a refresh.
- **Manual:** "Sync now" returns a result and surfaces it, instead of resolving silently.

All triggers funnel into the existing single-flight `syncPromise`, so overlapping wake-ups coalesce.

### 9.6 Service worker

Exclude `/v1/sync/` (and the configured relay origin) from the cache-first branch in `public/sw.js`. Sync GETs are never served from Cache Storage.

### 9.7 Observable state

`SyncStatus` gains: `state: 'idle' | 'syncing' | 'error' | 'degraded' | 'offline'`, `pending`, `lastSyncAt`, `error`, `quarantined`, `skipped`, `fingerprint`.

Surfaced in two places:

- A small **top-bar indicator** (a dot on the HUD, non-blocking) that turns amber on `degraded` and red on `error`, so a failing ledger is never invisible while you're reading it.
- Settings → Sync, with the full detail and the **Repair from snapshot** action.

Toasts fire on sync error and on recovery from a degraded state.

---

## 10. Data safety and migration

- **No IndexedDB reset.** Schema version stays 6 unless a new store is genuinely needed; `sync_state` gains fields, which is additive and tolerated by the existing normalize-on-read.
- **No relay reset.** Tables, `seq`, `min_seq`, and the `entities` table are untouched. The only server change is response shape and an optional query param.
- **No schema/protocol bump.** An un-updated phone keeps working against a redeployed server and vice versa.
- **Backup nudge:** the Settings → Data card gains one line recommending a JSON export before the update, and the export button stays adjacent. Export/import round-trip must keep working unchanged.
- **Rollback:** reverting the server alone is safe (extra response fields are additive). Reverting the client alone is safe (it re-reads the old response fields).

---

## 11. Build order

Server and shell work do not overlap, so they can proceed independently.

1. **Server: acknowledgement + pinned snapshot + no-store + per-change errors.**
2. **Client sync correctness:** atomic apply, monotonic versions, persisted HLC, outbox on `applied`, refresh-after-apply, boot reconciliation, gated background writers.
3. **Client sync hygiene:** pinned snapshot/tail pull, poison isolation, disconnect fencing, transfer reconcile, settings freshness, skipped records.
4. **Polling + status surface.**
5. **Shell:** `isMobile`, conditional chrome, rail order, top bar reduction, tab bar, More view, FAB, cold-open focus.
6. **Sheet + dialog unification.**
7. **Tokens, feedback layer, per-view cleanup.**

Each stage ends with `pnpm typecheck` and `pnpm build`; the app must boot with no console errors.

---

## 12. Calls I'm making (check these while reading)

1. **Four tabs, Calendar demoted to More.** Follows your stated "More > Forecast" model. If Calendar is used more than Budget, the bar is easy to reorder.
2. **FAB kept alongside the autofocused inline field.** Autofocus covers cold-open logging; the FAB covers adding from Accounts/Budget. Both are one gesture.
3. **`+ New` and `CSV` removed from the ledger header.** They duplicate the top-bar add and Settings → Data. Fewer competing add buttons is the whole point.
4. **Brand/net-worth/account chips leave the top bar.** Net worth and balances move to Accounts, not deleted.
5. **Dialog footer stays `Cancel` → primary.** Tasker has no equivalent (its edits are instant), so there was nothing to copy; the existing order is conventional and safe.
6. **Keep `light`/`dark` theme ids**, change only values. Renaming to `nordic-*` would orphan saved settings.
7. **Interval 5 s, not 10 s.** You asked for "updated in 10 seconds"; polling at half the budget keeps you under it with margin.
8. **No accessible-name/keyboard work beyond what already exists.** Explicitly your call.
9. **Server deploy is required for full correctness**, but the client fixes alone remove the two observed failure modes; the server change closes the "acknowledged but not applied" gap.

## 13. Left to the builder

- Exact file-by-file refactor shape and any interim component naming.
- Whether `More` is a route in the existing `NavSelection` union or a distinct view key (I'd use the existing union).
- Precise CSS organisation when the ad-hoc rules are consolidated (single file, sectioned).
- Exact wording of the new empty states, hints, and sync messages.
- Whether to keep the `?action=add` deep link (I'd keep it).
