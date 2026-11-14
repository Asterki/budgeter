/** The two controls Tasker keeps in the top bar: search and add. */

import { FiPlus, FiSearch } from 'react-icons/fi';

import { ProgressHud } from './ProgressHud';

interface TopBarProps {
  onAdd: () => void;
  onSearch: () => void;
}

export function TopBar({ onAdd, onSearch }: TopBarProps) {
  return (
    <>
      <button type="button" className="topbar__search" onClick={onSearch}>
        <FiSearch aria-hidden="true" />
        <span>Search transactions</span>
        <kbd>/</kbd>
      </button>

      <div className="topbar__spacer" />

      <ProgressHud />

      <button type="button" className="button button--primary topbar__add" onClick={onAdd}>
        <FiPlus aria-hidden="true" />
        <span>Add transaction</span>
        <kbd>n</kbd>
      </button>
    </>
  );
}
