# Budget — Design System

Budget follows the GitHub Primer visual identity: dense, functional layouts built
from borders and surface contrast rather than shadows. The app ships a light and
a dark theme; both are driven by the custom properties in `src/styles.css`.

## Tokens

### Colour

| Role | Dark | Light |
| --- | --- | --- |
| Canvas | `#0d1117` | `#ffffff` |
| Subtle surface | `#161b22` | `#f6f8fa` |
| Raised surface | `#161b22` | `#ffffff` |
| Border | `#30363d` | `#d0d7de` |
| Subtle border | `#21262d` | `#eaeef2` |
| Primary text | `#c9d1d9` | `#24292f` |
| Muted text | `#8b949e` | `#57606a` |
| Accent / focus | `#58a6ff` | `#0969da` |
| Accent emphasis | `#1f6feb` | `#0969da` |
| Success | `#3fb950` | `#1a7f37` |
| Warning | `#d29922` | `#9a6700` |
| Danger | `#f85149` | `#cf222e` |

Dark is the reference theme (`:root[data-theme='dark']`); light is the default
`:root` token set. Theme ids are exactly `light` and `dark`.

### Typography

- Sans: `Mona Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`
- Mono: `SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
- Body copy is 14–16px depending on density; headings use semibold weight.
- Use the mono stack only for codes, identifiers, and tabular figures.

### Space & shape

- 4px density grid: 8 / 16 / 24px spacing steps.
- Radii: 4px small, 6px medium; never above 6px except badges and pills.
- Elevation comes from layered borders and contrasting surfaces. No fuzzy drop
  shadows on standard boxes.

## Layout

- **Desktop:** top bar (search, progress, utilities), left navigation rail,
  central workspace, optional right detail panel.
- **Mobile (<= 860px):** single column, bottom tab bar, floating add action, and
  bottom sheets for create/detail flows. Sheets close by swipe or `Escape`.
- Content is data-dense: tables and lists use 1px separators, not gaps.

## Components

- **Buttons:** primary uses the accent emphasis background; secondary uses a
  subtle surface with a 1px border; destructive actions use danger text and only
  fill with danger on an active/hover state.
- **Cards:** subtle surface, 1px default border, 6px radius, zero outer shadow.
- **Inputs:** 1px border, accent focus ring, no rounded pill shapes.
- **Dialogs:** compact centred modal with a header, body and footer; on mobile it
  may become a bottom sheet. Destructive confirmation is always explicit.
- **Money:** right-aligned tabular figures, currency symbol from
  `Intl.NumberFormat`, negative values use the danger colour, and stored amounts
  are never rendered raw.

## Anti-patterns

- No soft or coloured shadows, glassmorphism, or gradient page backgrounds.
- No corner radii above 6px on cards, inputs, or dialogs.
- No decorative illustrations or empty marketing sections.
- No floating-point money formatting; never use `toFixed` on stored amounts.
