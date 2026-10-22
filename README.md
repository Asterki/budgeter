# Tasker

A local-first, offline-capable todo and planning app. Tasker is a TypeScript
single-page application deployed to Vercel with a service worker for offline use
and a serverless cron job for web-push reminders.

There is **no account, no login and no server-side database**. Every task,
project, tag, place, setting and push subscription lives in the browser's
IndexedDB. The only server-side piece is the reminder delivery endpoint.

> 📖 The full user manual lives in [`USER_MANUAL.md`](./USER_MANUAL.md) and is
> also rendered inside the app under **Settings → Open user manual** (or `?`).

---

## Features

| Area | What you get |
| --- | --- |
| Capture | Inline natural-language parsing with live preview chips (`@place`, `!1`, `#Project`, `+tag`, dates, times, durations, recurrence) |
| Views | Tasks (debounced filter, sort, group), Calendar (month/week), Roadmap (lane timeline, week/day zoom) |
| Metadata | Priority 1–4, places, absolute dates, absolute times, all-day vs. micro-scheduled timeframes with duration |
| Recurrence | Daily / weekly / monthly / yearly plus custom intervals, weekday picks, day-of-month, end date, occurrence cap |
| Organisation | Isolated projects with per-project tags, global places, roadmap lanes |
| Storage | IndexedDB, fully offline, JSON export / import / reset |
| Notifications | Web Push + Vercel Cron running every minute, delivered while the app is closed |
| PWA | Installable, custom `sw.js`, offline-first caching |

---

## Getting started

This project uses **pnpm**.

```bash
pnpm install
pnpm dev           # http://localhost:5173
```

The dev server also mounts the serverless endpoint at `/api/check-reminders`, so
you can exercise the cron logic locally:

```bash
curl "http://localhost:5173/api/check-reminders?dry=1"
```

### Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server + local API |
| `pnpm build` | Typecheck, then produce `dist/` |
| `pnpm preview` | Serve the production build (API included) |
| `pnpm typecheck` | TypeScript only |
| `pnpm vapid` | Generate a VAPID key pair |

---

## Deploying to Vercel

1. Import the repository. Vercel detects the Vite preset from `vercel.json`.
2. Push credentials are already generated in `.env.local` for local development.
   Add the same values to Vercel → **Settings → Environment Variables**:

   ```bash
   pnpm vapid          # regenerate a pair if you ever need to rotate them
   ```

   | Variable | Notes |
   | --- | --- |
   | `VITE_VAPID_PUBLIC_KEY` | inlined into the client bundle at build time |
   | `VAPID_PUBLIC_KEY` | server-side; must match the value above |
   | `VAPID_PRIVATE_KEY` | server-side secret — never commit it |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |
   | `CRON_SECRET` | optional; Vercel sends it automatically as a bearer token |
   | `KV_REST_API_URL` / `KV_REST_API_TOKEN` | optional KV REST store for the reminder mirror |

3. Deploy. `vercel.json` registers the cron and the SPA rewrite.

> `.env.local` is git-ignored, so the private key never leaves your machine —
> but that also means Vercel needs the values copied across manually.

### Notes on the cron schedule

`* * * * *` requires a Vercel plan that allows per-minute crons. On plans limited
to daily crons the endpoint still works — reminders simply fire on the next tick
that the schedule allows. Reminders that have already passed are picked up by
the grace window (5 minutes) or by the in-app watcher.

### Without a KV store

If no KV REST credentials are configured the endpoint keeps the subscription and
reminder mirror in a module-level map. That is enough for a single-user app on a
warm serverless instance, but a cold start clears it. Configure
`KV_REST_API_URL` / `KV_REST_API_TOKEN` for durable delivery.

---

## Architecture

```
tasker/
├── api/
│   └── check-reminders.ts     Vercel function: POST = sync, GET = cron tick
├── public/
│   ├── sw.js                  custom service worker (caching + push)
│   ├── manifest.webmanifest   PWA manifest
│   └── icons/                 generated app icons
├── scripts/
│   └── generate-icons.py      dependency-free icon generator
├── src/
│   ├── components/            UI building blocks (rail, sheets, rows, editor…)
│   ├── db/database.ts         IndexedDB persistence layer
│   ├── docs/UserManual.tsx    in-app Markdown manual renderer
│   ├── domain/                types, date maths, recurrence engine, NL parser
│   ├── notifications/push.ts  permission, PushManager, reminder mirror sync
│   ├── state/                 React context store, hooks, navigation model
│   ├── views/                 Tasks, Calendar, Roadmap, Settings
│   ├── App.tsx                shell: layout, shortcuts, manual overlay
│   ├── main.tsx               bootstrap + service-worker registration
│   └── styles.css             Nordic Minimal design tokens and components
├── vercel.json                build, cron, rewrites, headers
└── USER_MANUAL.md             the user manual (also rendered in-app)
```

### Design decisions

- **Local-first.** IndexedDB is the source of truth; every mutation is written
  through immediately, so closing the tab never loses work.
- **No shared utility grab-bag.** Helpers live inside the domain that owns them
  (`domain/date.ts`, `domain/recurrence.ts`, `domain/parser.ts`) rather than in a
  generic `utils/` module.
- **Plain CSS with tokens.** The palette from `DESIGN.md` is expressed as CSS
  custom properties, so the light and dark themes stay in lockstep without a
  build-time CSS framework.
- **One serverless file.** The reminder endpoint handles both the cron tick
  (`GET`) and the client sync (`POST`), which keeps the deployment surface
  minimal.

### Environment replacement

`vite.config.ts` loads `.env`, `.env.<mode>` and `.env.<mode>.local` through
Vite's `loadEnv`, and inlines `__APP_VERSION__`, `__APP_MODE__`,
`__BUILD_TIME__` and `__VAPID_PUBLIC_KEY__` into the bundle. The client reads
`import.meta.env.VITE_*` as usual; the serverless function reads `process.env`.
Copy `.env.example` to `.env.local` to get started.

---

## Regenerating icons

```bash
python3 scripts/generate-icons.py
```

No image libraries required — the script writes PNGs directly.
