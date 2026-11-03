/**
 * Global menu bar.
 *
 * Search lives on the left, utility actions on the right. The shell has no
 * logo or window chrome — the workspace itself carries the identity.
 */

import { FiHelpCircle, FiMoon, FiPlus, FiSearch, FiSun } from 'react-icons/fi';
import type { Settings } from '../domain/types';
import { ProgressHud } from './ProgressHud';

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
        <button type="button" className="search-trigger" onClick={onFocusSearch}>
          <FiSearch aria-hidden="true" />
          <span className="search-trigger__label">Search tasks</span>
          <kbd>/</kbd>
        </button>
      </div>

      <div className="topbar__right">
        <ProgressHud />
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          title={theme === 'nordic-light' ? 'Switch to dark' : 'Switch to light'}
          aria-label="Toggle theme"
        >
          {theme === 'nordic-light' ? <FiMoon aria-hidden="true" /> : <FiSun aria-hidden="true" />}
        </button>
        <button type="button" className="icon-button" onClick={onOpenManual} title="User manual" aria-label="User manual">
          <FiHelpCircle aria-hidden="true" />
        </button>
        <button type="button" className="button button--primary" onClick={onFocusQuickAdd}>
          <FiPlus aria-hidden="true" />
          Add task
        </button>
      </div>
    </header>
  );
}
