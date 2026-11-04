/**
 * Natural-language transaction parser.
 *
 * One line such as `coffee 4.50 @Starbucks #Food` becomes a complete draft:
 * signed amount, type, account, category, payee, tags, date and recurrence.
 * Unknown payees and categories are reported so the UI can offer a
 * confirmation chip; an unknown account is an error because silently creating
 * accounts would make balances unpredictable.
 */

import {
  MONTHS,
  addDays,
  addMonths,
  addYears,
  formatDate,
  fromISODate,
  isValidISODate,
  todayISO,
  weekdayOf,
} from './date';
import { formatMoney, parseAmount } from './money';
import { describeRecurrence } from './recurrence';
import type {
  Account,
  Category,
  Payee,
  RecurrenceFreq,
  RecurrenceRule,
} from './types';

export interface ParseContext {
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  /** Account used when the line does not mention one. */
  defaultAccountId?: string | null;
  currency: string;
  locale: string;
  /** Injectable clock, `YYYY-MM-DD`. Defaults to today. */
  today?: string;
}

export type ParsedTransactionType = 'expense' | 'income' | 'transfer';

export type ParsedTokenKind =
  | 'amount'
  | 'payee'
  | 'category'
  | 'account'
  | 'tag'
  | 'cleared'
  | 'date'
  | 'recurrence'
  | 'transfer';

export interface ParsedToken {
  kind: ParsedTokenKind;
  label: string;
  raw: string;
  /** `new` marks an entity that will be created on submit. */
  status?: 'known' | 'new' | 'default' | 'error';
}

export interface ParseError {
  code: 'amount-missing' | 'amount-ambiguous' | 'account-unknown' | 'account-missing' | 'transfer-incomplete' | 'transfer-same' | 'recurring-transfer';
  message: string;
}

export interface ParsedTransaction {
  type: ParsedTransactionType;
  /** Positive magnitude in cents, or null when no amount was found. */
  amount: number | null;
  date: string;
  accountId: string | null;
  accountName: string | null;
  transferAccountId: string | null;
  transferAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isNewCategory: boolean;
  payeeId: string | null;
  payeeName: string | null;
  isNewPayee: boolean;
  tags: string[];
  cleared: boolean;
  recurrence: RecurrenceRule | null;
  notes: string;
  tokens: ParsedToken[];
  errors: ParseError[];
  valid: boolean;
}

const WEEKDAY_LOOKUP = new Map<string, number>([
  ['sunday', 0],
  ['sun', 0],
  ['monday', 1],
  ['mon', 1],
  ['tuesday', 2],
  ['tue', 2],
  ['tues', 2],
  ['wednesday', 3],
  ['wed', 3],
  ['thursday', 4],
  ['thu', 4],
  ['thurs', 4],
  ['friday', 5],
  ['fri', 5],
  ['saturday', 6],
  ['sat', 6],
]);

/** Words that are consumed with the amount but should not become notes. */
const AMOUNT_PREFIXES = new Set(['for', 'spent', 'paid', 'cost', 'total']);

const AMOUNT_PATTERN = /^[+-]?(?:[$€£¥])?\d(?:[\d.,]*\d)?$/;
const NTH_PATTERN = /^(\d{1,2})(?:st|nd|rd|th)$/;

const MONTH_NAMES = MONTHS.map((month) => month.toLowerCase());
const MONTH_INDEX = new Map(MONTH_NAMES.map((name, index) => [name, index]));

function lower(value: string): string {
  return value.trim().toLowerCase();
}

function nextWeekday(today: string, weekday: number, mode: 'next' | 'last' | 'this'): string {
  const current = weekdayOf(today);
  if (mode === 'last') {
    const diff = (current - weekday + 7) % 7 || 7;
    return addDays(today, -diff);
  }
  if (mode === 'this') {
    return addDays(today, weekday - current);
  }
  const diff = (weekday - current + 7) % 7 || 7;
  return addDays(today, diff);
}

function nextMonthlyDay(today: string, day: number): string {
  const current = fromISODate(today);
  for (let step = 0; step <= 24; step += 1) {
    const cursor = new Date(current.getFullYear(), current.getMonth() + step, 1);
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(day, lastDay));
    if (candidate.getTime() >= current.getTime()) {
      return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(
        candidate.getDate(),
      ).padStart(2, '0')}`;
    }
  }
  return addMonths(today, 1);
}

function withYear(monthIndex: number, day: number, year: number | null, today: string): string | null {
  const current = fromISODate(today);
  let resolvedYear = year ?? current.getFullYear();
  if (!year) {
    const candidate = new Date(resolvedYear, monthIndex, day);
    if (candidate.getTime() < new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()) {
      resolvedYear += 1;
    }
  }
  const candidate = new Date(resolvedYear, monthIndex, day);
  if (candidate.getMonth() !== monthIndex || candidate.getDate() !== day) return null;
  return `${resolvedYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Finds the first account whose name matches the supplied words. */
function matchAccountName(
  words: string[],
  accounts: Account[],
): { account: Account; length: number } | null {
  const active = accounts.filter((account) => !account.archived);
  for (let length = words.length; length >= 1; length -= 1) {
    const candidate = words.slice(0, length).join(' ').toLowerCase();
    const account = active.find((item) => item.name.toLowerCase() === candidate);
    if (account) return { account, length };
  }
  return null;
}

interface TransferMatch {
  fromName: string;
  toName: string;
  used: Set<number>;
}

/**
 * Extracts `from X to Y`, `from X -> Y` or `X -> Y`. Only recognised when the
 * line explicitly says transfer or the arrow syntax is present, so a date
 * range like `from monday to friday` is not mistaken for a transfer.
 */
function extractTransfer(words: string[], accounts: Account[]): TransferMatch | null {
  const arrow = words.findIndex((word) => word === '->' || word === '→');
  const transferIndex = words.findIndex((word) => lower(word) === 'transfer');
  const fromIndex = words.findIndex((word) => lower(word) === 'from');
  const toIndex = words.findIndex((word, index) => lower(word) === 'to' && index > fromIndex);

  if (arrow >= 0) {
    const rightStart = arrow + 1;
    const rightMatch = matchAccountName(words.slice(rightStart), accounts);

    let leftStart = 0;
    if (fromIndex >= 0 && fromIndex < arrow) leftStart = fromIndex + 1;
    else leftStart = Math.max(0, arrow - 1);
    const leftWords = words.slice(leftStart, arrow);
    const leftMatch = matchAccountName(leftWords, accounts);

    const used = new Set<number>([arrow]);
    if (transferIndex >= 0) used.add(transferIndex);
    if (fromIndex >= 0) used.add(fromIndex);
    for (let index = leftStart; index < arrow; index += 1) used.add(index);
    for (let index = rightStart; index < rightStart + (rightMatch?.length ?? words.length - rightStart); index += 1) {
      used.add(index);
    }

    const fromName = leftMatch?.account.name ?? leftWords.join(' ').trim();
    const toName =
      rightMatch?.account.name ??
      words.slice(rightStart).join(' ').trim();
    return { fromName, toName, used };
  }

  if (fromIndex < 0 || toIndex < 0) return null;

  const leftWords = words.slice(fromIndex + 1, toIndex);
  const rightWords = words.slice(toIndex + 1);
  const leftMatch = matchAccountName(leftWords, accounts);
  const rightMatch = matchAccountName(rightWords, accounts);

  // Without an explicit "transfer" keyword both sides must be real accounts.
  if (transferIndex < 0 && (!leftMatch || !rightMatch)) return null;

  const used = new Set<number>();
  for (let index = fromIndex; index <= toIndex; index += 1) used.add(index);
  const rightLength = rightMatch?.length ?? rightWords.length;
  for (let index = toIndex + 1; index <= toIndex + rightLength; index += 1) used.add(index);
  if (transferIndex >= 0) used.add(transferIndex);

  return {
    fromName: leftMatch?.account.name ?? leftWords.join(' ').trim(),
    toName: rightMatch?.account.name ?? rightWords.join(' ').trim(),
    used,
  };
}

interface RecurrenceMatch {
  rule: RecurrenceRule;
  used: Set<number>;
}

function extractRecurrence(words: string[]): RecurrenceMatch | null {
  const used = new Set<number>();
  let freq: RecurrenceFreq | null = null;
  let interval = 1;
  let byWeekday: number[] = [];
  let byMonthDay: number[] = [];

  for (let index = 0; index < words.length; index += 1) {
    if (used.has(index)) continue;
    const word = lower(words[index]);

    if (['daily', 'weekly', 'monthly', 'yearly', 'annually'].includes(word)) {
      freq = word === 'annually' ? 'yearly' : (word as RecurrenceFreq);
      used.add(index);
      continue;
    }

    if (word === 'every') {
      used.add(index);
      let cursor = index + 1;
      let step = 1;
      const numeric = words[cursor] ? Number.parseInt(words[cursor], 10) : Number.NaN;
      if (Number.isFinite(numeric) && numeric > 0) {
        step = numeric;
        used.add(cursor);
        cursor += 1;
      }

      const unit = lower(words[cursor] ?? '');
      const weekday = WEEKDAY_LOOKUP.get(unit);
      if (weekday !== undefined) {
        freq = 'weekly';
        interval = step;
        byWeekday = [weekday];
        used.add(cursor);
        continue;
      }

      if (['day', 'days'].includes(unit)) freq = 'daily';
      else if (['week', 'weeks'].includes(unit)) freq = 'weekly';
      else if (['month', 'months'].includes(unit)) freq = 'monthly';
      else if (['year', 'years'].includes(unit)) freq = 'yearly';
      if (freq) {
        interval = step;
        used.add(cursor);
      }
    }
  }

  // "on the 1st" supplies the day for monthly rules.
  const onTheIndex = words.findIndex(
    (word, index) => lower(word) === 'on' && lower(words[index + 1] ?? '') === 'the' && NTH_PATTERN.test(lower(words[index + 2] ?? '')),
  );
  if (onTheIndex >= 0) {
    const match = NTH_PATTERN.exec(lower(words[onTheIndex + 2]));
    if (match) {
      const day = Number.parseInt(match[1], 10);
      if (day >= 1 && day <= 31) {
        if (!freq) freq = 'monthly';
        if (freq === 'monthly') byMonthDay = [day];
      }
      used.add(onTheIndex);
      used.add(onTheIndex + 1);
      used.add(onTheIndex + 2);
    }
  }

  if (!freq) return null;

  if (freq === 'weekly' && byWeekday.length === 0) {
    const weekday = words.findIndex((word) => WEEKDAY_LOOKUP.has(lower(word)));
    if (weekday >= 0 && !used.has(weekday)) {
      byWeekday = [WEEKDAY_LOOKUP.get(lower(words[weekday])) as number];
      used.add(weekday);
    }
  }

  return {
    rule: { freq, interval, byWeekday, byMonthDay, until: null, count: null },
    used,
  };
}

interface DateMatch {
  date: string;
  used: Set<number>;
}

function extractDate(words: string[], today: string): DateMatch | null {
  const used = new Set<number>();

  const take = (index: number, length: number) => {
    for (let offset = 0; offset < length; offset += 1) used.add(index + offset);
  };

  for (let index = 0; index < words.length; index += 1) {
    if (used.has(index)) continue;
    const word = lower(words[index]);

    if (word === 'today') {
      used.add(index);
      return { date: today, used };
    }
    if (word === 'tonight') {
      used.add(index);
      return { date: today, used };
    }
    if (word === 'tomorrow') {
      used.add(index);
      return { date: addDays(today, 1), used };
    }
    if (word === 'yesterday') {
      used.add(index);
      return { date: addDays(today, -1), used };
    }

    if (isValidISODate(word)) {
      used.add(index);
      return { date: word, used };
    }

    const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(word);
    if (slash) {
      const month = Number.parseInt(slash[1], 10);
      const day = Number.parseInt(slash[2], 10);
      let year = slash[3] ? Number.parseInt(slash[3], 10) : fromISODate(today).getFullYear();
      if (year < 100) year += 2000;
      const date = withYear(month - 1, day, year, today);
      if (date) {
        used.add(index);
        return { date, used };
      }
    }

    const weekdayWord = WEEKDAY_LOOKUP.get(word);
    if (weekdayWord !== undefined) {
      const previous = lower(words[index - 1] ?? '');
      if (previous === 'last' || previous === 'next' || previous === 'this') {
        used.add(index - 1);
        used.add(index);
        return { date: nextWeekday(today, weekdayWord, previous), used };
      }
      used.add(index);
      return { date: nextWeekday(today, weekdayWord, 'next'), used };
    }

    if (word === 'next' || word === 'this') {
      const unit = lower(words[index + 1] ?? '');
      if (['week', 'month', 'year'].includes(unit)) {
        used.add(index);
        used.add(index + 1);
        const date =
          unit === 'week'
            ? addDays(today, 7)
            : unit === 'month'
              ? addMonths(today, 1)
              : addYears(today, 1);
        return { date, used };
      }
    }

    const ago = /^(\d+)(?:d|day|days)$/.exec(word);
    if (ago && lower(words[index + 1] ?? '') === 'ago') {
      used.add(index);
      used.add(index + 1);
      return { date: addDays(today, -Number.parseInt(ago[1], 10)), used };
    }

    const agoPhrase = word === 'ago' ? null : /^(\d+)$/.exec(word);
    if (agoPhrase && ['day', 'days', 'week', 'weeks', 'month', 'months'].includes(lower(words[index + 1] ?? '')) && lower(words[index + 2] ?? '') === 'ago') {
      const amount = Number.parseInt(agoPhrase[1], 10);
      const unit = lower(words[index + 1]);
      used.add(index);
      used.add(index + 1);
      used.add(index + 2);
      const date =
        unit.startsWith('day')
          ? addDays(today, -amount)
          : unit.startsWith('week')
            ? addDays(today, -7 * amount)
            : addMonths(today, -amount);
      return { date, used };
    }

    if (word === 'in' || word === 'after') {
      const amount = Number.parseInt(words[index + 1] ?? '', 10);
      const unit = lower(words[index + 2] ?? '');
      if (Number.isFinite(amount)) {
        if (['day', 'days'].includes(unit)) {
          take(index, 3);
          return { date: addDays(today, amount), used };
        }
        if (['week', 'weeks'].includes(unit)) {
          take(index, 3);
          return { date: addDays(today, amount * 7), used };
        }
        if (['month', 'months'].includes(unit)) {
          take(index, 3);
          return { date: addMonths(today, amount), used };
        }
        if (['year', 'years'].includes(unit)) {
          take(index, 3);
          return { date: addYears(today, amount), used };
        }
      }
    }

    const monthName = MONTH_INDEX.get(word.replace(/,$/, ''));
    if (monthName !== undefined) {
      const dayToken = lower(words[index + 1] ?? '');
      const yearToken = lower(words[index + 2] ?? '');
      if (/^\d{1,2}$/.test(dayToken)) {
        const day = Number.parseInt(dayToken, 10);
        const year = /^\d{4}$/.test(yearToken) ? Number.parseInt(yearToken, 10) : null;
        const date = withYear(monthName, day, year, today);
        if (date) {
          take(index, year ? 3 : 2);
          return { date, used };
        }
      }
    }

    const dayFirst = /^(\d{1,2})$/.exec(word);
    if (dayFirst) {
      const monthNameNext = MONTH_INDEX.get(lower(words[index + 1] ?? '').replace(/,$/, ''));
      if (monthNameNext !== undefined) {
        const date = withYear(monthNameNext, Number.parseInt(dayFirst[1], 10), null, today);
        if (date) {
          take(index, 2);
          return { date, used };
        }
      }
    }

    if (word === 'on' && lower(words[index + 1] ?? '') === 'the') {
      const nth = NTH_PATTERN.exec(lower(words[index + 2] ?? ''));
      if (nth) {
        const day = Number.parseInt(nth[1], 10);
        if (day >= 1 && day <= 31) {
          take(index, 3);
          return { date: nextMonthlyDay(today, day), used };
        }
      }
    }
  }

  return null;
}

/** Removes words that were consumed by a match from a copy of the line. */
function without(words: string[], used: Set<number>): string[] {
  return words.filter((_, index) => !used.has(index));
}

/** First calendar day for a recurrence rule relative to today. */
function firstRecurrenceDate(rule: RecurrenceRule, today: string): string {
  if (rule.freq === 'weekly' && rule.byWeekday.length > 0) {
    return nextWeekday(today, rule.byWeekday[0], 'next');
  }
  if (rule.freq === 'monthly' && rule.byMonthDay.length > 0) {
    return nextMonthlyDay(today, rule.byMonthDay[0]);
  }
  if (rule.freq === 'yearly' && rule.byMonthDay.length > 0) {
    const current = fromISODate(today);
    const thisYear = withYear(current.getMonth(), rule.byMonthDay[0], null, today);
    return thisYear ?? addYears(today, 1);
  }
  return today;
}

export function parseTransactionInput(input: string, context: ParseContext): ParsedTransaction {
  const today = context.today ?? todayISO();
  let words = input.trim().split(/\s+/).filter(Boolean);

  const tokens: ParsedToken[] = [];
  const errors: ParseError[] = [];
  let cleared = false;
  let payeeName: string | null = null;
  let payeeId: string | null = null;
  let categoryName: string | null = null;
  let categoryId: string | null = null;
  let accountName: string | null = null;
  let accountId: string | null = null;
  const tags: string[] = [];

  /* ── Marker tokens: @payee #category ^account +tag !cleared ───────────── */

  const markerUsed = new Set<number>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.length < 2) continue;

    const marker = word[0];
    const value = word.slice(1).replace(/[.,;:!?]+$/, '');
    if (!value) continue;

    if (marker === '@') {
      payeeName = value;
      markerUsed.add(index);
    } else if (marker === '#') {
      categoryName = value;
      markerUsed.add(index);
    } else if (marker === '^') {
      accountName = value;
      markerUsed.add(index);
    } else if (marker === '+') {
      if (!/^\d/.test(value)) {
        tags.push(value.toLowerCase());
        markerUsed.add(index);
      }
    } else if (marker === '!' && lower(value) === 'cleared') {
      cleared = true;
      markerUsed.add(index);
    }
  }

  words = without(words, markerUsed);

  /* ── Transfer accounts ─────────────────────────────────────────────────── */

  const transfer = extractTransfer(words, context.accounts);
  let transferAccountId: string | null = null;
  let transferAccountName: string | null = null;

  if (transfer) {
    words = without(words, transfer.used);
    const from = context.accounts.find(
      (account) => account.name.toLowerCase() === transfer.fromName.toLowerCase(),
    );
    const to = context.accounts.find(
      (account) => account.name.toLowerCase() === transfer.toName.toLowerCase(),
    );
    if (!from || !to) {
      errors.push({
        code: 'transfer-incomplete',
        message: 'A transfer needs two existing accounts, e.g. “transfer 300 from Checking to Savings”.',
      });
    } else if (from.id === to.id) {
      errors.push({ code: 'transfer-same', message: 'Choose two different accounts for a transfer.' });
    } else {
      accountId = from.id;
      accountName = from.name;
      transferAccountId = to.id;
      transferAccountName = to.name;
      tokens.push({
        kind: 'transfer',
        label: `${from.name} → ${to.name}`,
        raw: `${from.name}->${to.name}`,
        status: 'known',
      });
    }
  }

  /* ── Recurrence, then a single date ────────────────────────────────────── */

  const recurrenceMatch = extractRecurrence(words);
  words = recurrenceMatch ? without(words, recurrenceMatch.used) : words;

  const dateMatch = extractDate(words, today);
  const date = dateMatch?.date ?? null;
  words = dateMatch ? without(words, dateMatch.used) : words;

  const recurrence = recurrenceMatch?.rule ?? null;
  let resolvedDate = date ?? today;
  if (recurrence && !date) resolvedDate = firstRecurrenceDate(recurrence, today);

  if (recurrence && transfer) {
    errors.push({
      code: 'recurring-transfer',
      message: 'Recurring transfers are not supported yet. Record a single transfer instead.',
    });
  }

  if (recurrence) {
    tokens.push({
      kind: 'recurrence',
      label: describeRecurrence(recurrence),
      raw: '',
      status: 'known',
    });
  }
  tokens.push({
    kind: 'date',
    label: formatDate(resolvedDate),
    raw: resolvedDate,
    status: date ? 'known' : 'default',
  });

  /* ── Amount ────────────────────────────────────────────────────────────── */

  const amountIndices = words
    .map((word, index) => (AMOUNT_PATTERN.test(word) ? index : -1))
    .filter((index) => index >= 0);

  let rawAmount: string | null = null;
  let amount: number | null = null;

  if (amountIndices.length > 1) {
    errors.push({
      code: 'amount-ambiguous',
      message: 'More than one amount was found. Keep a single amount per transaction.',
    });
  } else if (amountIndices.length === 1) {
    const index = amountIndices[0];
    rawAmount = words[index];
    const parsed = parseAmount(rawAmount, context.locale);
    if (Number.isFinite(parsed) && Math.abs(parsed) > 0) amount = Math.abs(parsed);
  }

  if (amount === null && amountIndices.length <= 1) {
    errors.push({
      code: 'amount-missing',
      message: 'Add an amount, e.g. “coffee 4.50 @Starbucks”.',
    });
  }

  if (rawAmount !== null) {
    words = words.filter((_, index) => index !== amountIndices[0]);
    // Drop filler words that only introduce the amount ("spent 12").
    if (words.length > 1 && AMOUNT_PREFIXES.has(lower(words[0]))) words = words.slice(1);
  }

  /* ── Type ──────────────────────────────────────────────────────────────── */

  let type: ParsedTransactionType = transfer ? 'transfer' : 'expense';
  if (rawAmount && !transfer && rawAmount.trim().startsWith('+')) type = 'income';

  /* ── Account fallback ──────────────────────────────────────────────────── */

  if (!accountId) {
    if (accountName) {
      const match = context.accounts.find(
        (account) => account.name.toLowerCase() === accountName!.toLowerCase(),
      );
      if (match) {
        accountId = match.id;
        accountName = match.name;
      } else {
        errors.push({
          code: 'account-unknown',
          message: `Unknown account “${accountName}”. Add it in Settings first.`,
        });
      }
    } else {
      const preferred =
        context.accounts.find((account) => account.id === context.defaultAccountId && !account.archived) ??
        context.accounts.find((account) => !account.archived);
      if (preferred) {
        accountId = preferred.id;
        accountName = preferred.name;
      } else {
        errors.push({ code: 'account-missing', message: 'Add an account before recording transactions.' });
      }
    }
  }

  /* ── Payee / category resolution ───────────────────────────────────────── */

  const payee = payeeName
    ? context.payees.find((item) => item.name.toLowerCase() === payeeName!.toLowerCase())
    : undefined;
  if (payee) {
    payeeId = payee.id;
    payeeName = payee.name;
  }

  const category = categoryName
    ? context.categories.find((item) => item.name.toLowerCase() === categoryName!.toLowerCase())
    : undefined;
  if (category) {
    categoryId = category.id;
    categoryName = category.name;
  } else if (!categoryName && payee?.defaultCategoryId) {
    const fallback = context.categories.find((item) => item.id === payee.defaultCategoryId);
    if (fallback) {
      categoryId = fallback.id;
      categoryName = fallback.name;
    }
  }

  const isNewPayee = !!payeeName && !payee;
  const isNewCategory = !!categoryName && !category;

  /* ── Tokens for the UI ─────────────────────────────────────────────────── */

  if (amount !== null) {
    const signed = type === 'income' ? amount : -amount;
    tokens.unshift({
      kind: 'amount',
      label: `${signed < 0 ? '−' : '+'}${formatMoney(Math.abs(signed), context.currency, context.locale)}`,
      raw: rawAmount ?? '',
      status: 'known',
    });
    tokens.push({
      kind: 'amount',
      label: type === 'income' ? 'Income' : type === 'transfer' ? 'Transfer' : 'Expense',
      raw: type,
      status: 'known',
    });
  }

  if (accountName) {
    tokens.push({
      kind: 'account',
      label: accountName,
      raw: accountName,
      status: accountId ? 'known' : 'error',
    });
  }

  if (payeeName) {
    tokens.push({
      kind: 'payee',
      label: isNewPayee ? `New payee · ${payeeName}` : payeeName,
      raw: payeeName,
      status: isNewPayee ? 'new' : 'known',
    });
  }

  if (categoryName) {
    tokens.push({
      kind: 'category',
      label: isNewCategory ? `New category · ${categoryName}` : categoryName,
      raw: categoryName,
      status: isNewCategory ? 'new' : categoryId ? 'known' : 'default',
    });
  }

  for (const tag of tags) {
    tokens.push({ kind: 'tag', label: `+${tag}`, raw: tag, status: 'known' });
  }

  if (cleared) {
    tokens.push({ kind: 'cleared', label: 'Cleared', raw: '!cleared', status: 'known' });
  }

  const notes = words.join(' ').replace(/\s+/g, ' ').trim();

  return {
    type,
    amount,
    date: resolvedDate,
    accountId,
    accountName: accountName ? accountName : null,
    transferAccountId,
    transferAccountName,
    categoryId,
    categoryName: categoryName ? categoryName : null,
    isNewCategory,
    payeeId,
    payeeName: payeeName ? payeeName : null,
    isNewPayee,
    tags,
    cleared,
    recurrence,
    notes,
    tokens,
    errors,
    valid: errors.length === 0 && amount !== null,
  };
}
