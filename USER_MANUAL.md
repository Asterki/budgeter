# Tasker — User Manual

Tasker is a local-first todo and planning app. Everything you create lives on
your device in IndexedDB; there is no account, no login and no server-side copy
of your work. The only network calls are the optional reminder sync and the
optional update check.

---

## 1. Layout

### Desktop

```
┌──────────────────────────────────────────────────────────────────────┐
│  ● ● ●   Tasker            [ search ]                 [ + Add task ] │  ← global menu bar
├───────────────┬──────────────────────────────────────────────────────┤
│  Inbox        │                                                      │
│  Today        │                 Active view                          │
│  Upcoming     │        (Tasks · Calendar · Roadmap · Settings)       │
│  All tasks    │                                                      │
│  ───────────  │                                                      │
│  PROJECTS     │                                                      │
│   ● UNAH      │                                                      │
│   ● Tasker    │                                                      │
│  ───────────  │                                                      │
│  PLACES       │                                                      │
│   @work       │                                                      │
│   @home       │                                                      │
├───────────────┴──────────────────────────────────────────────────────┤
│  ⚙ Settings   ● Notifications off                                    │
└──────────────────────────────────────────────────────────────────────┘
```

The window controls sit in the top-left corner (Nordic "quiet chrome"), the
global menu bar spans the top edge, and the left rail holds navigation. Clicking
a task opens the detail panel on the right side of the workspace.

### Mobile

The bottom tab bar holds **Tasks**, **Calendar**, **Roadmap** and **More**.
A floating **+** button sits above the tab bar, inside the thumb zone. Creating
and editing happen in a **bottom sheet**: drag the handle down — or swipe the
sheet away — to close it. The sheet's primary actions live at the bottom of the
screen so everything is reachable with one hand.

---

## 2. Views

### Tasks

A single, fast list. Use it to sort, filter and manipulate tasks.

- **Debounced live filter** — typing in *Filter tasks…* narrows the list after a
  short pause, so the UI never stutters.
- **Sort** — by due date, priority, creation date, alphabetically, or manual
  order.
- **Group** — by date, project, priority, place or roadmap lane.
- **Priority flag** — click the flag on a row to cycle P1 → P2 → P3 → P4.
- **Checkbox** — completes a task. Completing a *recurring* task archives that
  occurrence and schedules the next one automatically.

### Calendar

An interactive month/week grid. Each day shows up to three scheduled items and
a badge with the number of open tasks. Select a day to inspect it; the day panel
below the grid offers a quick-add field pre-dated to that day.

### Roadmap

A timeline of execution sequences. Tasks are grouped into **lanes** (set the
lane in the task detail panel) and plotted week-by-week, or day-by-day with the
**Days** toggle. Bars are coloured by priority, get a left edge in the project
colour, and turn red when overdue. Unscheduled work sits in the backlog below.

---

## 3. Natural-language quick add

Type a normal sentence and Tasker extracts the metadata as you type — the chips
under the input always show exactly what will be saved.

```
Create a new feature in the app @work tomorrow !1 #UNAH
```

| Result | Value |
| --- | --- |
| Title | Create a new feature in the app |
| Place | `work` |
| Date | tomorrow's date |
| Priority | 1 |
| Project | UNAH |

### Tokens

| Token | Meaning | Examples |
| --- | --- | --- |
| `@place` | Physical or contextual place | `@work` `@home` `@downtown` |
| `!1` … `!4` | Priority (1 = urgent, 4 = none) | `!1` `!p2` |
| `#Project` | Project (created automatically if new) | `#UNAH` `#Deep Work` |
| `+tag` | Tag from the target project | `+design` `+urgent` |

### Dates

`today`, `tomorrow`, `tonight`, `monday` … `sunday`, `next friday`,
`this monday`, `next week`, `next month`, `in 3 days`, `in 2 weeks`,
`25/10`, `10/25/2027`, `2027-01-09`, `Oct 25`, `25 Oct`, `Oct 25 2027`.

### Times, durations and recurrence

`3pm`, `3:30pm`, `15:00`, `at 7`, `noon`, `morning`, `evening`,
`9-11am`, `from 9 to 11am` (sets a duration),
`every day`, `every 2 weeks`, `every monday`, `every month`, `every 1st`,
`every year`, `daily`, `weekly`, `monthly`, `yearly`.

A date with no time is an **all-day** event; adding a time turns it into a
micro-scheduled timeframe you can give a duration.

---

## 4. Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `n` | Focus the quick-add field |
| `/` or `⌘/Ctrl + K` | Focus the filter / search field |
| `1` | Tasks view |
| `2` | Calendar view |
| `3` | Roadmap view |
| `4` | Settings |
| `t` | Jump to Today |
| `?` | Open this manual |
| `Esc` | Close the open panel or sheet |

Shortcuts are disabled while you are typing in a field.

---

## 5. Projects, tags and places

- **Projects** are isolated containers. Each one owns its own colour, its own
  tag set and its own task list. Create one from the left rail (**+ New
  project**) or simply by typing `#Name` in quick add.
- **Tags** belong to a project. Add them from the task detail panel; attach or
  detach them with a click.
- **Places** are global contexts such as `@work` or `@home`. They appear in the
  left rail and can be used as a grouping dimension.

---

## 6. Recurrence

Open a task and choose a repeat cycle. Simple cycles (daily, weekly, monthly,
yearly) work out of the box; the **custom** controls add:

- a multi-unit interval (`every 2 weeks`),
- explicit weekdays for weekly rules,
- a day of month for monthly / yearly rules,
- an end date and a maximum number of occurrences.

Completing a recurring task archives the current occurrence and creates the next
one, so your history stays intact.

---

## 7. Notifications (Web Push + Vercel Cron)

Notifications are delivered by a serverless cron job that runs every minute on
Vercel, so they arrive even when Tasker is closed.

### One-time server setup

1. Generate a VAPID key pair:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. In **Vercel → Project → Settings → Environment Variables** add:

   | Variable | Value |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | the public key |
   | `VAPID_PRIVATE_KEY` | the private key |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |
   | `VITE_VAPID_PUBLIC_KEY` | the **same** public key (exposed to the client) |

3. Optional but recommended — add a KV store so the reminder snapshot survives
   cold starts. Any Upstash-compatible REST endpoint works; Tasker reads
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).

4. Redeploy. `vercel.json` already registers the cron:

   ```json
   { "crons": [{ "path": "/api/check-reminders", "schedule": "* * * * *" }] }
   ```

### Per-device opt-in

1. Open **Settings → Notifications**.
2. Click **Enable notifications** and accept the browser prompt.
3. Tasker registers `sw.js`, subscribes through `PushManager` with the VAPID
   public key, and stores the subscription in IndexedDB.
4. It then mirrors your upcoming reminders to `/api/check-reminders`. The cron
   job fires each reminder at its exact timestamp and marks it as reminded.

If the browser denies permission, or no VAPID key is configured, the panel tells
you exactly what to fix.

### Installing the app (PWA)

Use the browser's **Install** / **Add to Home Screen** action. Tasker then runs
in its own window and works fully offline — the service worker caches the app
shell on first visit and serves it from cache afterwards.

---

## 8. Backup, restore and reset

Everything lives in **Settings → Data**.

- **Export JSON** downloads a complete snapshot: projects, tags, places, tasks
  and settings.
- **Import JSON** restores that snapshot. Import *replaces* the current state,
  so export first if you are unsure.
- **Reset app** erases all local data. This cannot be undone.

Keep the exported file somewhere safe — it is the only copy of your data.

---

## 9. Offline behaviour

- The app shell is cached by `sw.js`, so Tasker opens with no network.
- All reads and writes go to IndexedDB and work offline.
- Reminder sync is best-effort: when you come back online, the next sync pushes
  the current reminder list to the cron endpoint.

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No notifications | Check the browser permission, then re-enable in Settings. |
| “No VAPID public key configured” | Set `VITE_VAPID_PUBLIC_KEY` and redeploy. |
| Notifications stop after a while | Confirm the cron is registered in Vercel and that a KV store is configured. |
| App shows stale content | Hard-reload once; the service worker updates on the next visit. |
| Lost data | Import your most recent JSON export. |
