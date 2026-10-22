/**
 * Filter / sort / grouping controls for the Tasks view.
 * Search input is debounced by the view before it hits the list.
 */

import type { Ref } from 'react';
import type { Priority } from '../domain/types';

export type SortKey = 'manual' | 'date' | 'priority' | 'created' | 'alpha';
export type GroupKey = 'none' | 'date' | 'project' | 'priority' | 'lane' | 'place';

export interface FilterState {
  search: string;
  sort: SortKey;
  groupBy: GroupKey;
  priority: Priority | 'all';
  showCompleted: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  sort: 'date',
  groupBy: 'date',
  priority: 'all',
  showCompleted: false,
};

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  resultCount: number;
  inputRef?: Ref<HTMLInputElement>;
}

export function FilterBar({ filters, onChange, resultCount, inputRef }: FilterBarProps) {
  const patch = (partial: Partial<FilterState>) => onChange({ ...filters, ...partial });

  return (
    <div className="filter-bar">
      <div className="filter-bar__search">
        <span className="filter-bar__icon" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={inputRef}
          className="input"
          type="search"
          value={filters.search}
          placeholder="Filter tasks…"
          onChange={(event) => patch({ search: event.target.value })}
          aria-label="Filter tasks"
        />
        {filters.search && (
          <button type="button" className="icon-button" onClick={() => patch({ search: '' })} aria-label="Clear filter">
            ✕
          </button>
        )}
      </div>

      <label className="filter-bar__control">
        <span className="sr-only">Sort by</span>
        <select className="input" value={filters.sort} onChange={(event) => patch({ sort: event.target.value as SortKey })}>
          <option value="date">Sort: Due date</option>
          <option value="priority">Sort: Priority</option>
          <option value="created">Sort: Created</option>
          <option value="alpha">Sort: A → Z</option>
          <option value="manual">Sort: Manual</option>
        </select>
      </label>

      <label className="filter-bar__control">
        <span className="sr-only">Group by</span>
        <select
          className="input"
          value={filters.groupBy}
          onChange={(event) => patch({ groupBy: event.target.value as GroupKey })}
        >
          <option value="date">Group: Date</option>
          <option value="project">Group: Project</option>
          <option value="priority">Group: Priority</option>
          <option value="place">Group: Place</option>
          <option value="lane">Group: Lane</option>
          <option value="none">Group: None</option>
        </select>
      </label>

      <label className="filter-bar__control">
        <span className="sr-only">Priority</span>
        <select
          className="input"
          value={String(filters.priority)}
          onChange={(event) =>
            patch({ priority: event.target.value === 'all' ? 'all' : (Number(event.target.value) as Priority) })
          }
        >
          <option value="all">All priorities</option>
          <option value="1">P1 only</option>
          <option value="2">P2 only</option>
          <option value="3">P3 only</option>
          <option value="4">P4 only</option>
        </select>
      </label>

      <label className="filter-bar__toggle">
        <input
          type="checkbox"
          checked={filters.showCompleted}
          onChange={(event) => patch({ showCompleted: event.target.checked })}
        />
        <span>Done</span>
      </label>

      <span className="filter-bar__count">{resultCount}</span>
    </div>
  );
}
