/** Left navigation rail: ledger scopes, accounts, category groups and payees. */

import { useMemo, useState } from 'react';
import {
  FiChevronRight,
  FiPlus,
  FiSearch,
  FiSettings,
} from 'react-icons/fi';

import { useBudget } from '../state/store';
import {
  PLANNING_GROUP,
  VIEW_GROUP,
  type NavSelection,
  type TransactionScope,
  type ViewKey,
} from '../state/navigation';
import { formatMoney } from '../domain/money';
import { accountBalance } from '../domain/money';
import type { Account } from '../domain/types';

interface SidebarProps {
  selection: NavSelection;
  onSelect: (selection: NavSelection) => void;
  onAddAccount: () => void;
  onEditAccount: (account: Account) => void;
}

export function Sidebar({ selection, onSelect, onAddAccount, onEditAccount }: SidebarProps) {
  const { accounts, categories, categoryGroups, payees, transactions, settings } = useBudget();
  const [payeeQuery, setPayeeQuery] = useState('');

  const balances = useMemo(
    () => new Map(accounts.map((account) => [account.id, accountBalance(account, transactions)])),
    [accounts, transactions],
  );

  const payeeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.payeeId) counts.set(transaction.payeeId, (counts.get(transaction.payeeId) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  const uncategorizedCount = useMemo(
    () =>
      transactions.filter(
        (transaction) => transaction.type !== 'transfer' && transaction.categoryId === null,
      ).length,
    [transactions],
  );

  function selectScope(scope: TransactionScope) {
    onSelect({ ...selection, view: 'transactions', scope });
  }

  function isActive(scope: TransactionScope): boolean {
    if (selection.view !== 'transactions') return false;
    if (selection.scope.kind !== scope.kind) return false;
    switch (scope.kind) {
      case 'account':
        return selection.scope.kind === 'account' && selection.scope.accountId === scope.accountId;
      case 'group':
        return selection.scope.kind === 'group' && selection.scope.groupId === scope.groupId;
      case 'payee':
        return selection.scope.kind === 'payee' && selection.scope.payeeId === scope.payeeId;
      case 'all':
      case 'uncategorized':
        return true;
    }
  }

  const activeAccounts = accounts.filter((account) => !account.archived);
  const archivedAccounts = accounts.filter((account) => account.archived);
  const filteredPayees = payees
    .filter((payee) => payee.name.toLowerCase().includes(payeeQuery.trim().toLowerCase()))
    .slice(0, 12);

  const groupRows = [
    ...categoryGroups.map((group) => ({ id: group.id, name: group.name })),
    ...(categories.some((category) => category.groupId === null)
      ? [{ id: '', name: 'No group' }]
      : []),
  ];

  function groupCategoryNames(groupId: string): string {
    return categories
      .filter((category) => (category.groupId ?? '') === groupId && !category.archived)
      .map((category) => category.name)
      .slice(0, 3)
      .join(' · ');
  }

  return (
    <nav className="rail" aria-label="Ledger navigation">
      <div className="rail__scroll">
        <p className="rail__label">Views</p>
        {VIEW_GROUP.map((item) => {
          const Icon = item.icon;
          const scope = item.scope ?? { kind: 'all' };
          return (
            <button
              key={item.label}
              type="button"
              className={`rail__item${isActive(scope) ? ' rail__item--active' : ''}`}
              onClick={() => selectScope(scope)}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              {scope.kind === 'uncategorized' && (
                <span className="rail__count">{uncategorizedCount}</span>
              )}
            </button>
          );
        })}

        <div className="rail__section">
          <p className="rail__label">Planning</p>
          {PLANNING_GROUP.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                type="button"
                className={`rail__item${
                  selection.view === item.view ? ' rail__item--active' : ''
                }`}
                onClick={() => onSelect({ ...selection, view: item.view })}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="rail__section">
          <p className="rail__label">
            Accounts
            <button type="button" className="rail__add" onClick={onAddAccount} aria-label="Add account">
              <FiPlus />
            </button>
          </p>
          {activeAccounts.map((account) => (
            <div key={account.id} className="rail__account">
              <button
                type="button"
                className={`rail__item rail__item--account${
                  isActive({ kind: 'account', accountId: account.id }) ? ' rail__item--active' : ''
                }`}
                onClick={() => selectScope({ kind: 'account', accountId: account.id })}
              >
                <span className="dot" style={{ background: account.color }} aria-hidden="true" />
                <span className="rail__name">{account.name}</span>
                <span
                  className={`rail__balance${
                    account.type === 'credit' && (balances.get(account.id) ?? 0) < 0
                      ? ' amount--out'
                      : ''
                  }`}
                >
                  {formatMoney(
                    balances.get(account.id) ?? 0,
                    settings.currency,
                    settings.locale,
                    settings.hideBalances,
                  )}
                </span>
              </button>
              <button
                type="button"
                className="rail__edit"
                onClick={() => onEditAccount(account)}
                aria-label={`Edit ${account.name}`}
                title="Edit account"
              >
                <FiChevronRight />
              </button>
            </div>
          ))}
          {archivedAccounts.length > 0 && (
            <div className="rail__archived">
              {archivedAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className="rail__item rail__item--muted"
                  onClick={() => selectScope({ kind: 'account', accountId: account.id })}
                >
                  <span className="rail__name">{account.name}</span>
                  <span className="rail__count">Archived</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rail__section">
          <p className="rail__label">Categories</p>
          {groupRows.map((group) => (
            <button
              key={group.id || 'ungrouped'}
              type="button"
              className={`rail__item rail__item--stacked${
                isActive({ kind: 'group', groupId: group.id }) ? ' rail__item--active' : ''
              }`}
              onClick={() => selectScope({ kind: 'group', groupId: group.id })}
            >
              <span>{group.name}</span>
              <span className="rail__sub">{groupCategoryNames(group.id) || 'No categories'}</span>
            </button>
          ))}
        </div>

        <div className="rail__section">
          <p className="rail__label">Payees</p>
          <label className="rail__search">
            <FiSearch aria-hidden="true" />
            <input
              value={payeeQuery}
              onChange={(event) => setPayeeQuery(event.target.value)}
              placeholder="Search payees"
              aria-label="Search payees"
            />
          </label>
          {filteredPayees.length > 0 ? (
            filteredPayees.map((payee) => (
              <button
                key={payee.id}
                type="button"
                className={`rail__item${
                  isActive({ kind: 'payee', payeeId: payee.id }) ? ' rail__item--active' : ''
                }`}
                onClick={() => selectScope({ kind: 'payee', payeeId: payee.id })}
              >
                <span className="rail__name">{payee.name}</span>
                <span className="rail__count">{payeeCounts.get(payee.id) ?? 0}</span>
              </button>
            ))
          ) : (
            <p className="rail__empty">
              {payeeQuery ? 'No matching payees' : 'Type to find a payee'}
            </p>
          )}
        </div>
      </div>

      <div className="rail__footer">
        <button
          type="button"
          className={`rail__item${selection.view === 'settings' ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ ...selection, view: 'settings' as ViewKey })}
        >
          <FiSettings aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}
