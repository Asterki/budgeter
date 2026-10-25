# Tasker

A local-first, offline-capable todo and planning app. Tasker is a TypeScript
single-page application deployed to Vercel as static files, with a custom service
worker for offline use.

There is **no account and no login**. Every task, project, category, tag, place
and setting lives in the browser's IndexedDB, and the app works with no network
at all. If you want more than one device, an optional self-hosted relay syncs
encrypted changes in the background.

> 📖 The full user manual lives in [`USER_MANUAL.md`](./USER_MANUAL.md) and is
> also rendered inside the app under **Settings → Open user manual** (or `?`).

---

## Features

| Area | What you get |
| --- | --- |
| Structure | Categories → projects → tasks → subtasks (nested to any depth) |
| Capture | Inline natural-language parsing with live preview chips (`@place`, `!1`, `#Project`, `^Category`, `+tag`, dates, times, ranges, recurrence) and a trigger-driven autocomplete dropdown |
| Views | Scheduled (all dated tasks grouped by day), Tasks (debounced filter, sort, group), Calendar (multi-day spans, month/week), Roadmap (lane timeline, week/day zoom) |
| Metadata | Priority 1–4, places, start/end dates, start/end times, all-day vs. micro-scheduled timeframes |
| Recurrence | Daily / weekly / monthly / yearly plus custom intervals, weekday picks, day-of-month, end date, occurrence cap |
| Rewards | XP with a combo multiplier, levels, streaks, 12 achievements, daily milestones, and a 6-second Undo on every completion |
| Feedback | Particle bursts at the checkbox, optional chime, haptic patterns, and toasts — all respecting `prefers-reduced-motion` |
| Storage | IndexedDB, fully offline, JSON export / import / reset |
| Sync | Optional end-to-end encrypted relay sync across devices (your own server) |
| PWA | Installable, custom `sw.js`, offline-first caching |

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

---

## Deploying to Vercel

1. Import the repository. Vercel detects the Vite preset from `vercel.json`.
2. Optionally set `VITE_SYNC_URL` to your relay's public URL so the Sync card is
   pre-filled. Nothing else is required.

`vercel.json` handles the build output, the SPA rewrite and the cache headers.
The build is a static bundle: no serverless functions, no cron jobs and no
runtime secrets.

### Optional sync relay

Tasker works completely without a server. Sync is opt-in and runs against the
small relay in [`server/`](./server) — a single Express process with SQLite.

- The passphrase is stretched in the browser (PBKDF2-SHA-256, 600k rounds); the
  relay only receives a derived authentication key and AES-GCM ciphertext.
- Each entity is a UUID. Every change carries a hybrid logical clock, and merge
  is last-writer-wins with tag union for tasks and projects.
- The relay stores an append-only log plus the latest entity per id, so devices
  catch up by polling. Tombstones are retained for 90 days.
- Tasker queues changes in IndexedDB while offline and pushes them when the
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
DB_PATH=/data/tasker.db CORS_ORIGINS=https://tasker.asterki.xyz node dist/index.js
```

With Docker (the volume holds the SQLite file):

```bash
docker build -t tasker-relay ./server
docker run -d --name tasker-relay -p 8787:8787 \
  -v tasker-data:/data \
  -e CORS_ORIGINS=https://tasker.asterki.xyz \
  tasker-relay
```

Put it behind TLS, for example an nginx server block for
`tasker-api.asterki.xyz` that proxies to `127.0.0.1:8787`. Then connect from
**Settings → Sync** with that URL and a long passphrase. The same passphrase on
another device joins the same space; the fingerprint shown on both devices must
match.

Losing the passphrase means the sync space cannot be recovered — there is no
account and no reset. Export a JSON backup as well if the data matters.

---

## Architecture

```
tasker/
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
│   ├── components/            UI building blocks (rail, sheets, rows, tree, editor…)
│   ├── db/database.ts         IndexedDB persistence layer (v4 schema, outbox)
│   ├── docs/UserManual.tsx    in-app Markdown manual renderer
│   ├── domain/                types, date maths, recurrence, NL parser,
│   │                          suggestions, progress/XP maths
│   ├── pwa/serviceWorker.ts   production service-worker registration
│   ├── state/                 React context store, hooks, navigation model
│   ├── sync/                  crypto, HLC clock, recorder, engine
│   ├── views/                 Tasks, Calendar, Roadmap, Settings
│   ├── App.tsx                shell: layout, shortcuts, manual overlay
│   ├── main.tsx               bootstrap + service-worker registration
│   └── styles.css             Nordic Minimal design tokens and components
├── vercel.json                static build, rewrites, headers
└── USER_MANUAL.md             the user manual (also rendered in-app)
```

### Design decisions

- **Local-first.** IndexedDB is the source of truth; every mutation is written
  through immediately, so closing the tab never loses work.
- **Subtasks are tasks.** A subtask is an ordinary `Task` with a `parentId`, so
  nesting is unlimited and every subtask supports the full metadata set without
  a parallel code path.
- **Rewards are accumulated, not derived.** XP, streaks and achievements live in
  `settings.progress` rather than being recomputed from the task list, so
  deleting an old task never rewinds your level.
- **No shared utility grab-bag.** Helpers live inside the domain that owns them
  (`domain/date.ts`, `domain/recurrence.ts`, `domain/parser.ts`,
  `domain/progress.ts`) rather than in a generic `utils/` module.
- **Plain CSS with tokens.** The palette from `DESIGN.md` is expressed as CSS
  custom properties, so the light and dark themes stay in lockstep without a
  build-time CSS framework.
- **Animation never blocks state.** Completing a task fires the burst
  immediately and commits ~220ms later, so the reward feels instant while the row
  still gets to animate. The celebration layer is `position: fixed` and
  `pointer-events: none`, so it survives the row unmounting.

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
