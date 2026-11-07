/**
 * Money helpers.
 *
 * Stored amounts are always integers in minor units (cents). Only display code
 * converts to a decimal number, and only through `Intl.NumberFormat`.
 */

import type { Account, Transaction } from './types';

/** Decimal separator used by a locale, falling back to a dot. */
function decimalSeparator(locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
        ?.value ?? '.'
    );
  } catch {
    return '.';
  }
}

/**
 * Rewrites a number that may use either `1,234.56` or `1.234,56` conventions
 * into plain `digits.decimals`.
 */
function normalizeNumber(raw: string, locale: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return '';

  const localeDecimal = decimalSeparator(locale);
  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');

  if (hasDot && hasComma) {
    const decimal = cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    return cleaned.split(group).join('').replace(decimal, '.');
  }

  if (hasComma) {
    const parts = cleaned.split(',');
    if (parts.length > 2) return parts.join('');
    const [whole, fraction] = parts;
    // `1,234` is a thousands group; `12,5` is a decimal comma.
    if (localeDecimal === ',' || fraction.length !== 3) return `${whole}.${fraction}`;
    return parts.join('');
  }

  if (hasDot) {
    const parts = cleaned.split('.');
    if (parts.length > 2) return localeDecimal === ',' ? parts.join('') : cleaned;
    // In comma-decimal locales `1.234` is one thousand two hundred thirty-four.
    if (localeDecimal === ',' && parts[1].length === 3) return parts.join('');
    return cleaned;
  }

  return cleaned;
}

/**
 * Parses a human-entered amount into cents.
 *
 * Accepts `-12.50`, `(12.50)`, `$1,234.5`, `1.234,56` (locale-aware) and
 * `12,5`, and returns `NaN` when no number can be read.
 */
export function parseAmount(input: string, locale = 'en-US'): number {
  const raw = input.trim();
  if (!raw) return Number.NaN;

  const negative = raw.startsWith('-') || (raw.startsWith('(') && raw.endsWith(')'));
  const unsignedRaw = raw.replace(/[^\d.,-]/g, '').replace(/-/g, '');
  if (!unsignedRaw) return Number.NaN;

  const normalized = normalizeNumber(unsignedRaw, locale);
  if (!normalized) return Number.NaN;

  const parts = normalized.split('.');
  if (parts.length > 2) return Number.NaN;

  const whole = Number.parseInt(parts[0] || '0', 10);
  if (!Number.isFinite(whole)) return Number.NaN;

  let cents = 0;
  if (parts.length === 2) {
    const fraction = parts[1];
    const padded = `${fraction}00`.slice(0, 2);
    cents = Number.parseInt(padded || '0', 10);
    // Round half away from zero on the third decimal.
    if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1;
  }

  const total = whole * 100 + cents;
  return negative ? -total : total;
}

/** Formats integer cents for display using the configured currency and locale. */
export function formatMoney(
  cents: number,
  currency: string,
  locale: string,
  hidden = false,
): string {
  if (hidden) return '••••';
  if (!Number.isFinite(cents)) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // A half-typed currency or locale should never take the app down.
    return `${(cents / 100).toFixed(2)} ${currency}`.trim();
  }
}

/** Sums a derived number over a list. */
export function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}

/** Opening balance plus every posted transaction on the account, in cents. */
export function accountBalance(account: Account, transactions: readonly Transaction[]): number {
  return transactions
    .filter((transaction) => transaction.accountId === account.id)
    .reduce((balance, transaction) => balance + transaction.amount, account.openingBalance);
}

/** Money owed on a credit account, in positive cents. */
export function creditOwed(account: Account, transactions: readonly Transaction[]): number {
  return Math.max(0, -accountBalance(account, transactions));
}

/**
 * Remaining credit, in cents, or `null` when the account has no limit set.
 * A positive balance (overpayment) leaves the whole limit available.
 */
export function creditAvailable(
  account: Account,
  transactions: readonly Transaction[],
): number | null {
  if (!account.creditLimit) return null;
  return Math.max(0, account.creditLimit - creditOwed(account, transactions));
}

/**
 * Signed activity for a category in a `YYYY-MM` month. Spending reads negative;
 * transfers are ignored because they do not change net worth.
 */
export function categoryActivity(
  transactions: readonly Transaction[],
  categoryId: string,
  month: string,
): number {
  return transactions
    .filter(
      (transaction) =>
        transaction.categoryId === categoryId &&
        transaction.type !== 'transfer' &&
        transaction.date.startsWith(month),
    )
    .reduce((total, transaction) => total + transaction.amount, 0);
}
