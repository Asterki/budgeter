# Project Overview

**Tasker** is a single-user, local-first todo and planning web app. It combines projects/categories/places, natural-language capture, subtasks, recurrence, calendar and roadmap views, gamified progress (XP, combos, streaks, achievements), JSON backup/restore, PWA offline support, and an optional end-to-end-encrypted sync relay between devices.

- **Target user:** an individual planning personal tasks. There is no team, sharing, or account concept.
- **Current state:** functional, deployed-looking MVP/newer release. `package.json` declares `1.0.0`, while Git history shows `App v0.0.1` and `App v0.0.2`; there are no automated tests, no linting, and no CI (see [Known Issues](#known-issues-and-tech-debt)).
- **Current gap vs. its own brief:** the notification/reminder engine described in `AGENTS.md` is **not present** in the code. README states the build is static with "no serverless functions, no cron jobs and no runtime secrets" (`README.md`), `vercel.json` has no `crons` block, there is no `api/` directory, and `src/db/database.ts` documents that the push-subscription store was removed in DB v3. See [Open Questions](#open-questions).
- **Naming caveat:** the repository folder is named `budget`, but the application is a todo app named Tasker. No budgeting domain code exists.

# Tech Stack

| Area | Choice | Source |
| --- | --- | --- |
| Language | TypeScript (strict), ES2022 | `tsconfig.app.json`, `tsconfig.node.json` |
| UI | React 18.3.1 + react-dom 18.3.1 | `package.json` |
| Icons | react-icons ^5.7.0 | `package.json` |
| Build/dev | Vite ^6.0.7, @vitejs/plugin-react ^4.3.4 | `package.json`, `vite.config.ts` |
| Package manager | pnpm 10.34.7 (Node >= 20) | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` |
| Persistence | Native IndexedDB (no wrapper library) | `src/db/database.ts` |
| Styling | Hand-written CSS with custom properties (GitHub Primer light/dark token sets) | `src/styles.css` |
| Auth | None in the app. Optional relay uses a passphrase-derived bearer key | `src/state/store.tsx`, `src/sync/engine.ts` |
| Hosting | Vercel static SPA | `vercel.json`, `README.md` |
| PWA | Custom service worker, web manifest, generated icons | `public/sw.js`, `public/manifest.webmanifest`, `scripts/generate-icons.py` |
| Optional sync server | Node 22, Express ^4.21.2, better-sqlite3 ^11.8.1, tsx ^4.19.2, Docker | `server/package.json`, `server/src/index.ts`, `server/Dockerfile` |
| Tests / lint | None configured | `package.json` scripts |

No state-management, routing, date, UI-component, or validation library is used; those concerns are implemented in the repo.

# Architecture

```
.
├── index.html                 App shell, theme/theme-color meta, manifest link
├── vercel.json                Vercel static deploy, SPA rewrite, cache headers
├── vite.config.ts             React plugin, env/build defines, SW build-id stamping
├── public/
│   ├── sw.js                  Custom offline-first service worker (build-id placeholder)
│   ├── manifest.webmanifest   Installable PWA metadata
│   └── icons/                 Generated PWA icons
├── scripts/generate-icons.py  Dependency-free PNG icon generator
├── src/
│   ├── main.tsx               React root, provider wiring, production SW registration
│   ├── App.tsx                Shell: navigation, keyboard shortcuts, desktop/mobile layout
│   ├── styles.css             Design tokens and all component styles
│   ├── domain/                Pure domain logic: types, parser, dates, recurrence, progress
│   ├── db/database.ts         IndexedDB schema, CRUD, mutation events, sync metadata, UUID migration
│   ├── state/
│   │   ├── store.tsx          TaskerProvider: all entities + mutations + backup/restore
│   │   ├── navigation.ts      View/scope selection types
│   │   └── hooks.ts           Debounce and media-query hooks
│   ├── views/                 Tasks, Calendar, Roadmap, Settings screens
│   ├── components/            Sidebar, TopBar, QuickAdd, TaskTree/TaskRow, detail panel, etc.
│   ├── sync/                  E2EE sync client: crypto, HLC, outbox recorder, engine
│   ├── pwa/serviceWorker.ts   Service-worker registration helper
│   └── docs/UserManual.tsx    Renders USER_MANUAL.md inside the app
└── server/                    Optional standalone sync relay (own pnpm workspace + Dockerfile)
```

**Main modules**

| Module | Responsibility |
| --- | --- |
| `src/domain/*` | Pure functions and types. No React, no IndexedDB. Parsing (`parser.ts`), local-date math (`date.ts`), recurrence (`recurrence.ts`), XP/achievements (`progress.ts`), autocomplete (`suggestions.ts`). |
| `src/db/database.ts` | Owns the IndexedDB schema, normalization/backfill, CRUD, mutation notifications, sync outbox/version/state helpers, deterministic legacy-ID → UUID migration. |
| `src/state/store.tsx` | Single React context. Loads a snapshot at boot, holds entity arrays in state, writes every mutation through to IndexedDB immediately, and composes higher-level operations (subtree completion, recurrence roll-over, project moves, backup/restore). |
| `src/views/*` | Screen-level composition and filtering. `TasksView` owns filtering/sorting/grouping; `CalendarView` and `RoadmapView` derive layouts from dates/lanes. |
| `src/components/*` | Reusable UI: quick-add composer with parse chips, task rows/tree, detail editor, bottom sheet, celebration/toast layer, progress HUD. |
| `src/sync/*` | Optional encrypted sync. Records local writes into an outbox via the DB mutation listener, exchanges HLC-stamped changes with the relay, and merges remote writes back into IndexedDB. |
| `server/*` | Optional relay: bearer-key auth, append-only change log plus per-entity latest state in SQLite, cursor/snapshot reads, CORS allowlist, rate limiting, retention purge. |

**Data flow (UI → storage)**

1. A view/component calls a context action such as `createTask`, `updateTask`, `toggleComplete`, or `updateSettings`.
2. `TaskerProvider` computes the new entity arrays and calls `db.tasks.putMany(...)` / `put` / `remove` (`src/state/store.tsx`). Writes are not batched or deferred except for the intentional ~220 ms completion animation delay in `TaskRow.tsx`.
3. `src/db/database.ts` writes the record(s) to IndexedDB and emits a mutation event through `setMutationListener`.
4. When sync is configured, `src/sync/recorder.ts` receives that event, clears any pending change for the entity, stamps a new HLC, encrypts the payload, and appends it to `sync_outbox`.
5. `src/sync/engine.ts` pushes outbox batches to the relay, pulls changes after its cursor, applies newer remote versions directly to IndexedDB with `writeEntitySilently`, then invokes the registered snapshot-reload handler so React state refreshes.

Local reads use `loadSnapshot()` (one transaction over all stores) at boot and after applying remote changes. There is no cache layer or query invalidation beyond that.

**Design patterns**

- Single provider + memoized action callbacks; refs mirror state to avoid stale closures in async work (`src/state/store.tsx`).
- Write-through persistence: React state is a mirror of IndexedDB, not a staging buffer.
- Pure domain functions separated from persistence/UI, with no shared "utils" module (an explicit constraint in `AGENTS.md`).
- Local-first with last-write-wins conflict resolution using hybrid logical clocks; per-entity tombstones; monotonic counters merged with `Math.max` (`src/sync/engine.ts`, `src/domain/progress.ts`).
- IndexedDB schema versioning with normalization on read for forward/backward compatibility (`src/db/database.ts`).

# Data Model

All client entities are defined in `src/domain/types.ts` and persisted in `src/db/database.ts`.

| Entity | Fields | Notes / relationships |
| --- | --- | --- |
| `Task` | `id`, `title`, `notes`, `projectId`, `parentId`, `place`, `priority`, `date`, `time`, `endDate`, `endTime`, `allDay`, `tags`, `lane`, `recurrence`, `completed`, `completedAt`, `seriesId`, `order`, `createdAt`, `updatedAt` | `priority: 1–4`; `date`/`endDate` are `YYYY-MM-DD`; `time`/`endTime` are `HH:mm`; `place` is a name (loosely coupled to `Place`); `tags` are names; `parentId` makes subtasks (unlimited depth); `seriesId` links recurrence occurrences; `allDay = !time` by default |
| `Project` | `id`, `name`, `color`, `categoryId`, `tags`, `order`, `createdAt` | Belongs to at most one `Category`; owns its own `Tag[]` |
| `Category` | `id`, `name`, `color`, `order`, `createdAt` | Groups projects; exactly one category per project (or none) |
| `Tag` | `id`, `name`, `color` | Stored embedded inside `Project.tags`; tasks reference tag *names* |
| `Place` | `id`, `name`, `createdAt` | Context/place vocabulary; tasks store the place name |
| `RecurrenceRule` | `freq`, `interval`, `byWeekday`, `byMonthDay`, `until`, `count` | `freq` is `daily`/`weekly`/`monthly`/`yearly`; weekdays are 0=Sun…6=Sat; embedded in `Task.recurrence` |
| `Progress` | `xp`, `totalCompleted`, `streak`, `bestStreak`, `lastCompletionDate`, `todayCount`, `todayDate`, `bestDayCount`, `combo`, `bestCombo`, `lastComboAt`, `checklistsCleared`, `unlocked`, `updatedAt` | Embedded in `Settings.progress`; game state is accumulated, not derived |
| `Settings` | `key` (`"app"`), `theme`, `defaultProjectId`, `progress`, `soundEnabled`, `hapticsEnabled` | One record; `theme` is `nordic-light` / `nordic-dark` |
| `BackupFile` | `app: "tasker"`, `version`, `exportedAt`, `categories`, `projects`, `places`, `tasks`, `settings` | JSON export/import format; current `BACKUP_VERSION = 3` (`src/state/store.tsx`) |

**IndexedDB schema** (`DB_NAME = "tasker"`, `DB_VERSION = 4`, `src/db/database.ts`):

| Store | Key / indexes | Purpose |
| --- | --- | --- |
| `tasks` | keyPath `id`; `byDate`→`date`, `byProject`→`projectId`, `byCompleted`→`completed` | Tasks |
| `categories` | keyPath `id` | Categories |
| `projects` | keyPath `id` | Projects (tags embedded) |
| `places` | keyPath `id` | Places |
| `settings` | keyless, single key `app` | Settings + progress |
| `sync_outbox` | keyPath `changeId`; `byEntity`→`[entityType, entityId]` | Pending encrypted changes |
| `sync_versions` | key `[entityType, entityId]` | Last applied local HLC per entity |
| `sync_state` | keyPath `key` | Sync config/cursor and migration marker |

**Sync server tables** (`server/src/db.ts`, SQLite via better-sqlite3):

| Table | Columns | Purpose |
| --- | --- | --- |
| `users` | `key_hash` PK, `head_seq`, `min_seq`, `created_at` | One row per passphrase-derived identity |
| `changes` | `seq` PK autoincrement, `user_id`, `change_id`, `client_id`, `entity_type`, `entity_id`, `hlc`, `deleted`, `payload`, `created_at`; unique `(user_id, change_id)` | Append-only change log for cursor pulls |
| `entities` | `user_id`, `entity_type`, `entity_id`, `hlc`, `deleted`, `payload`, `seq`; PK `(user_id, entity_type, entity_id)` | Latest state per entity for snapshots |

Entity types on the wire: `task`, `category`, `project`, `place`, `settings` (`server/src/db.ts`).

# Features and Screens

| Feature / screen | File path(s) | Status | Description |
| --- | --- | --- | --- |
| App shell + navigation | `src/App.tsx`, `src/state/navigation.ts` | Complete | Desktop rail + main pane + detail pane; mobile tab bar and FAB. Persistent view/scope selection. |
| Tasks view | `src/views/TasksView.tsx` | Complete | Scoped lists (Scheduled, Today, Upcoming, Inbox, All, Completed, Project, Category, Place), debounced search, priority/tag filters, sorting, grouping, subtask trees. |
| Calendar view | `src/views/CalendarView.tsx` | Complete | Month/week modes, multi-day span rendering, day panel with quick add. |
| Roadmap view | `src/views/RoadmapView.tsx` | Complete | Two-month timeline, lanes, zoom, overdue highlighting, undated backlog. |
| Settings / data / sync | `src/views/SettingsView.tsx` | Complete | Progress stats, theme, sound/haptics, category/project management, export/import/reset, sync setup, About. |
| Natural-language quick add | `src/components/QuickAdd.tsx`, `src/domain/parser.ts`, `src/domain/suggestions.ts` | Complete | Live parse chips + autocomplete for `#project`, `^category`, `@place`, `!priority`, `+tag`, dates/times/ranges/recurrence. |
| Task detail editor | `src/components/TaskDetail.tsx` | Complete | Notes, project, priority, place, start/end date/time, all-day switch, lane, project tags, recurrence, subtasks, duplicate/reschedule/delete. |
| Subtasks | `src/state/store.tsx`, `src/components/TaskTree.tsx` | Complete | Arbitrary depth; subtree completion, deletion, project moves, and completed roll-over on recurring parents. |
| Recurrence | `src/domain/recurrence.ts`, `src/components/RecurrenceEditor.tsx` | Complete | Daily/weekly/monthly/yearly with intervals, weekday/month-day sets, until/count exhaustion, occurrence roll-over. |
| Project tags | `src/state/store.tsx`, `src/views/TasksView.tsx`, `src/components/TaskDetail.tsx` | Complete | Per-project custom tag set; apply/remove from tasks. |
| Projects / categories / places | `src/components/Sidebar.tsx`, `src/App.tsx` | Complete (prompt-based admin UX) | Create/rename/recolour/delete/move via `window.prompt`/`confirm`; places auto-created from `@` tokens. |
| Progress / gamification | `src/domain/progress.ts`, `src/components/Celebration.tsx`, `src/components/ProgressHud.tsx` | Complete | XP by priority, combo multiplier, levels, streaks, 12 achievements, particles/toasts/chime/haptics, 6-second undo. |
| Backup / restore / reset | `src/state/store.tsx`, `src/views/SettingsView.tsx` | Complete | Versioned JSON download/upload; import refused while sync is connected; hard reset. |
| Offline PWA | `public/sw.js`, `src/pwa/serviceWorker.ts`, `public/manifest.webmanifest` | Complete | Installable, cache-first assets, network-first navigation fallback, build-id cache busting. |
| Optional encrypted sync | `src/sync/*`, `server/src/*` | Complete (opt-in, self/author-hosted) | Passphrase-derived E2EE, HLC LWW merge, cursor + snapshot recovery, 20 s polling. |
| Reminders / push notifications / cron | — | **Not implemented** | No `api/` handler, no `vercel.json` cron, no `web-push` dependency, no PushManager subscription flow, no `push` listener in `public/sw.js`. Removed in DB v3 per `src/db/database.ts`. |
| In-app user manual | `src/docs/UserManual.tsx`, `USER_MANUAL.md` | Complete | Renders the Markdown manual with a small purpose-built renderer. |
| Automated tests / lint / CI | — | Absent | No test runner, no ESLint/Prettier, no `.github/` workflows. |

**Keyboard shortcuts** (`src/App.tsx`): `n` new task, `/` or `Cmd/Ctrl+K` search, `1` Tasks, `2` Calendar, `3` Roadmap, `4` Settings, `t` Today, `?` manual, `Esc` close overlays. Shortcuts are suppressed while typing or when Alt is held.

# API / Integrations

**Internal (optional sync relay, `server/src/index.ts`)**

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe |
| `GET` | `/v1/sync/head` | Report space existence and head sequence (used to join vs. create) |
| `POST` | `/v1/sync/push` | Validate and append up to 200 changes; update latest entity state and head |
| `GET` | `/v1/sync/changes?since&limit` | Cursor pull; `410 resync_required` when the cursor predates retention |
| `GET` | `/v1/sync/snapshot?limit&afterType&afterId` | Keyset-paginated latest-state snapshot |

Auth is `Authorization: Bearer <derived-key>`; CORS is restricted via `CORS_ORIGINS`; requests are rate-limited in memory (240/min per key hash). Retention: 90 days.

**Third-party services/SDKs**

- No analytics, error reporting, payment, or cloud-database SDKs.
- Browser platform APIs only: IndexedDB, Service Worker/Cache API, Web Crypto (PBKDF2/HKDF/AES-GCM/SHA-1/SHA-256), WebAudio (chime), Vibration, Notifications are **not** used despite the brief.
- Vercel is the only hosting integration; `vercel.json` configures static output, SPA rewrite, and asset cache headers.
- `react-icons` supplies icons.

The app itself makes no network requests unless the user configures sync. There are no serverless functions in the Vercel deployment.

# State, Auth, and Config

**State management**

- A single React context, `TaskerProvider` (`src/state/store.tsx`), holds `tasks`, `categories`, `projects`, `places`, `settings`, plus `ready` and all mutation actions.
- Local component state covers view filters, selection, open panel, and drafts.
- Derived data is computed with `useMemo` (`useProjectMap`, `useTaskChildren`) and view-local helpers (`groupTasks`).
- Persistence is IndexedDB; there is no Redux/Zustand/React Query and no server cache.
- Sync status is a separate small external store in `src/sync/engine.ts` consumed with `useSyncExternalStore`-style subscription helpers.

**Auth**

- The app has no accounts, sessions, or auth middleware.
- Optional sync: passphrase (min 8 chars) → PBKDF2-SHA-256 (600k iterations, fixed salt) → HKDF splits a bearer auth key and an AES-GCM-256 key (`src/sync/crypto.ts`). The relay identifies a "space" solely by the hash of the auth key. There is no recovery mechanism; a forgotten passphrase means the space is inaccessible.

**Environment variables** (names only)

| Name | Scope | Purpose |
| --- | --- | --- |
| `VITE_SYNC_URL` | Client build | Optional default relay URL; prefills the Sync card |
| `VITE_APP_NAME` | Client build | Declared in `src/vite-env.d.ts`, not referenced anywhere else |
| `DB_PATH` | Relay runtime | SQLite file path (defaults under `data/`) |
| `PORT` | Relay runtime | HTTP port (defaults to 8787) |
| `CORS_ORIGINS` | Relay runtime | Comma-separated allowed browser origins |

Build-time constants injected by `vite.config.ts`: `__APP_VERSION__`, `__APP_MODE__`, `__BUILD_TIME__`.

**Feature flags:** none. User-facing toggles are persisted settings (`theme`, `soundEnabled`, `hapticsEnabled`), and sync is enabled per device by connecting a space.

# Dev Workflow

All commands below are exactly as defined in the repo.

**Frontend**

```bash
pnpm install          # README-recommended; do not use npm install
pnpm dev              # Vite dev server on http://localhost:5173
pnpm build            # typecheck app + node configs, then vite build → dist/
pnpm preview          # preview production build on port 4173
pnpm typecheck        # tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit
```

- No `test`, `lint`, or `format` scripts exist.
- Icons: `python3 scripts/generate-icons.py` (no third-party Python packages).
- Deploy: push to Vercel; `vercel.json` sets framework `vite`, output `dist`, and SPA rewrite.

**Optional relay**

```bash
cd server
pnpm install
pnpm dev              # tsx watch src/index.ts, port 8787
pnpm build            # tsc -p tsconfig.json → dist/
pnpm start            # node dist/index.js
pnpm typecheck
```

```bash
docker build -t tasker-relay ./server
docker run -v tasker-data:/data -p 8787:8787 tasker-relay
```

The root build does not build `server/`; it has its own `package.json`, lockfile, and workspace file.

# Conventions

- **Naming:** PascalCase components/types, camelCase functions/variables, `SCREAMING_SNAKE_CASE` constants, `useX` hooks, `db.<store>.<op>` persistence helpers, `entityType` values lowercase (`task`, `project`, …). Files are PascalCase for components/views and camelCase otherwise.
- **Organization:** domain logic in `src/domain`, persistence in `src/db`, orchestration in `src/state`, presentation in `src/views`/`src/components`. No generic shared-utility module, per `AGENTS.md`.
- **TypeScript:** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`; type-only imports use `import type`. Build fails on type errors.
- **Styling:** plain CSS in `src/styles.css`; CSS custom properties for colors/spacing/radii; theme switched by `data-theme` on `<html>`; responsive breakpoint at 860 px; mobile-first bottom-sheet interactions.
- **Dates:** local wall-clock dates stored as `YYYY-MM-DD` strings and times as `HH:mm`; no timezone or date library. All date math lives in `src/domain/date.ts`.
- **Error handling:** domain/persistence functions generally do not throw for expected cases; IndexedDB failures are caught and logged with `console.error` (`src/db/database.ts`). Sync uses a typed `HttpError` plus status strings (`off`/`idle`/`syncing`/`error`) surfaced in Settings. Backup import validates shape and returns user-facing status messages. UI confirmations use `window.confirm`; validation messages appear inline (QuickAdd, Sync card).
- **Immutability:** state updates build new arrays/objects; persistence writes are diffed before writing.
- **Testing approach:** none. Verification is manual plus `pnpm typecheck`/`pnpm build`.
- **Accessibility:** labeled controls, `aria-expanded`/`aria-selected` on comboboxes, keyboard-navigable suggestions, focus management in sheets/popovers, reduced-motion handling in celebrations.

# Known Issues and Tech Debt

- **Notification engine absent.** `AGENTS.md` requires a Vercel cron every minute calling `/api/check-reminders`, a `web-push` serverless handler with VAPID keys, PushManager subscription stored in IndexedDB, and a `push` listener in the service worker. None exist: no `api/` directory, no `crons`/`functions` in `vercel.json`, no `web-push` dependency, no subscription UI, and `public/sw.js` has no `push` or `notificationclick` handler. `src/db/database.ts` explicitly says reminders were removed in v3, and `README.md` says the build has no serverless functions or cron jobs.
- **Design-doc drift.** `AGENTS.md` asks for a Nordic/ice-blue aesthetic; `DESIGN.md` is titled "GitHub Visual Identity Guidelines" and the CSS implements GitHub Primer light/dark tokens. Theme values are still named `nordic-light`/`nordic-dark` but Settings labels them "GitHub Light"/"GitHub Dark" (`src/views/SettingsView.tsx`).
- **Uncommitted rename.** Git status shows deleted `DESIGN.Md` and untracked `DESIGN.md`, i.e. a case-only rename not yet committed.
- **No tests, linting, formatting, or CI.** No test files and no `.github/` workflows; `pnpm build` is the only automated gate.
- **Dead API surface.** `reorderTask` and `deletePlace` are exposed by `TaskerProvider` but have no call sites in views/components.
- **Duplicated defaults.** `DEFAULT_SETTINGS` in `src/domain/types.ts` inlines a full zeroed `Progress` object instead of reusing `EMPTY_PROGRESS`, so the two can drift.
- **Fragile write diffing.** `commitTasks` detects changed tasks by array index (`next.filter((task, index) => task !== prev[index])`). This relies on callers preserving array length and order; recurrence appends, but a future reorder/filter before commit could silently skip writes.
- **Timezone mismatch in charts.** `completionsByDay` buckets `completedAt` with `toISOString().slice(0, 10)` (UTC) while the rest of the app uses local dates, so completions near midnight can land on the wrong day (`src/domain/progress.ts`).
- **Tag cleanup on project moves.** `withPatch` clears `tags` on descendants moved to another project but not on the moved task itself, which can leave task tags that no longer exist in the destination project.
- **Blocking admin dialogs.** Creating/renaming/deleting projects and categories uses `window.prompt`/`confirm`/`alert` (`src/App.tsx`, `src/views/SettingsView.tsx`), which is functional but poor on mobile.
- **Sync/privacy trade-offs.** The relay identifies spaces purely by a passphrase-derived hash (no recovery); the in-memory rate limiter resets on restart and is per-process; CORS defaults to the author's domain (`https://tasker.asterki.xyz`) when `CORS_ORIGINS` is unset; `changes`/`entities` use a global autoincrement sequence shared across users; retention purge is 90 days and a stale cursor forces a full snapshot.
- **No relay deployment automation.** `server/` is excluded from the root build and has no CI/CD, health monitoring, or migrations (schema is created with `CREATE TABLE IF NOT EXISTS`).
- **README/AGENTS mismatch.** `AGENTS.md` describes entering a project name ("UNAH") with `#UNAH` and auto-creating missing projects; the parser does support unknown project names for creation (`src/domain/parser.ts`, `resolveProjectId`), but the shipped docs and tests of that path are manual only.
- **Place orphans.** Deleting/retyping places can leave tasks referencing a place name with no `Place` row (and `deletePlace` is unused), so place lists can drift from stored task values.
- **Unused env declaration.** `VITE_APP_NAME` is typed but never read.
- **Folder naming.** The repository directory is `budget`, unrelated to the app's purpose; no budgeting features exist.

# Gaps for a Budgeting App

This repo is a todo app, but several pieces are reusable if it becomes a budgeting app.

| Budgeting need | Existing reusable piece | Gap |
| --- | --- | --- |
| Accounts | `Project`/`Category` grouping, `Place` vocabulary, per-entity colors/order | No account entity, balances, or institutions |
| Transactions | `Task` with `date`, `time`, `notes`, `place`, `tags`, `completedAt`; `TaskRow`/`TaskDetail` editing; `TasksView` filters/sorting | No amounts, debit/credit, payee, transfer, split, or reconciliation |
| Categories | `Category` + nested `Project` + per-project tags | Categories are organizational only; no spend classification rollups |
| Budgets | `RecurrenceRule`, date helpers (`monthMatrix`, `startOfMonth`, `spanDates`), progress bars | No budget amounts, periods, limits, or remaining/overspend calculations |
| Reports | `completionsByDay` 14-day bar chart in `SettingsView`, `ProgressHud`, roadmap/calendar layouts | No aggregation engine, no money formatting, no report routes |
| Recurring items | Full recurrence engine (`src/domain/recurrence.ts`) with intervals, weekday/month-day sets, until/count | No recurring-amount/next-due generation tied to balances |
| Currency | None | No currency type, formatting, locale, or multi-currency handling |
| Import / export | Versioned JSON `buildBackup`/`restoreBackup`, validation, UI controls | No CSV import (bank statements), no amount mapping, no dedupe |
| Charts | Hand-rolled SVG/div charts (`ProgressHud`, `SettingsView`), calendar matrix, roadmap timeline | No charting library, no time-series of money, no category breakdowns |
| Sync | E2EE HLC relay, outbox, snapshot recovery, per-entity merge | Entity types are todo-specific; money fields and merges would need schema/version work |
| Auth / multi-user | None (single-user by design) | No accounts, sharing, permissions, or household support |

Absent entirely: monetary amounts, accounts, transactions, budgets, currency, reporting, CSV import, and multi-user/ledger concepts.

# Open Questions

1. **Notifications:** `AGENTS.md` mandates the Vercel cron + `web-push` reminder engine, but it is absent from `vercel.json`, `public/sw.js`, and the codebase, and `README.md` says the build has no serverless functions or cron. Was removing it intentional, and should `project.md` treat it as out of scope?
2. **Product stage:** is this a production app (version `1.0.0`) or an MVP (Git history says `v0.0.1`/`v0.0.2`)? No release tags exist.
3. **Design authority:** should the visual identity follow `AGENTS.md`'s Nordic/ice-blue brief or `DESIGN.md`/`styles.css`'s GitHub Primer look? Should the `DESIGN.Md` → `DESIGN.md` rename be committed?
4. **Repository purpose:** the folder is named `budget` while the app is Tasker. Is this repo intended to become a budgeting app, or was it cloned into a misleading directory?
5. **Unclear ownership:** who is the intended target user (individual, student, professional)? No persona or analytics exist to confirm.
6. **Sync hosting:** is `https://tasker-api.asterki.xyz` (hardcoded fallback in `SettingsView.tsx`) the canonical relay, and is it actively deployed? Should the fallback be configurable/removed?
7. **Relay maintenance:** is `server/` intended to stay in this repo and be production-supported (no CI, no migrations, no monitoring currently)?
8. **Dead APIs:** are `reorderTask` and `deletePlace` intended for a future UI, or should they be removed?
9. **Missing quality gates:** are tests, linting, and CI intentionally omitted, or planned? `AGENTS.md` forbids extensive tests, but no minimal smoke checks exist.
10. **Data/privacy expectations:** is the 90-day relay retention and passphrase-only identity acceptable, or is account recovery/rotation required?
11. **Native dialogs:** is the `window.prompt`/`confirm` admin UX acceptable long-term, or should it be replaced with proper in-app forms?
12. **Localization/currency:** no i18n or formatting layer exists. Is single-locale (English, 12-hour times) the intended scope?
