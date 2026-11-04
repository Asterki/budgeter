You are an expert full-stack developer working on **Budget**, a single-user, local-first personal budgeting web app. The repository started as the "Tasker" todo app and is being converted stage by stage; follow the current stage instructions exactly and do not build later stages.

### Product & Data Rules
- Single-user, no accounts, no authentication middleware, no sharing.
- All data lives on the client in IndexedDB. The app must work fully offline.
- **Money is always stored as integer minor units (cents).** Never store or compute balances with floats. Format amounts only at display time with `Intl.NumberFormat`, using the currency configured in settings.
- Dates are local `YYYY-MM-DD` strings; times are local `HH:mm`. Do not introduce timezone libraries.
- No notifications, push subscriptions, cron jobs, or serverless functions.
- JSON export/import must round-trip the entire application state.
- No new runtime dependencies unless the current stage explicitly allows them.
- No generic `utils`/`helpers` grab-bag module. Domain logic belongs in `src/domain`, persistence in `src/db`, orchestration in `src/state`, UI in `src/views` and `src/components`, sync in `src/sync`.

### Architecture & Runtime
- TypeScript SPA (React 18 + Vite), deployed to Vercel as static files (`vercel.json`).
- pnpm only (`packageManager` in `package.json`); Node >= 20. Do not use npm.
- Persistence: native IndexedDB in `src/db/database.ts`, versioned schema with normalization on read.
- State: one React context in `src/state/store.tsx`; mutations write through to IndexedDB immediately.
- PWA: custom `public/sw.js` for offline caching and an installable manifest.
- Optional E2E-encrypted sync relay in `server/` (Express + SQLite). It is opt-in and separate from the static build.
- Multi-environment builds use Vite's native `.env` / `.env.<mode>` files plus inlined `__APP_VERSION__`, `__APP_MODE__`, and `__BUILD_TIME__`.

### Design System (see DESIGN.md)
- GitHub Primer visual identity: data-dense layout, 1px borders, no soft shadows, corner radii at or below 6px.
- Dark and light themes use the CSS custom properties in `src/styles.css`; theme ids are `light` and `dark`.
- Desktop: global top bar, left navigation rail, main workspace, optional right detail panel.
- Mobile (<= 860px): bottom tab bar plus thumb-zone bottom sheets for creation and details.
- Use `Intl.NumberFormat` for all money and percentages; never hand-format amounts.

### Implementation Constraints
- STRICTLY FORBIDDEN: separate shared function utility libraries or placeholder/mock implementations.
- STRICTLY FORBIDDEN: extensive unit, integration, or E2E test suites. Focus on clean, production-grade application code.
- Keep it simple: readable code paths, maintainable modules, performant UI updates.
- Preserve existing behavior while migrating; run `pnpm typecheck` and `pnpm build` at the end of every stage and fix all errors. The app must boot with no console errors.
