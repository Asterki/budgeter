/** Ledger workspace: scoped, searchable, date-grouped transaction list. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FiDownload, FiPlus } from 'react-icons/fi';

import { FilterBar } from '../components/FilterBar';
import { QuickAdd } from '../components/QuickAdd';
import { TransactionRow } from '../components/TransactionRow';
import { useBudget } from '../state/store';
import type { NavSelection, TransactionScope } from '../state/navigation';
import {
  DEFAULT_FILTERS,
  filterTransactions,
  groupByDate,
  netWorth as computeNetWorth,
  periodTotals,
  runningBalances,
  scopeTransactions,
  type LedgerFilters,
} from '../domain/ledger';
import { accountBalance, formatMoney } from '../domain/money';
import { transactionsToCsv, type CsvExportRow } from '../domain/csv';
import { formatDate, todayISO } from '../domain/date';
import { plannedItems } from '../domain/recurring';
import type { Transaction } from '../domain/types';

interface TransactionsViewProps {
  selection: NavSelection;
  onSelectScope: (scope: TransactionScope) => void;
  onOpenTransaction: (transaction: Transaction) => void;
  onNewTransaction: () => void;
  searchSignal: number;
  composeSignal: number;
  categoryJump: { categoryId: string; from: string; to: string; signal: number } | null;
}

export function TransactionsView({
  selection,
  onSelectScope,
  onOpenTransaction,
  onNewTransaction,
  searchSignal,
  composeSignal,
  categoryJump,
}: TransactionsViewProps) {
  const { accounts, categories, categoryGroups, payees, transactions, recurring, settings } =
    useBudget();
  const [filters, setFilters] = useState<LedgerFilters>(DEFAULT_FILTERS);
  const [rowLimit, setRowLimit] = useState(200);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRowLimit(200);
  }, [filters, selection.scope]);

  useEffect(() => {
    if (searchSignal > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [searchSignal]);

  useEffect(() => {
    if (!categoryJump) return;
    setFilters({
      ...DEFAULT_FILTERS,
      categoryId: categoryJump.categoryId,
      from: categoryJump.from,
      to: categoryJump.to,
    });
  }, [categoryJump?.signal]);

  const scoped = useMemo(
    () => scopeTransactions(transactions, selection.scope, categories),
    [transactions, selection.scope, categories],
  );

  const payeeNames = useMemo(() => new Map(payees.map((payee) => [payee.id, payee.name])), [payees]);
  const payeesById = useMemo(() => new Map(payees.map((payee) => [payee.id, payee])), [payees]);
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const upcoming = useMemo(() => {
    const scope = selection.scope;
    return plannedItems(recurring, transactions, todayISO()).filter(({ rule }) => {
      const category = rule.categoryId ? categoriesById.get(rule.categoryId) : undefined;
      switch (scope.kind) {
        case 'account':
          return rule.accountId === scope.accountId;
        case 'payee':
          return rule.payeeId === scope.payeeId;
        case 'group':
          return (category?.groupId ?? '') === scope.groupId;
        case 'uncategorized':
          return !rule.categoryId;
        default:
          return true;
      }
    });
  }, [recurring, transactions, selection.scope, categoriesById]);

  const filtered = useMemo(
    () =>
      filterTransactions(
        scoped,
        filters,
        payeeNames,
        settings.currency,
        settings.locale,
      ),
    [scoped, filters, payeeNames, settings.currency, settings.locale],
  );

  const days = useMemo(() => groupByDate(filtered, filters.sort), [filtered, filters.sort]);
  const totals = useMemo(() => periodTotals(filtered), [filtered]);

  const visibleDays = useMemo(() => {
    let remaining = rowLimit;
    const result: typeof days = [];
    for (const day of days) {
      if (remaining <= 0) break;
      if (day.transactions.length <= remaining) {
        result.push(day);
        remaining -= day.transactions.length;
      } else {
        result.push({ ...day, transactions: day.transactions.slice(0, remaining) });
        remaining = 0;
      }
    }
    return result;
  }, [days, rowLimit]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const transaction of scoped) {
      for (const tag of transaction.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [scoped]);

  const scope = selection.scope;
  const scopedAccount =
    scope.kind === 'account'
      ? accounts.find((account) => account.id === scope.accountId)
      : undefined;

  const balances = useMemo(
    () => (scopedAccount ? runningBalances(scopedAccount, transactions) : null),
    [scopedAccount, transactions],
  );

  const heading = (() => {
    switch (scope.kind) {
      case 'account':
        return scopedAccount?.name ?? 'Account';
      case 'group': {
        const groupId = scope.groupId;
        const group = categoryGroups.find((item) => item.id === groupId);
        return group?.name ?? 'No group';
      }
      case 'uncategorized':
        return 'Uncategorized';
      case 'payee': {
        const payeeId = scope.payeeId;
        const payee = payees.find((item) => item.id === payeeId);
        return payee?.name ?? 'Payee';
      }
      case 'all':
      default:
        return 'All transactions';
    }
  })();

  const scopeValue = (() => {
    switch (selection.scope.kind) {
      case 'account':
        return `account:${selection.scope.accountId}`;
      case 'group':
        return `group:${selection.scope.groupId}`;
      case 'payee':
        return `payee:${selection.scope.payeeId}`;
      case 'all':
      case 'uncategorized':
        return selection.scope.kind;
    }
  })();

  function handleScopeChange(value: string) {
    if (value === 'all' || value === 'uncategorized') {
      onSelectScope({ kind: value });
      return;
    }
    const [kind, id] = value.split(':');
    if (kind === 'account') onSelectScope({ kind: 'account', accountId: id });
    else if (kind === 'group') onSelectScope({ kind: 'group', groupId: id });
    else if (kind === 'payee') onSelectScope({ kind: 'payee', payeeId: id });
  }

  const showAccountColumn = selection.scope.kind !== 'account';
  const hidden = settings.hideBalances;

  function exportCsv() {
    const rows: CsvExportRow[] = filtered.map((transaction) => ({
      date: transaction.date,
      account: accountsById.get(transaction.accountId)?.name ?? '',
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.categoryId ? categoriesById.get(transaction.categoryId)?.name ?? '' : '',
      payee: transaction.payeeId ? payeesById.get(transaction.payeeId)?.name ?? '' : '',
      notes: transaction.notes,
      tags: transaction.tags,
      cleared: transaction.cleared,
    }));
    if (rows.length === 0) return;
    const blob = new Blob([transactionsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `budget-transactions-${todayISO()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="ledger">
      <div className="ledger__head">
        <div>
          <h1 className="ledger__title">{heading}</h1>
          <p className="ledger__summary">
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            {scopedAccount && (
              <>
                {' · '}balance{' '}
                <strong
                  className={
                    scopedAccount.type === 'credit' &&
                    accountBalance(scopedAccount, transactions) < 0
                      ? 'amount--out'
                      : undefined
                  }
                >
                  {formatMoney(accountBalance(scopedAccount, transactions), settings.currency, settings.locale, hidden)}
                </strong>
              </>
            )}
            {' · '}in{' '}
            <span className="amount--in">
              {formatMoney(totals.income, settings.currency, settings.locale, hidden)}
            </span>
            {' · '}out{' '}
            <span className="amount--out">
              {formatMoney(totals.expense, settings.currency, settings.locale, hidden)}
            </span>
          </p>
        </div>
        <div className="ledger__head-actions">
          <select
            className="input ledger__scope-select"
            value={scopeValue}
            onChange={(event) => handleScopeChange(event.target.value)}
            aria-label="Choose ledger scope"
          >
            <option value="all">All transactions</option>
            <option value="uncategorized">Uncategorized</option>
            <optgroup label="Accounts">
              {accounts
                .filter((account) => !account.archived)
                .map((account) => (
                  <option key={account.id} value={`account:${account.id}`}>
                    {account.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Category groups">
              {categoryGroups.map((group) => (
                <option key={group.id} value={`group:${group.id}`}>
                  {group.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Payees">
              {payees.map((payee) => (
                <option key={payee.id} value={`payee:${payee.id}`}>
                  {payee.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="button"
            className="button button--ghost"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <FiDownload aria-hidden="true" />
            <span>CSV</span>
          </button>
          <button type="button" className="button button--primary" onClick={onNewTransaction}>
            <FiPlus aria-hidden="true" />
            <span>New</span>
          </button>
        </div>
      </div>

      <QuickAdd
        defaultAccountId={selection.scope.kind === 'account' ? selection.scope.accountId : undefined}
        focusSignal={composeSignal}
      />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        accounts={accounts}
        categories={categories}
        tags={availableTags}
        showAccountFilter={selection.scope.kind !== 'account'}
        searchRef={searchRef}
      />

      {upcoming.length > 0 && (
        <section className="ledger-day ledger-day--planned" aria-label="Upcoming scheduled transactions">
          <header className="ledger-day__head">
            <span className="ledger-day__date">Upcoming</span>
            <span className="ledger-day__total">Next 30 days</span>
          </header>
          <div className="ledger-day__rows">
            {upcoming.map(({ rule, date }) => {
              const category = rule.categoryId ? categoriesById.get(rule.categoryId) : undefined;
              const payee = rule.payeeId ? payeesById.get(rule.payeeId) : undefined;
              const title = payee?.name || rule.notes.trim() || category?.name || 'Scheduled';
              return (
                <div key={`${rule.id}-${date}`} className="tx-row tx-row--planned">
                  <span
                    className="tx-row__marker tx-row__marker--planned"
                    style={{ background: category?.color ?? accountsById.get(rule.accountId)?.color }}
                    aria-hidden="true"
                  />
                  <span className="tx-row__main">
                    <span className="tx-row__title">{title}</span>
                    <span className="tx-row__meta">
                      <span className="tx-row__chip">Planned</span>
                      <span className="tx-row__chip">{formatDate(date)}</span>
                      {category && <span className="tx-row__chip">{category.name}</span>}
                      {showAccountColumn && (
                        <span className="tx-row__chip">
                          {accountsById.get(rule.accountId)?.name ?? 'Account'}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tx-row__side">
                    <span
                      className={`tx-row__amount ${
                        rule.amount > 0 ? 'tx-row__amount--in' : 'tx-row__amount--out'
                      }`}
                    >
                      {formatMoney(rule.amount, settings.currency, settings.locale, hidden)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {days.length === 0 && upcoming.length === 0 ? (
        <div className="empty-state">
          <h2>No transactions yet</h2>
          <p>
            {filters.search || filters.categoryId !== 'all' || filters.accountId !== 'all'
              ? 'Nothing matches these filters. Clear them or switch scope.'
              : 'Record your first expense, income or transfer to start the ledger.'}
          </p>
          <button type="button" className="button button--primary" onClick={onNewTransaction}>
            <FiPlus aria-hidden="true" />
            Add transaction
          </button>
        </div>
      ) : (
        <div className="ledger__days">
          {visibleDays.map((day) => (
            <section key={day.date} className="ledger-day">
              <header className="ledger-day__head">
                <span className="ledger-day__date">{formatDate(day.date)}</span>
                <span
                  className={`ledger-day__total ${
                    day.total > 0 ? 'amount--in' : day.total < 0 ? 'amount--out' : ''
                  }`}
                >
                  {formatMoney(day.total, settings.currency, settings.locale, hidden)}
                </span>
              </header>
              <div className="ledger-day__rows">
                {day.transactions.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    account={accountsById.get(transaction.accountId)}
                    category={
                      transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined
                    }
                    payee={transaction.payeeId ? payeesById.get(transaction.payeeId) : undefined}
                    transferAccount={
                      transaction.transferAccountId
                        ? accountsById.get(transaction.transferAccountId)
                        : undefined
                    }
                    currency={settings.currency}
                    locale={settings.locale}
                    runningBalance={balances?.get(transaction.id)}
                    showAccount={showAccountColumn}
                    masked={hidden}
                    onOpen={() => onOpenTransaction(transaction)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {filtered.length > rowLimit && (
        <div className="ledger__more">
          <span className="hint">
            Showing {rowLimit} of {filtered.length} entries
          </span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setRowLimit((current) => current + 200)}
          >
            Load more
          </button>
        </div>
      )}

      {scopedAccount && (
        <p className="ledger__net">
          Net worth across active accounts:{' '}
          <strong>
            {formatMoney(
              computeNetWorth(accounts, transactions),
              settings.currency,
              settings.locale,
              hidden,
            )}
          </strong>
        </p>
      )}
    </section>
  );
}
