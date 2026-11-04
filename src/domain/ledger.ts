/**
 * Pure ledger queries: scoping, filtering, sorting, grouping and running
 * balances. Everything works on the in-memory transaction list; no IndexedDB
 * or React types leak in here.
 */

import { accountBalance, formatMoney } from './money';
import type { Account, Category, Transaction } from './types';
import type { TransactionScope } from '../state/navigation';

export type LedgerSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
export type ClearedFilter = 'all' | 'cleared' | 'uncleared';

export interface LedgerFilters {
  search: string;
  from: string;
  to: string;
  /** A category id, `'uncategorized'`, or `'all'`. */
  categoryId: string;
  /** An account id or `'all'`. */
  accountId: string;
  tag: string;
  cleared: ClearedFilter;
  sort: LedgerSort;
}

export const DEFAULT_FILTERS: LedgerFilters = {
  search: '',
  from: '',
  to: '',
  categoryId: 'all',
  accountId: 'all',
  tag: '',
  cleared: 'all',
  sort: 'date-desc',
};

/** Narrows the full ledger to the navigation scope chosen in the rail. */
export function scopeTransactions(
  transactions: readonly Transaction[],
  scope: TransactionScope,
  categories: readonly Category[],
): Transaction[] {
  switch (scope.kind) {
    case 'account':
      return transactions.filter((transaction) => transaction.accountId === scope.accountId);
    case 'group': {
      const ids = new Set(
        categories
          .filter((category) => (category.groupId ?? '') === scope.groupId)
          .map((category) => category.id),
      );
      return transactions.filter(
        (transaction) => transaction.categoryId !== null && ids.has(transaction.categoryId),
      );
    }
    case 'uncategorized':
      return transactions.filter(
        (transaction) => transaction.type !== 'transfer' && transaction.categoryId === null,
      );
    case 'payee':
      return transactions.filter((transaction) => transaction.payeeId === scope.payeeId);
    case 'all':
      return [...transactions];
  }
}

/**
 * Applies the toolbar filters. Search covers the payee name, notes and the
 * displayed amount, which is what people usually type into a ledger search.
 */
export function filterTransactions(
  transactions: readonly Transaction[],
  filters: LedgerFilters,
  payeeNames: ReadonlyMap<string, string>,
  currency: string,
  locale: string,
): Transaction[] {
  const search = filters.search.trim().toLowerCase();

  return transactions.filter((transaction) => {
    if (filters.from && transaction.date < filters.from) return false;
    if (filters.to && transaction.date > filters.to) return false;
    if (filters.categoryId !== 'all') {
      if (filters.categoryId === 'uncategorized') {
        if (transaction.type === 'transfer' || transaction.categoryId !== null) return false;
      } else if (transaction.categoryId !== filters.categoryId) {
        return false;
      }
    }
    if (filters.accountId !== 'all' && transaction.accountId !== filters.accountId) return false;
    if (filters.tag && !transaction.tags.includes(filters.tag)) return false;
    if (filters.cleared === 'cleared' && !transaction.cleared) return false;
    if (filters.cleared === 'uncleared' && transaction.cleared) return false;

    if (!search) return true;
    const payee = transaction.payeeId ? (payeeNames.get(transaction.payeeId) ?? '') : '';
    const amount = formatMoney(Math.abs(transaction.amount), currency, locale).toLowerCase();
    const plainAmount = (Math.abs(transaction.amount) / 100).toFixed(2);
    return (
      payee.toLowerCase().includes(search) ||
      transaction.notes.toLowerCase().includes(search) ||
      transaction.tags.some((tag) => tag.toLowerCase().includes(search)) ||
      amount.includes(search) ||
      plainAmount.includes(search)
    );
  });
}

export function sortTransactions(
  transactions: readonly Transaction[],
  sort: LedgerSort,
): Transaction[] {
  const byRecent = (a: Transaction, b: Transaction) =>
    b.createdAt - a.createdAt || b.updatedAt - a.updatedAt;

  const copy = [...transactions];
  switch (sort) {
    case 'date-asc':
      return copy.sort((a, b) => a.date.localeCompare(b.date) || byRecent(a, b));
    case 'amount-desc':
      return copy.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || byRecent(a, b));
    case 'amount-asc':
      return copy.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount) || byRecent(a, b));
    case 'date-desc':
    default:
      return copy.sort((a, b) => b.date.localeCompare(a.date) || byRecent(a, b));
  }
}

export interface TransactionDay {
  date: string;
  transactions: Transaction[];
  /** Net movement for the day, in cents. */
  total: number;
}

/** Groups rows by calendar day, keeping the sort order of the dates. */
export function groupByDate(transactions: readonly Transaction[], sort: LedgerSort): TransactionDay[] {
  const days = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const bucket = days.get(transaction.date);
    if (bucket) bucket.push(transaction);
    else days.set(transaction.date, [transaction]);
  }

  const chronological = sort === 'date-asc';
  const dates = [...days.keys()].sort((a, b) =>
    chronological ? a.localeCompare(b) : b.localeCompare(a),
  );

  return dates.map((date) => {
    const rows = sortTransactions(days.get(date) ?? [], sort);
    return {
      date,
      transactions: rows,
      total: rows.reduce((sum, transaction) => sum + transaction.amount, 0),
    };
  });
}

/**
 * Balance after each transaction on one account, keyed by transaction id.
 * Computed over the whole account history so filters never change the number.
 */
export function runningBalances(
  account: Account,
  transactions: readonly Transaction[],
): Map<string, number> {
  const ordered = [...transactions]
    .filter((transaction) => transaction.accountId === account.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  const balances = new Map<string, number>();
  let balance = account.openingBalance;
  for (const transaction of ordered) {
    balance += transaction.amount;
    balances.set(transaction.id, balance);
  }
  return balances;
}

/** Total of every non-archived account. */
export function netWorth(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): number {
  return accounts
    .filter((account) => !account.archived)
    .reduce((total, account) => total + accountBalance(account, transactions), 0);
}

/** Money in and out for a set of rows, ignoring transfer pairs. */
export function periodTotals(transactions: readonly Transaction[]): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const transaction of transactions) {
    if (transaction.type === 'transfer') continue;
    if (transaction.amount >= 0) income += transaction.amount;
    else expense += transaction.amount;
  }
  return { income, expense };
}
