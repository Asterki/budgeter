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
| Structure | Categories → projects → tasks → subtasks (nested to any depth) |
| Capture | Inline natural-language parsing with live preview chips (`@place`, `!1`, `#Project`, `^Category`, `+tag`, dates, times, ranges, recurrence) and a trigger-driven autocomplete dropdown |
| Views | Scheduled (all dated tasks grouped by day), Tasks (debounced filter, sort, group), Calendar (multi-day spans, month/week), Roadmap (lane timeline, week/day zoom) |
| Metadata | Priority 1–4, places, start/end dates, start/end times, all-day vs. micro-scheduled timeframes |
| Recurrence | Daily / weekly / monthly / yearly plus custom intervals, weekday picks, day-of-month, end date, occurrence cap |
| Rewards | XP with a combo multiplier, levels, streaks, 12 achievements, daily milestones, and a 6-second Undo on every completion |
| Feedback | Particle bursts at the checkbox, optional chime, haptic patterns, and toasts — all respecting `prefers-reduced-motion` |
| Storage | IndexedDB, fully offline, JSON export / import / reset |
| Notifications | In-app reminders plus optional Web Push (Vercel Cron disabled — see below) |
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

3. Deploy. `vercel.json` handles the build, the SPA rewrite and the cache headers.

> `.env.local` is git-ignored, so the private key never leaves your machine —
> which also means Vercel needs the values copied across manually.

### The Vercel cron job is disabled

`vercel.json` ships **without a `crons` array**, so nothing runs on a schedule
by default and no task data is ever pushed to the server on a timer.

Reminders still work: Tasker watches for due tasks while the app is open and
raises a notification through the service worker. For delivery while the app is
*closed*, point any free scheduler at the endpoint — it keeps a 24-hour catch-up
window, so how often you call it is entirely up to you:

1. Add `CRON_SECRET` to the Vercel environment variables.
2. Call the endpoint every minute from cron-job.org, a Cloudflare Worker Cron
   Trigger, or a GitHub Actions schedule:

   ```
   https://<your-app>.vercel.app/api/check-reminders?secret=<CRON_SECRET>
   ```

   …or send `Authorization: Bearer <CRON_SECRET>`. Without `CRON_SECRET` set the
   endpoint is open, which is fine for a single-user app but not recommended.

To use Vercel's own cron instead, re-add it to `vercel.json`. Mind the plan
limits — Hobby fails the deployment unless the schedule is **once per day**:

| Plan | Minimum interval | Precision |
| --- | --- | --- |
| Hobby | once per day | per-hour (±59 min) |
| Pro / Enterprise | once per minute | per-minute |

```json
{ "crons": [{ "path": "/api/check-reminders", "schedule": "0 13 * * *" }] }
```

`0 13 * * *` is 13:00 UTC — 07:00 in Honduras (UTC−6). Crons are always UTC.

### Checking things work

```bash
curl "https://<your-app>.vercel.app/api/check-reminders?dry=1"
```

Reports what is due, how many reminders are pending, whether a subscription and
VAPID keys are present, and which storage backend is in use.

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
│   ├── components/            UI building blocks (rail, sheets, rows, tree, editor…)
│   ├── db/database.ts         IndexedDB persistence layer (v2 schema)
│   ├── docs/UserManual.tsx    in-app Markdown manual renderer
│   ├── domain/                types, date maths, recurrence, NL parser,
│   │                          suggestions, progress/XP maths
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
- **One serverless file.** The reminder endpoint handles the tick (`GET`), the
  client sync (`POST`) and a `?dry=1` diagnostic, which keeps the deployment
  surface minimal.
- **Animation never blocks state.** Completing a task fires the burst
  immediately and commits ~220ms later, so the reward feels instant while the row
  still gets to animate. The celebration layer is `position: fixed` and
  `pointer-events: none`, so it survives the row unmounting.

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
