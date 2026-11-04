/** Toolbar for the ledger: live search, filters and sorting. */

import type { RefObject } from 'react';
import { FiFilter, FiX } from 'react-icons/fi';

import type { Account, Category } from '../domain/types';
import type { LedgerFilters, LedgerSort } from '../domain/ledger';

interface FilterBarProps {
  filters: LedgerFilters;
  onChange: (next: LedgerFilters) => void;
  accounts: Account[];
  categories: Category[];
  tags: string[];
  showAccountFilter: boolean;
  searchRef: RefObject<HTMLInputElement>;
}

const SORT_LABELS: { value: LedgerSort; label: string }[] = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'amount-desc', label: 'Largest amount' },
  { value: 'amount-asc', label: 'Smallest amount' },
];

export function FilterBar({
  filters,
  onChange,
  accounts,
  categories,
  tags,
  showAccountFilter,
  searchRef,
}: FilterBarProps) {
  function patch(next: Partial<LedgerFilters>) {
    onChange({ ...filters, ...next });
  }

  const hasFilters =
    filters.search ||
    filters.from ||
    filters.to ||
    filters.categoryId !== 'all' ||
    filters.accountId !== 'all' ||
    filters.tag ||
    filters.cleared !== 'all' ||
    filters.sort !== 'date-desc';

  return (
    <div className="filter-bar">
      <div className="filter-bar__row">
        <label className="search-field">
          <span className="search-field__icon" aria-hidden="true">
            <FiFilter />
          </span>
          <input
            ref={searchRef}
            className="input search-field__input"
            value={filters.search}
            onChange={(event) => patch({ search: event.target.value })}
            placeholder="Search payee, notes or amount…"
            aria-label="Search transactions"
          />
          <kbd className="search-field__kbd">/</kbd>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">From</span>
          <input
            className="input"
            type="date"
            value={filters.from}
            onChange={(event) => patch({ from: event.target.value })}
          />
        </label>
        <label className="filter-field">
          <span className="filter-field__label">To</span>
          <input
            className="input"
            type="date"
            value={filters.to}
            onChange={(event) => patch({ to: event.target.value })}
          />
        </label>

        {showAccountFilter && (
          <label className="filter-field">
            <span className="filter-field__label">Account</span>
            <select
              className="input"
              value={filters.accountId}
              onChange={(event) => patch({ accountId: event.target.value })}
            >
              <option value="all">All accounts</option>
              {accounts
                .filter((account) => !account.archived)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </label>
        )}

        <label className="filter-field">
          <span className="filter-field__label">Category</span>
          <select
            className="input"
            value={filters.categoryId}
            onChange={(event) => patch({ categoryId: event.target.value })}
          >
            <option value="all">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {categories
              .filter((category) => !category.archived)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Tag</span>
          <select className="input" value={filters.tag} onChange={(event) => patch({ tag: event.target.value })}>
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Status</span>
          <select
            className="input"
            value={filters.cleared}
            onChange={(event) =>
              patch({ cleared: event.target.value as LedgerFilters['cleared'] })
            }
          >
            <option value="all">All</option>
            <option value="cleared">Cleared</option>
            <option value="uncleared">Uncleared</option>
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Sort</span>
          <select
            className="input"
            value={filters.sort}
            onChange={(event) => patch({ sort: event.target.value as LedgerSort })}
          >
            {SORT_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasFilters && (
          <button
            type="button"
            className="button button--ghost filter-bar__clear"
            onClick={() => {
              const { search, ...rest } = filters;
              onChange({
                ...rest,
                search: '',
                from: '',
                to: '',
                categoryId: 'all',
                accountId: 'all',
                tag: '',
                cleared: 'all',
                sort: 'date-desc',
              });
              if (search) searchRef.current?.focus();
            }}
          >
            <FiX aria-hidden="true" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
