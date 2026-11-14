# Tasker Parity Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Budget feel like the same app as Tasker — same shell, same button placement, same mobile gestures — with a two-gesture phone experience: open and type, or tap a bottom-bar destination.

**Architecture:** Adopt Tasker's composition literally: 52px top bar with two controls, 248px rail, workspace as the only scroll container, 380px detail panel on desktop. On the intentional `860px` breakpoint the rail and panel unmount and a four-cell tab bar plus 48px FAB appear. One `BottomSheet` replaces the bottom-aligned modal. Navigation collapses to a single canonical order that the rail, tab bar and shortcuts all derive from.

**Tech Stack:** React 18 + Vite + TypeScript, react-icons, one `styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-13-budget-parity-and-sync-design.md` (§8, §12)

## Global Constraints

- No new runtime dependencies. No test suites (`AGENTS.md`). Verification is `pnpm typecheck`, `pnpm build`, plus the stated visual check at 390×844 and 1440×900.
- Money formats only through `Intl.NumberFormat`; no hand-formatting.
- Theme ids stay `light` / `dark`.
- Corner radii ≤ 6px, 1px borders, no soft shadows.
- Preserve existing behaviour while migrating: every current action must remain reachable after the move.
- `pnpm typecheck` and `pnpm build` must pass at the end of every task; the app must boot with no console errors.

## Review Focus

1. **A phone reloaded at 390px with the keyboard open.** The focused field must never be scrolled under the keyboard. Pinned by Task 6 (`100dvh`).
2. **A deep link `?action=add` on a phone.** Must still open the new-transaction surface, now the FAB's sheet. Pinned by Task 4.
3. **A user who lives in Reports/Forecast/Calendar.** Must stay reachable on both desktop and mobile after Calendar leaves the tab bar. Pinned by Tasks 3 and 4.
4. **Every action that existed before the top-bar reduction** — theme, balance hiding, settings, search. Must be reachable in exactly one obvious place. Pinned by Task 2.
5. **Rows at the bottom of a long ledger on mobile.** Must clear the tab bar and FAB, not sit under them. Pinned by Task 4.

---

### Task 1: The shell frame and the one breakpoint

**Files:**
- Modify: `src/App.tsx:132-192`
- Modify: `src/styles.css` (shell rules; remove the `.rail{display:none}` media block)
- Create: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `useMediaQuery` from `src/state/hooks.ts` (currently dead code).
- Produces: `<AppShell rail={ReactNode} panel={ReactNode} tabbar={ReactNode} fab={ReactNode}>{children}</AppShell>`; `const isMobile = useMediaQuery('(max-width: 860px)')` exported from `AppShell` as `useIsMobile()`.

- [ ] **Step 1: Create the shell component**

`AppShell` renders exactly:

```tsx
<div className="app">
  <header className="topbar">{topbar}</header>
  <div className="app__body">
    {!isMobile && rail}
    <main className="workspace">{children}</main>
    {!isMobile && panel}
  </div>
  {isMobile && tabbar}
  {isMobile && fab}
</div>
```

- [ ] **Step 2: Replace the CSS shell**

`.app { display:flex; flex-direction:column; height:100dvh; overflow:hidden }`; `.app__body { flex:1; display:flex; min-height:0 }`; `.workspace { flex:1; min-width:0; overflow-y:auto; padding:24px }`; `.rail { width:248px; flex:none; height:100%; overflow-y:auto }`; `.panel { width:380px; flex:none; height:100%; overflow-y:auto; border-left:1px solid var(--border) }`. Delete the `max-width:860px` block that hides `.rail` by `display:none`.

- [ ] **Step 3: Wire `App.tsx`**

Wrap the existing regions in `AppShell`, passing `TopBar` as `topbar` and the view switch as children. Keep `.app-shell` as a class only if other rules still need it; otherwise remove it.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. At 390px the rail and panel are gone and the workspace scrolls independently; at 1440px all three columns show. The rail must scroll when its content overflows (previously impossible).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/AppShell.tsx src/styles.css
git commit -m "refactor(shell): adopt tasker frame with a real 860px breakpoint"
```

---

### Task 2: Two controls in the top bar

**Files:**
- Modify: `src/components/TopBar.tsx:34-113` (props and markup)
- Modify: `src/App.tsx` (prop changes)
- Modify: `src/views/SettingsView.tsx` (Appearance card gains theme + balances)
- Modify: `src/views/AccountsView.tsx` (gains net worth + account chips)

**Interfaces:**
- Produces: `interface TopBarProps { onAdd: () => void; onSearch: () => void; onOpenSettings: () => void }`. All of `accounts`, `transactions`, `settings`, `netWorth`, `onToggleTheme`, `onToggleBalances` are removed from the component.

- [ ] **Step 1: Rebuild the markup**

Left → right: `<button className="topbar__search">` containing `<FiSearch/>`, the muted label `Search transactions`, and `<kbd>/</kbd>`; `<div className="topbar__spacer"/>`; `<ProgressHud/>`; `<button className="btn btn--primary">` with `<FiPlus/>`, `Add transaction`, `<kbd>n</kbd>`.

- [ ] **Step 2: Hide the right-hand controls on mobile**

In CSS, `.topbar__search { display:none }` and `.topbar .btn--primary { display:none }` under `max-width:860px`; center the HUD pill in the remaining space. This is the same rule Tasker uses.

- [ ] **Step 3: Rehome the removed controls**

Settings → Appearance card: a `Theme` segmented control (`Light`/`Dark`) and a `Hide balances` switch, both writing `updateSettings`. Accounts view: a summary card above the grid showing net worth, and a horizontal chip row of active accounts that calls `onOpenAccount`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: at 1440px the top bar has exactly one search trigger and one primary button. Toggle theme from Settings and confirm it persists across reload. Confirm `/` focuses the ledger filter and `n` opens a new transaction.

- [ ] **Step 5: Commit**

```bash
git add src/components/TopBar.tsx src/App.tsx src/views/SettingsView.tsx src/views/AccountsView.tsx
git commit -m "refactor(topbar): reduce to search, HUD and add; rehome the rest"
```

---

### Task 3: One navigation order

**Files:**
- Modify: `src/state/navigation.ts` (add `'more'` to `ViewKey`; add `NAV_GROUPS`)
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx:33-44` (TABS derived, not literal)

**Interfaces:**
- Produces:
  ```ts
  export interface NavItem { view: ViewKey; label: string; icon: IconType }
  export const VIEW_GROUP: NavItem[] = [
    { view: 'transactions', label: 'All transactions', icon: FiList },
    { view: 'uncategorized', label: 'Uncategorized', icon: FiInbox }, // scope, not view
  ];
  export const PLANNING_GROUP: NavItem[] = [
    { view: 'budget', label: 'Budget', icon: FiPieChart },
    { view: 'forecast', label: 'Forecast', icon: FiTrendingUp },
    { view: 'reports', label: 'Reports', icon: FiBarChart2 },
    { view: 'calendar', label: 'Calendar', icon: FiCalendar },
  ];
  ```

- [ ] **Step 1: Define the canonical order**

Rail order: **Views** (All transactions, Uncategorized) → **Planning** (Budget, Forecast, Reports, Calendar) → **Accounts** → **Categories** → **Payees** → footer **Settings**. `MORE_VIEWS = PLANNING_GROUP` — the mobile More list is the same four, same order. Use the icons already present in `Sidebar.tsx` for Uncategorized; do not import new ones for it.

- [ ] **Step 2: Render the rail from it**

Replace the hand-written view buttons in `Sidebar.tsx` with a map over `VIEW_GROUP` then `PLANNING_GROUP`, keeping the existing `.rail__item--active` class and the balance/count decorations. Delete the old order that started at Accounts.

- [ ] **Step 3: Derive the shortcuts**

In `App.tsx`, `TABS` becomes `const SHORTCUTS = [...VIEW_GROUP, ...PLANNING_GROUP, settings]`, so `1`–`7` follow the rail rather than a separate list. Keep `?action=add`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: the rail lists Budget above Accounts; pressing `3` lands on Budget; Reports and Forecast are reachable from the rail at 1440px.

- [ ] **Step 5: Commit**

```bash
git add src/state/navigation.ts src/components/Sidebar.tsx src/App.tsx
git commit -m "refactor(nav): single canonical order for rail, tabbar and shortcuts"
```

---

### Task 4: Four tabs, a More view, and a FAB

**Files:**
- Create: `src/views/MoreView.tsx`
- Modify: `src/App.tsx:194-257` (tabbar + More modal deleted, MoreView added)
- Modify: `src/components/Sidebar.tsx` (Settings row reused by MoreView, or a shared `NavRow`)
- Modify: `src/styles.css` (tabbar, fab, workspace bottom padding)

**Interfaces:**
- Consumes: `PLANNING_GROUP` (Task 3), `isMobile` (Task 1), `newTransaction` sheet opener (Task 5 — until then, `setDetail({ transactionId: null })`).
- Produces: `<MoreView onSelect={(view: ViewKey) => void} />` rendering rows from `PLANNING_GROUP` plus a trailing Settings row.

- [ ] **Step 1: Reduce the tab bar to four cells**

`Transactions` (FiList), `Accounts` (FiCreditCard), `Budget` (FiPieChart), `More` (FiMoreHorizontal). `More` is active when `PLANNING_GROUP` or `settings` contains the current view. Grid `repeat(4, 1fr)`, `height: calc(60px + env(safe-area-inset-bottom))`, `padding-bottom: env(safe-area-inset-bottom)`, z 50, active = `box-shadow: inset 0 2px 0 var(--accent)` plus weight 600.

- [ ] **Step 2: Make More a destination, not a dialog**

Add `'more'` to `ViewKey`, render `MoreView` for it, and delete the `moreOpen` state, the `Dialog title="More"` block, and the `MORE_TABS` constant.

- [ ] **Step 3: Add the FAB**

```tsx
<button type="button" className="fab" onClick={onNewTransaction} aria-label="Add transaction">
  <FiPlus aria-hidden="true" />
</button>
```

`.fab { position:fixed; right:16px; bottom:calc(60px + 16px + env(safe-area-inset-bottom)); width:48px; height:48px; border-radius:6px; background:var(--accent-bg); color:#fff; z-index:55; display:grid; place-items:center }`.

- [ ] **Step 4: Clear the bottom on mobile**

`.workspace { padding-bottom: calc(60px + 96px) }` under `max-width:860px`, so the last row clears both surfaces.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual at 390px: tapping More lands on a real view listing Forecast, Reports, Calendar, Settings; tapping Forecast requires exactly two taps; the FAB opens a new transaction; the last ledger row scrolls clear of the bar. Reloading lands on Transactions every time.

- [ ] **Step 6: Commit**

```bash
git add src/views/MoreView.tsx src/App.tsx src/components/Sidebar.tsx src/styles.css
git commit -m "feat(mobile): four-cell tabbar, More view and FAB"
```

---

### Task 5: A real bottom sheet

**Files:**
- Create: `src/components/BottomSheet.tsx`
- Modify: `src/components/Dialog.tsx:20-56`
- Modify: `src/components/TransactionDetail.tsx`
- Modify: `src/App.tsx` (desktop right panel for detail)
- Modify: `src/styles.css` (sheet rules, remove the `align-items:flex-end` modal rule)

**Interfaces:**
- Produces:
  ```ts
  interface BottomSheetProps {
    open: boolean; title: string; onClose: () => void;
    children: ReactNode; footer?: ReactNode; accent?: string;
  }
  export function BottomSheet(props: BottomSheetProps): JSX.Element | null;
  ```
  `Dialog` keeps its current props and renders `BottomSheet` internally when `isMobile`.

- [ ] **Step 1: Port the sheet**

Behaviour, exactly: unmount when `closed`; backdrop `var(--overlay)` z 100, click closes; sheet `max-height:92vh`, `border-radius:6px 6px 0 0`, `padding-bottom: env(safe-area-inset-bottom)`; 32×4 handle; drag-to-dismiss on the handle using pointer capture, closing past 28% of height or 0.7 px/ms; `Escape` closes; enter animation `sheet-up 240ms cubic-bezier(0.22,1,0.36,1)`.

- [ ] **Step 2: Route every dialog through it on mobile**

`Dialog` renders `<div className="dialog__card">` on desktop and `<BottomSheet>` on mobile, sharing the same header/body/footer markup. Delete the `@media (max-width:860px) .dialog-backdrop { align-items:flex-end }` rule.

- [ ] **Step 3: Desktop detail panel**

When `!isMobile` and `detail` is set, render `TransactionDetail` into `AppShell`'s `panel` slot instead of a modal. On mobile keep it as a `BottomSheet`. The component itself is unchanged apart from its frame.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual at 390px: dragging the handle down dismisses; backdrop tap dismisses; the new-transaction form is a sheet, not a floating card. At 1440px, clicking a row opens the 380px right panel and the ledger stays visible.

- [ ] **Step 5: Commit**

```bash
git add src/components/BottomSheet.tsx src/components/Dialog.tsx src/components/TransactionDetail.tsx src/App.tsx src/styles.css
git commit -m "feat(mobile): bottom sheet for detail and dialogs; desktop side panel"
```

---

### Task 6: Open the app and start typing

**Files:**
- Modify: `src/components/QuickAdd.tsx` (expose `autoFocus` prop)
- Modify: `src/views/TransactionsView.tsx` (render QuickAdd under the header; remove `composeSignal` focus hack if redundant)
- Modify: `src/App.tsx` (pass a one-shot cold-open flag)

**Interfaces:**
- Produces: `interface QuickAddProps { autoFocus?: boolean; defaultAccountId?: string; onCreated?: () => void }` (existing props preserved). `App` passes `autoFocus` only when `isMobile && firstMount`.

- [ ] **Step 1: Add the prop**

`autoFocus` puts a `ref` on the text input and calls `focus()` in a layout effect, once. Do not re-focus on re-render.

- [ ] **Step 2: Place it**

`TransactionsView` renders `<QuickAdd autoFocus={coldOpen && isMobile} />` immediately below `view__header` and above `FilterBar`.

- [ ] **Step 3: Fire it once per cold open**

`const coldOpen = useRef(true)` in `App`; set `false` after the first successful focus. Tab switches, returning from detail, and sync refreshes must not refocus.

- [ ] **Step 4: Make the keyboard safe**

`.app { height:100dvh }` (already from Task 1) and the composer sits at the top of `.workspace`, so an opened keyboard cannot hide it. Verify the page does not scroll behind the keyboard.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual at 390px: reload → the field is focused with a visible caret. Switch to Accounts and back → no refocus, no keyboard.

- [ ] **Step 6: Commit**

```bash
git add src/components/QuickAdd.tsx src/views/TransactionsView.tsx src/App.tsx
git commit -m "feat(mobile): focus the natural-language field on cold open"
```

---

### Task 7: Tokens, layering and reduced motion

**Files:**
- Modify: `src/styles.css:6-66` (token blocks), plus a new z-index ladder section and the motion guard.

**Interfaces:**
- Produces: `--radius-lg:6px`, `--accent-bg`, `--secondary`, `--shadow-sm|md|lg`, `--topbar-height:52px`, `--tabbar-height:60px`, `--rail-width:248px`.

- [ ] **Step 1: Add the missing primitives**

Add the tokens above; replace every inline `box-shadow` literal with `var(--shadow-*)`; set dark `--on-surface:#c9d1d9`, dark `--primary:#1f883d`, dark `--primary-hover:#238636`.

- [ ] **Step 2: Align chrome dimensions**

Change `--topbar-height` 56→52, `--tabbar-height` 58→60, `--rail-width` 272→248, and make every consumer reference the tokens rather than raw numbers.

- [ ] **Step 3: One z-index ladder**

topbar 40, suggest 45, tabbar 50, fab 55, HUD 60/61, modal 90, sheet 100, toasts 320. Replace the ad-hoc 5/30/70/90/100 values.

- [ ] **Step 4: Guard motion**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: reward toasts now render **above** open dialogs; toggling OS reduced-motion removes the sheet animation; the top bar measures 52px.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css
git commit -m "style: align tokens, z-index ladder and reduced motion with tasker"
```

---

### Task 8: One feedback layer

**Files:**
- Create: `src/components/Toasts.tsx`
- Modify: `src/state/store.tsx` (expose `notify(message, tone?)` and `undoDelete`)
- Modify: `src/views/TransactionsView.tsx`, `src/components/TransactionRow.tsx` (use the toast instead of `window.alert`)

**Interfaces:**
- Produces: `notify(message: string, tone?: 'info' | 'success' | 'danger'): void`; `<Toasts/>` at app root, z 320, top-center under the top bar, max 3, auto-dismiss 3600 ms; transaction delete shows an `Undo` action for 6000 ms.

- [ ] **Step 1: Build the layer**

A tiny module-level emitter in `store.tsx` plus a `Toasts` component subscribing to it. No new dependency.

- [ ] **Step 2: Undo for transaction deletes only**

Delete applies immediately; `Undo` re-inserts the same record with a fresh HLC through the normal write path, which beats the tombstone under LWW. Account, category, payee and group deletes keep `ConfirmDialog` and have no undo.

- [ ] **Step 3: Replace ad-hoc feedback**

Replace `window.alert`, `.notice`, and `.budget__notice` uses with `notify(...)`; CSV export gets a success toast instead of silence.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: delete a transaction, tap Undo within 6 s, confirm it returns; export JSON and confirm a toast appears; trigger a sync error and confirm it surfaces here.

- [ ] **Step 5: Commit**

```bash
git add src/components/Toasts.tsx src/state/store.tsx src/views/TransactionsView.tsx src/components/TransactionRow.tsx
git commit -m "feat(ui): single toast layer with undo for transaction deletes"
```

---

### Task 9: One view header, one add button

**Files:**
- Modify: `src/views/*.tsx` (all seven, header markup only)
- Modify: `src/components/FilterBar.tsx` (mobile scope select)
- Modify: `src/styles.css` (`view`, `view__header`, remove per-view padding and max-widths)

**Interfaces:**
- Produces: `<section className="view">` + `<header className="view__header">` with `h1.view__title` and `p.view__subtitle`; content column `max-width:1280px`.

- [ ] **Step 1: Normalize the header**

Every view uses the same header structure with the title on the left and actions right-aligned and `align-items:flex-end`.

- [ ] **Step 2: Remove duplicate affordances**

Delete `+ New` and the header CSV button from Transactions (CSV already lives in Settings → Data). The top-bar add, the FAB and the inline QuickAdd are the only routes to creation.

- [ ] **Step 3: Mobile scope selector**

At `max-width:860px`, `FilterBar` renders a `<select>` bound to `selection.scope` in place of the rail's account/category list, so scope is still reachable without a rail.

- [ ] **Step 4: One padding, one width**

Remove the per-view inner `padding:24px` and the four max-widths; the workspace supplies padding and the view supplies `max-width:1280px`.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`. Manual: all seven views share one header rhythm; no horizontal double-gutter; at 390px a scope select is present in the ledger toolbar.

- [ ] **Step 6: Commit**

```bash
git add src/views src/components/FilterBar.tsx src/styles.css
git commit -m "refactor(views): shared header, single add affordance, one content width"
```
