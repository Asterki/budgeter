/**
 * Global menu bar.
 *
 * Follows the Nordic "quiet chrome" convention: the window controls sit at the
 * far left, the brand sits next to them, and the search + primary action sit on
 * the right so the eye always lands on the left edge first.
 */

import type { Settings } from '../domain/types';

interface TopBarProps {
  theme: Settings['theme'];
  onToggleTheme: () => void;
  onFocusSearch: () => void;
  onFocusQuickAdd: () => void;
  onOpenManual: () => void;
}

export function TopBar({ theme, onToggleTheme, onFocusSearch, onFocusQuickAdd, onOpenManual }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="window-controls" aria-hidden="true">
          <span className="window-control window-control--close" />
          <span className="window-control window-control--min" />
          <span className="window-control window-control--max" />
        </div>
        <span className="brand">
          <span className="brand__mark">T</span>
          Tasker
        </span>
      </div>

      <div className="topbar__center">
        <button type="button" className="search-trigger" onClick={onFocusSearch}>
          <span aria-hidden="true">⌕</span>
          <span className="search-trigger__label">Search tasks</span>
          <kbd>/</kbd>
        </button>
      </div>

      <div className="topbar__right">
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          title={theme === 'nordic-light' ? 'Switch to dark' : 'Switch to light'}
          aria-label="Toggle theme"
        >
          {theme === 'nordic-light' ? '☾' : '☀'}
        </button>
        <button type="button" className="icon-button" onClick={onOpenManual} title="User manual" aria-label="User manual">
          ?
        </button>
        <button type="button" className="button button--primary" onClick={onFocusQuickAdd}>
          ＋ Add task
        </button>
      </div>
    </header>
  );
}
