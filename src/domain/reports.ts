/**
 * Reporting aggregations.
 *
 * Every function is pure and works on in-memory records. Amounts stay in
 * integer cents; spending is returned as a positive magnitude so charts and
 * tables do not have to flip signs. Transfers are excluded from income and
 * spending because they only move money between accounts.
 */

import {
  MONTHS,
  addDays,
  addMonths,
  daysBetween,
  formatDateShort,
  startOfMonth,
  startOfWeek,
} from './date';
import type { Account, Category, Payee, Transaction } from './types';

export type ReportRangeKind = 'month' | 'quarter' | 'year' | 'custom';
export type SeriesBucket = 'day' | 'week' | 'month';

export interface ReportRange {
  from: string;
  to: string;
}

/** Calendar range for a preset, anchored on any day inside the period. */
export function resolveRange(
  kind: ReportRangeKind,
  anchor: string,
  custom?: ReportRange,
): ReportRange {
  if (kind === 'custom') {
    if (!custom || !custom.from || !custom.to) return { from: anchor, to: anchor };
    return custom.from <= custom.to
      ? { from: custom.from, to: custom.to }
      : { from: custom.to, to: custom.from };
  }

  if (kind === 'month') {
    const from = startOfMonth(anchor);
    return { from, to: addDays(addMonths(from, 1), -1) };
  }

  if (kind === 'quarter') {
    const month = Number(anchor.slice(5, 7)) - 1;
    const quarterStart = startOfMonth(`${anchor.slice(0, 4)}-${String(Math.floor(month / 3) * 3 + 1).padStart(2, '0')}-01`);
    return { from: quarterStart, to: addDays(addMonths(quarterStart, 3), -1) };
  }

  const from = `${anchor.slice(0, 4)}-01-01`;
  return { from, to: `${anchor.slice(0, 4)}-12-31` };
}

/** The equally long period immediately before `range`. */
export function previousRange(range: ReportRange): ReportRange {
  const days = daysBetween(range.from, range.to) + 1;
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

export function inRange(date: string, range: ReportRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Bucket width that keeps a chart readable for the selected range. */
export function bucketFor(range: ReportRange): SeriesBucket {
  const days = daysBetween(range.from, range.to) + 1;
  if (days <= 45) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

function bucketStart(date: string, bucket: SeriesBucket): string {
  if (bucket === 'week') return startOfWeek(date);
  if (bucket === 'month') return startOfMonth(date);
  return date;
}

function addBucket(date: string, bucket: SeriesBucket): string {
  if (bucket === 'week') return addDays(date, 7);
  if (bucket === 'month') return addMonths(date, 1);
  return addDays(date, 1);
}

function bucketEnd(date: string, bucket: SeriesBucket): string {
  if (bucket === 'week') return addDays(date, 6);
  if (bucket === 'month') return addDays(addMonths(date, 1), -1);
  return date;
}

function bucketLabel(date: string, bucket: SeriesBucket): string {
  if (bucket === 'month') {
    const month = Number(date.slice(5, 7)) - 1;
    return `${MONTHS[month].slice(0, 3)} ${date.slice(0, 4)}`;
  }
  return formatDateShort(date);
}

interface Bucket {
  start: string;
  end: string;
  label: string;
}

function buckets(range: ReportRange, bucket: SeriesBucket): Bucket[] {
  const list: Bucket[] = [];
  let cursor = bucketStart(range.from, bucket);
  while (cursor <= range.to) {
    list.push({
      start: cursor,
      end: bucketEnd(cursor, bucket),
      label: bucketLabel(cursor, bucket),
    });
    cursor = addBucket(cursor, bucket);
  }
  return list;
}

export interface PeriodPoint {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
}

/** Income, spending and net per bucket, zero-filled. */
export function periodSeries(
  transactions: readonly Transaction[],
  range: ReportRange,
  bucket: SeriesBucket = bucketFor(range),
): PeriodPoint[] {
  const rows = transactions.filter(
    (transaction) => transaction.type !== 'transfer' && inRange(transaction.date, range),
  );

  return buckets(range, bucket).map((current) => {
    let income = 0;
    let expense = 0;
    for (const transaction of rows) {
      if (transaction.date < current.start || transaction.date > current.end) continue;
      if (transaction.type === 'income') income += transaction.amount;
      else expense += -transaction.amount;
    }
    return {
      key: current.start,
      label: current.label,
      income,
      expense,
      net: income - expense,
    };
  });
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  color: string;
  total: number;
}

/** Spending grouped by category, largest first. Uncategorized is included. */
export function spendingByCategory(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  range: ReportRange,
): CategorySlice[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const totals = new Map<string | null, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense' || !inRange(transaction.date, range)) continue;
    const key = transaction.categoryId;
    totals.set(key, (totals.get(key) ?? 0) + -transaction.amount);
  }

  const slices: CategorySlice[] = [];
  for (const [categoryId, total] of totals) {
    if (total <= 0) continue;
    const category = categoryId ? byId.get(categoryId) : undefined;
    slices.push({
      categoryId,
      name: category?.name ?? 'Uncategorized',
      color: category?.color ?? '#8b949e',
      total,
    });
  }

  return slices.sort((a, b) => b.total - a.total);
}

export interface NetWorthPoint {
  key: string;
  label: string;
  value: number;
}

/** Net worth at the end of each bucket, across non-archived accounts. */
export function netWorthSeries(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  range: ReportRange,
  bucket: SeriesBucket = bucketFor(range),
): NetWorthPoint[] {
  const active = accounts.filter((account) => !account.archived);
  const activeIds = new Set(active.map((account) => account.id));
  let balance = active.reduce((total, account) => total + account.openingBalance, 0);

  for (const transaction of transactions) {
    if (!activeIds.has(transaction.accountId)) continue;
    if (transaction.date < range.from) balance += transaction.amount;
  }

  const points: NetWorthPoint[] = [];
  let cursor = range.from;
  for (const current of buckets(range, bucket)) {
    const end = current.end > range.to ? range.to : current.end;
    let change = 0;
    for (const transaction of transactions) {
      if (!activeIds.has(transaction.accountId)) continue;
      if (transaction.date < cursor || transaction.date > end) continue;
      change += transaction.amount;
    }
    balance += change;
    points.push({ key: current.start, label: current.label, value: balance });
    cursor = addDays(end, 1);
  }

  return points;
}

export interface PayeeTotal {
  payeeId: string;
  name: string;
  total: number;
  count: number;
}

/** Largest spending recipients in the range. */
export function topPayees(
  transactions: readonly Transaction[],
  payees: readonly Payee[],
  range: ReportRange,
  limit = 5,
): PayeeTotal[] {
  const names = new Map(payees.map((payee) => [payee.id, payee.name]));
  const totals = new Map<string, { total: number; count: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense' || !transaction.payeeId) continue;
    if (!inRange(transaction.date, range)) continue;
    const current = totals.get(transaction.payeeId) ?? { total: 0, count: 0 };
    current.total += -transaction.amount;
    current.count += 1;
    totals.set(transaction.payeeId, current);
  }

  return [...totals]
    .map(([payeeId, value]) => ({
      payeeId,
      name: names.get(payeeId) ?? 'Unknown payee',
      total: value.total,
      count: value.count,
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(1, limit));
}

export interface RangeTotals {
  income: number;
  expense: number;
  net: number;
  savingsRate: number;
}

export function rangeTotals(transactions: readonly Transaction[], range: ReportRange): RangeTotals {
  let income = 0;
  let expense = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'transfer' || !inRange(transaction.date, range)) continue;
    if (transaction.type === 'income') income += transaction.amount;
    else expense += -transaction.amount;
  }

  return {
    income,
    expense,
    net: income - expense,
    savingsRate: income > 0 ? (income - expense) / income : 0,
  };
}

export interface CategoryTrend {
  categoryId: string | null;
  name: string;
  color: string;
  current: number;
  previous: number;
  delta: number;
  changePct: number | null;
}

/** Category spending compared with the immediately preceding period. */
export function categoryTrends(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  range: ReportRange,
): CategoryTrend[] {
  const current = spendingByCategory(transactions, categories, range);
  const before = spendingByCategory(transactions, categories, previousRange(range));
  const beforeById = new Map(before.map((slice) => [slice.categoryId, slice.total]));
  const seen = new Set<string | null>();

  const rows: CategoryTrend[] = current.map((slice) => {
    seen.add(slice.categoryId);
    const previous = beforeById.get(slice.categoryId) ?? 0;
    const delta = slice.total - previous;
    return {
      categoryId: slice.categoryId,
      name: slice.name,
      color: slice.color,
      current: slice.total,
      previous,
      delta,
      changePct: previous > 0 ? (delta / previous) * 100 : null,
    };
  });

  for (const slice of before) {
    if (seen.has(slice.categoryId)) continue;
    rows.push({
      categoryId: slice.categoryId,
      name: slice.name,
      color: slice.color,
      current: 0,
      previous: slice.total,
      delta: -slice.total,
      changePct: -100,
    });
  }

  return rows.sort((a, b) => b.current - a.current || b.previous - a.previous);
}
