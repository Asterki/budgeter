# Budget

A local-first, offline-capable personal budgeting app. Budget is a TypeScript
single-page application deployed to Vercel as static files, with a custom service
worker for offline use.

There is **no account and no login**. Every record lives in the browser's
IndexedDB, and the app works with no network at all. If you want more than one
device, an optional self-hosted relay syncs encrypted changes in the background.

> **Current state:** Stage 10 — a daily-drivable ledger. Accounts, categories,
> payees, transactions, budgets, recurring rules, categorization rules and
> progress live in IndexedDB; you can record expenses, income and transfers,
> capture from one line of text, import and export CSV, set monthly category
> limits with rollover, schedule repeating transactions, browse the calendar,
> forecast balances, read SVG reports, mask balances, and earn XP and 18
> achievements. Money is stored as integer minor units and formatted only for
> display. The JSON backup format is version 5 and restores the whole app.
> 
> 📖 [`USER_MANUAL.md`](./USER_MANUAL.md) explains the layout, syntax, imports,
> backups and sync.

---

## Features

| Area | What you get |
| --- | --- |
| Accounts | Add, rename, recolour, set an opening balance, change type, archive. Header shows net worth and each account balance. |
| Ledger | Date-grouped list with daily totals, per-account running balance, and daily net totals |
| Capture | Expense / income / transfer editor with keypad-friendly amount entry, payee autocomplete, category, date, tags, notes and cleared flag |
| Search | Debounced search across payee, notes, tags and amount, plus date range, category, account, tag and cleared filters, and four sort orders |
| Navigation | All transactions, each account, each category group, uncategorized, and payee search |
| Categories | Groups and expense/income categories with colours, archiving, and reassign-then-delete |
| Transfers | Creates two linked rows atomically; deleting either side removes both |
| Storage | IndexedDB, fully offline, versioned JSON export / import / reset |
| CSV | Import with column mapping, date-format detection, duplicate skipping and payee-default categories; export the current filtered ledger |
| Rules | Contains-text payee rules assign categories in quick add and CSV import |
| Privacy | Hide-balances toggle masks amounts in the header, ledger and account lists |
| Sync | Optional end-to-end encrypted relay sync across devices (your own server), configured in Settings → Sync |
| Progress | XP for logging and reconciling, quick-log combos, daily streaks, levels, 18 achievements, toasts with optional chime and haptics |
| Month review | Closed months are evaluated on boot for under-budget, zero-based, budget-master and savings rewards; each month pays once |
| PWA | Installable, custom `sw.js`, offline-first caching |
| Quick add | One-line capture such as `coffee 4.50 @Starbucks #Food`, with live chips and autocomplete |
| Budgets | Monthly limits per category, grouped by envelope, inline editing, rollover, copy last month, 3-month average, progress and overspend states |
| Scheduled | Recurring rules with pause/resume, skip next, edit and delete choices; due rows are generated on app open and when the tab becomes visible |
| Upcoming | The next 30 days of scheduled rows appear dimmed under “Upcoming” without being written to the ledger |
| Calendar | Month grid with per-day net spend, actual and planned dots, a day panel for transactions and date-scoped quick add |
| Forecast | Projected balance for the next 60 or 90 days from current balances and planned recurring items, with per-account lows and negative-day flags |
| Reports | Month, quarter, year or custom ranges: category donut, spending bars, income vs expense, net worth line, top payees and category trends, each with an accessible table fallback |

---

## Getting started

This project uses **pnpm**, pinned in `package.json` (`packageManager`) so local
builds and Vercel's build use the identical version.

```bash
pnpm install
pnpm dev           # http://localhost:5173
```

> Do not run `npm install` here. npm's dependency walker traverses pnpm's
> `node_modules/.pnpm` store, hits a package that depends on `workspace:*`, and
> aborts with `EUNSUPPORTEDPROTOCOL`. Vercel does the same thing if you force an
> install command, which is why `vercel.json` leaves install and build commands
> to Vercel's own package-manager detection.

### Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm build` | Typecheck, then produce `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm typecheck` | TypeScript only |
| `pnpm smoke` | Money, parser, budget, recurring, report, forecast, CSV, rules and import assertions |

The same checks run in CI (`.github/workflows/ci.yml`) on pushes to `main` and
on pull requests: frozen install, typecheck, smoke and build.

### Large ledgers

The ledger renders 200 rows at a time and appends on **Load more**, so a 20,000
transaction dataset stays responsive; filters, totals and reports still consider
the full filtered set.

---

## Deploying to Vercel

1. Import the repository. Vercel detects the Vite preset from `vercel.json`.
2. Optionally set `VITE_SYNC_URL` to your relay's public URL so the Sync card is
   pre-filled. Nothing else is required.

`vercel.json` handles the build output, the SPA rewrite and the cache headers.
The build is a static bundle: no serverless functions, no cron jobs and no
runtime secrets.

### Optional sync relay

Budget works completely without a server. Sync is opt-in and runs against the
small relay in [`server/`](./server) — a single Express process with SQLite.

- The passphrase is stretched in the browser (PBKDF2-SHA-256, 600k rounds); the
  relay only receives a derived authentication key and AES-GCM ciphertext.
- Budget uses its own salt and HKDF labels (`budget-sync-v1`), plus sync
  protocol 2 and schema 6. Reusing a Tasker passphrase cannot open the old
  space: the app detects the legacy space and asks for a new passphrase.
- The relay rejects Tasker entity types (`task`, `project`, `place`) and any
  request without the Budget protocol headers, with a clear error.
- Every change carries a hybrid logical clock, and merge is last-writer-wins
  per entity. Progress counters take the highest value, and counters added in
  later releases merge the same way.
- Both legs of a transfer sync independently; deleting either leg removes its
  partner locally and publishes a tombstone for it.
- Generated recurring rows use `SHA-256(ruleId + date)` as their id, so two
  devices catching up the same rule cannot create duplicate transactions.
- The relay stores an append-only log plus the latest entity per id, so devices
  catch up by polling. Tombstones are retained for 90 days.
- Budget queues changes in IndexedDB while offline and pushes them when the
  connection returns.

Run it locally:

```bash
cd server
pnpm install
pnpm dev        # http://localhost:8787
```

Build and run in production:

```bash
cd server
pnpm build
DB_PATH=/data/budget.db CORS_ORIGINS=https://your-app.example.com node dist/index.js
```

With Docker (the volume holds the SQLite file):

```bash
docker build -t budget-relay ./server
docker run -d --name budget-relay -p 8787:8787 \
  -v budget-data:/data \
  -e CORS_ORIGINS=https://your-app.example.com \
  budget-relay
```

Put it behind TLS, for example an nginx server block for
`sync.example.com` that proxies to `127.0.0.1:8787`. Then connect from
**Settings → Sync** with that URL and a long passphrase. The same passphrase on
another device joins the same space; the fingerprint shown on both devices must
match.

Losing the passphrase means the sync space cannot be recovered — there is no
account and no reset. Export a JSON backup as well if the data matters.

### Manual two-device check

Run this before shipping any sync change. Use two browser profiles (or one
normal and one private window) so IndexedDB is separate.

1. Start the relay with `CORS_ORIGINS` set to the app origin, and open the app
   in both profiles.
2. Device A: Settings → Sync, enter the relay and a fresh passphrase, then
   **Create space**. Device B: same URL and passphrase, then **Connect**.
3. Both fingerprints must match. Compare the last-sync timestamps after
   pressing **Sync now** on each device.
4. On A, create an account, a category group with two categories, a budget for
   the current month and an expense with a payee and tags. Confirm they appear
   on B after a sync.
5. Edit the same transaction on both devices; the later edit must win and no
   duplicate row may appear.
6. On A, create a transfer. Confirm both legs appear on B. Delete one leg on B
   and confirm both legs disappear on A after syncing.
7. Create a recurring rule due in the past on A. Confirm every due occurrence
   appears once on B, then reload B and confirm no duplicates.
8. With sync connected, try Import JSON on either device; it must be refused
   until you disconnect.
9. Point a device at a relay running the old Tasker build (or send no protocol
   headers); it must show the incompatible-protocol message, not partial data.
10. Disconnect on both devices and confirm the local ledger is unchanged.

---

## Architecture

```
budget/
├── public/
│   ├── sw.js                  custom service worker (offline caching)
│   ├── manifest.webmanifest   PWA manifest
│   └── icons/                 generated app icons
├── scripts/
│   └── generate-icons.py      dependency-free icon generator
├── server/                    optional sync relay (Express + SQLite)
│   ├── src/db.ts              schema, change log, snapshot queries
│   ├── src/index.ts           HTTP API, auth, CORS, rate limiting
│   └── Dockerfile
├── src/
│   ├── components/            UI building blocks (rail, rows, dialogs, editor…)
│   ├── db/database.ts         IndexedDB persistence layer (v6 schema, outbox)
│   ├── domain/                types, money, dates, ledger filters, budgets,
│   │                          recurrence, reports, forecast, CSV, rules, parser
│   ├── pwa/serviceWorker.ts   production service-worker registration
│   ├── state/                 React context store, hooks, navigation model
│   ├── sync/                  crypto, protocol version, HLC clock, recorder, engine
│   ├── views/                 Transactions, Budget, Calendar, Reports,
│   │                          Forecast, Settings
│   ├── App.tsx                shell: layout, shortcuts, overlays
│   ├── main.tsx               bootstrap + service-worker registration
│   └── styles.css             GitHub Primer design tokens and components
├── .github/workflows/ci.yml   typecheck, smoke and build on push/PR
├── vercel.json                static build, rewrites, headers
└── USER_MANUAL.md             user manual
```

### Design decisions

- **Local-first.** IndexedDB is the source of truth; every mutation is written
  through immediately, so closing the tab never loses work.
- **Subtasks became categories.** Every transaction belongs to one account and
  at most one category; categories roll up through category groups for budgeting
  and reports without a parallel hierarchy.
- **Integer money only.** Amounts are signed integer minor units in storage and
  arithmetic; `Intl.NumberFormat` is used only at the edge, with the currency and
  locale from settings.
- **No shared utility grab-bag.** Helpers live inside the domain that owns them
  (`domain/date.ts`, `domain/money.ts`, `domain/recurrence.ts`,
  `domain/reports.ts`) rather than in a generic `utils/` module.
- **Plain CSS with tokens.** The palette from `DESIGN.md` is expressed as CSS
  custom properties, so the light and dark themes stay in lockstep without a
  build-time CSS framework.
- **Planned work is derived.** Recurring rules roll forward on boot, but future
  occurrences are computed, never stored, so the ledger and forecast cannot
  diverge.

### Environment replacement

Vite loads `.env`, `.env.<mode>` and `.env.<mode>.local` natively for every
build mode, so deployment-specific values never need code changes.
`vite.config.ts` additionally inlines `__APP_VERSION__`, `__APP_MODE__` and
`__BUILD_TIME__` into the bundle so a running build can report exactly what it
is.

---

## Regenerating icons

```bash
python3 scripts/generate-icons.py
```

No image libraries required — the script writes PNGs directly.
