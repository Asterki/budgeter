# Budget — User Manual

Budget is a single-user, local-first personal budgeting app. Everything you enter
is stored in your browser's IndexedDB on this device. There is no account, no
login and no cloud copy unless you choose to connect the optional encrypted sync
relay.

Money is stored in integer minor units (cents) and formatted for display with
your chosen currency and locale.

---

## 1. First run

1. Open the app. The ledger starts empty.
2. Open **Settings** (the gear in the header, or tab `6`) and add at least one
   account under **Accounts**, with its opening balance.
3. Optionally set your **Currency** (ISO code such as `USD`, `EUR`, `GBP`) and
   **Locale** (for example `en-US`, `de-DE`) under **Appearance**.
4. Return to **Ledger** and record your first transaction with the composer or
   the **Add transaction** button.

Settings, categories and the theme are saved immediately as you change them.

---

## 2. Layout

### Desktop

- **Top bar** — net worth, one balance per active account, the balance-visibility
  eye, progress HUD, search, theme toggle, Settings and **Add transaction**.
- **Left rail** — Ledger scopes (All, Uncategorized), accounts, category groups,
  payee search, and the Settings link.
- **Workspace** — the selected view.
- **Detail overlay** — transaction editor and dialogs open over the workspace.

### Mobile (up to 860 px)

- A bottom tab bar switches between Ledger, Budget, Calendar, Reports, Forecast
  and Settings.
- The left rail is replaced by a scope selector at the top of the ledger.
- Creation and detail dialogs slide up as thumb-zone bottom sheets. Drag the
  handle down, tap the backdrop or press `Esc` to close.

---

## 3. Views and shortcuts

| Key | View |
| --- | --- |
| `1` | Ledger (transactions) |
| `2` | Budget |
| `3` | Calendar |
| `4` | Reports |
| `5` | Forecast |
| `6` | Settings |

Other shortcuts: `n` focuses quick add, `/` focuses ledger search, `Esc` closes
the open dialog or sheet. Shortcuts are ignored while typing in a field.

---

## 4. Ledger

- Transactions are grouped by date with a daily net total.
- Scoped to one account, each row also shows the running balance after that
  transaction.
- **Search** matches payee, notes, tags, and the formatted or plain amount.
- **Filters** cover date range, category (including Uncategorized), account, tag
  and cleared state; sorting supports newest, oldest, largest and smallest.
- **CSV** exports exactly what the current scope and filters show.
- The **Upcoming** section lists scheduled rows for the next 30 days in a dimmed
  style. They are projections, not ledger entries.
- Long histories load 200 rows at a time; use **Load more**.

### Adding a transaction

Choose **Expense**, **Income** or **Transfer**.

- Expenses are negative, income is positive, transfers move money between two
  accounts and create two linked rows.
- Amount is entered in normal units (`12.50`); it is stored as `1250` cents.
- Pick an account, an optional category, a payee (autocomplete reuses existing
  payees case-insensitively), a date, optional comma-separated tags, notes and
  the cleared flag.
- **Repeat this transaction** turns it into a recurring rule.
- Deleting a transaction removes that row; deleting a transfer removes both legs.

### Cleared and reconciliation

Marking a transaction cleared is reconciliation. Clearing an already-cleared row
again does not pay XP twice.

---

## 5. Quick add syntax

One line creates one transaction. The amount is required; everything else is
optional. Unknown payees and categories are shown as “new” chips and created
when you submit. An unknown `^account` is an error — accounts are never created
silently.

| Token | Meaning | Example |
| --- | --- | --- |
| amount | Required. `+` means income, otherwise expense | `4.50`, `+2500`, `$18`, `1.234,56` |
| `@name` | Payee | `@Starbucks` |
| `#name` | Category | `#Food` |
| `^name` | Account (must already exist) | `^Checking` |
| `+tag` | Tag | `+work` |
| `!cleared` | Mark cleared | `!cleared` |

Examples:

```text
coffee 4.50 @Starbucks #Food
salary +2500 ^Checking friday
rent 1200 monthly on the 1st #Housing
transfer 300 from Checking to Savings
300 -> Savings
lunch 12,5 yesterday
taxi $18 2d ago
groceries 84.20 last monday
```

Dates understood: `today`, `tomorrow`, `yesterday`, `tonight`, weekdays
(`friday`, `next monday`, `last tuesday`), `in 3 days`, `2 weeks ago`, ISO
`2026-11-03`, `11/3`, `Nov 3`, and `on the 1st` for monthly rules.

Recurrence: `daily`, `weekly`, `monthly`, `yearly`, `every 2 weeks`,
`every monday`, `monthly on the 1st`. Future occurrences are planned, not stored.

The remaining words become notes. A known payee with a default category
pre-fills it, and a categorization rule can fill a missing category.

---

## 6. Accounts, categories and rules

- **Accounts** have a name, type (checking, savings, cash, credit, investment),
  colour, opening balance and archived flag. Archive hides an account from
  pickers without deleting history.
- **Category groups** are envelopes such as Living or Fun. Categories are
  expense or income, belong to at most one group, and can be archived.
- Deleting a category reassigns its transactions to a category you choose (or
  Uncategorized) and removes its budgets.
- **Categorization rules** in Settings match contains-text against payee and
  notes and assign a category. They run in quick add and CSV import. Explicit
  `#category` always wins.

---

## 7. Budgets

- Pick a month with the arrows, or click the month name to return to today.
- Each expense category has an editable limit. Changes save on blur or `Enter`;
  `Esc` reverts the field.
- **Rollover** carries the previous month's leftover — or overspend — into the
  month.
- Bars are green below 80%, amber from 80%, and red with an “over by” amount when
  spending exceeds the available limit.
- **Copy last month's budgets** copies limits for matching categories.
- **Set all from 3-month average** seeds limits from previous full months.
- Clicking a category opens the ledger filtered to that category and month.
- The summary shows income, spending, savings rate, budgeted, spent, left and
  unbudgeted spending.

---

## 8. Scheduled and recurring

Create a rule from quick add (`rent 1200 monthly on the 1st`), from the
transaction editor's **Repeat** section, or manage existing rules under
**Settings → Recurring**.

- Rules store the next date and the last generated date.
- When the app opens or the tab becomes visible, every due occurrence up to today
  is generated, capped at 366 per rule, with deterministic ids so reloads and
  sync cannot create duplicates.
- Future occurrences are never stored. They appear as planned rows in the ledger
  (next 30 days) and feed the Forecast.
- **Pause** stops generation; **Resume** catches up immediately.
- **Skip next** moves the rule forward without creating a row.
- Deleting offers **Delete rule only** (keeps generated rows) or **Delete rule +
  rows** (removes rows dated today or later).
- Recurring transfers are not supported.

---

## 9. Calendar, forecast and reports

**Calendar** — a Monday-first month grid with each day's net spend, filled dots
for actual transactions and outlined dots for planned ones. Select a day to see
its net, quick-add on that date, and open its rows.

**Forecast** — projected total balance for the next 60 or 90 days from current
balances plus planned recurring items. Negative days are flagged, with per-account
today, end and low values.

**Reports** — month, quarter, year or a custom range, with previous-period
comparison. Includes a category donut, spending over time, income vs expense, net
worth over time, top payees and category trend. Every chart has a table fallback.

---

## 10. CSV import and export

### Import

1. **Settings → Data → Import CSV**, or the ledger's import entry.
2. Choose a `.csv` file, the target account and the date format.
3. Confirm the column mapping: date, amount (or separate debit/credit), payee,
   notes, category. Mapping is guessed from common header names.
4. Review the preview. Rows matching an existing transaction on the same account,
   date, amount and payee are marked **Duplicate** and skipped by default.
5. Categories are resolved from the CSV category name, then the payee's default,
   then categorization rules. Missing payees are created.

Amounts with either decimal separator are accepted. Invalid or zero-amount rows
are skipped. Imported rows do not award XP.

### Export

The ledger's **CSV** button exports the current filtered rows with date, account,
amount, type, category, payee, notes, tags and cleared state.

---

## 11. Backup and restore

- **Settings → Data → Export JSON** downloads a complete version 5 backup:
  accounts, categories, groups, payees, categorization rules, transactions,
  budgets, recurring rules and settings/progress.
- **Import JSON** validates the file, replaces all current data and reloads the
  app. It is refused while sync is connected — disconnect first.
- **Reset app** erases local data and disconnects sync.

CSV is for moving transactions; JSON is the full backup.

---

## 12. Privacy

**Appearance → Hide balances** (or the eye in the header) masks every amount in
the header, ledger, running balances, account lists and summaries. The underlying
data is unchanged. The setting syncs with your other devices.

---

## 13. Sync between devices (optional)

Run the relay from `server/` (see README) or use your own deployment.

1. On the first device: **Settings → Sync**, enter the relay URL and a passphrase
   of at least eight characters, then **Create space**.
2. On the second device: enter the same URL and passphrase, then **Connect**.
   The fingerprint should match on both devices.
3. Changes sync every 20 seconds, on focus and when the connection returns.
4. **Disconnect** keeps local data and stops syncing.

Encryption keys are derived from the passphrase (PBKDF2 + HKDF, AES-GCM). The
relay stores encrypted payloads and never sees the passphrase. There is no
password recovery: losing the passphrase means the space cannot be reopened.

Sync uses protocol 2 and schema 6. Old Tasker spaces are refused, importing JSON
is refused while connected, and transfer deletions propagate as a pair.

---

## 14. Install and offline use

- **Install** from the browser's address bar or menu (Chrome/Edge) or
  Share → Add to Home Screen (Safari).
- The service worker caches the app shell and build assets, so a reload works
  offline.
- If a new build is deployed, reload once to pick it up; the cache is
  version-stamped per build.
- The manifest adds an **Add transaction** shortcut which opens the new
  transaction form directly.

---

## 15. Progress and achievements

- Logging a transaction earns XP (`5 × combo`, combo capped at 5, plus a small
  streak bonus). Logs within eight seconds build a combo.
- Reconciling (clearing) a transaction earns XP once per row.
- Closed months are evaluated once: under budget, budget master, zero-based and a
  savings rate of at least 20% each award XP.
- Streak = consecutive days with at least one logged transaction.
- 18 achievements cover entry counts, streaks, budgeting, savings, no-spend days,
  reconciliation, debt-free accounts and the emergency-fund target.
- Transfers and generated recurring rows do not earn XP. Re-adding or duplicating
  a transaction cannot farm XP.
- The header HUD shows level and streak; **Settings → Progress** lists everything.

---

## 16. Troubleshooting

| Problem | What to do |
| --- | --- |
| Amount is rejected | Include a number such as `4.50`; use `+` for income. Only one amount per line. |
| `^Account` is rejected | Create the account in Settings first. Accounts are never auto-created. |
| CSV rows are missing | Check the date format and mapping; invalid dates and zero amounts are skipped. |
| CSV rows are marked duplicate | Same account, date, amount and payee already exists. Uncheck the skip option to import anyway. |
| Import JSON is refused | Disconnect sync first. |
| Balances show dots | Turn off Hide balances in Settings or with the eye button. |
| Scheduled rows did not appear | Open the app (or the tab) again; catch-up runs on boot/visibility. Check that the rule is active and its next date is not in the future. |
| Sync shows an incompatible-protocol error | The relay is an older Tasker/Budget protocol. Update the relay image. |
| Nothing appears after reload | Confirm the browser allows IndexedDB for this origin and that you are on the same profile/device. |

---

## 17. Where data lives

- IndexedDB database `budget`, schema version 6.
- Stores: accounts, categories, category groups, payees, transactions, budgets,
  recurring rules, categorization rules, settings, plus sync outbox/versions/state.
- No cookies, analytics or third-party requests. The only optional network
  traffic is the sync relay you configure.
