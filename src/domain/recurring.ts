/**
 * Scheduled transactions.
 *
 * A recurring rule stores the next date that still needs a ledger row. Catch-up
 * walks that pointer forward to today, producing at most one row per date.
 * Future dates are never persisted; they are derived as "planned" rows instead.
 */

import { addDays, todayISO } from './date';
import { isExhausted, nextOccurrence } from './recurrence';
import type { RecurringRule, Transaction } from './types';

/** Hard ceiling for one catch-up pass, so a corrupt rule cannot free the tab. */
export const CATCH_UP_LIMIT = 366;

/** How far ahead the ledger looks for planned rows. */
export const PLANNED_WINDOW_DAYS = 30;

export interface DueOccurrences {
  /** Dates that need a transaction, oldest first. */
  dates: string[];
  /** Next date the rule still owes, after this pass. */
  nextDate: string;
  lastGeneratedDate: string | null;
  /** True when the rule has no more occurrences (count or until). */
  exhausted: boolean;
  /** True when the pass stopped at `CATCH_UP_LIMIT` with dates still due. */
  capped: boolean;
}

/**
 * Every occurrence that is due on or before `today`.
 *
 * `generatedCount` is the number of rows this rule has already produced; it is
 * needed because `count` limits total occurrences rather than elapsed periods.
 */
export function dueOccurrences(
  rule: RecurringRule,
  today: string,
  generatedCount = 0,
  limit = CATCH_UP_LIMIT,
): DueOccurrences {
  const dates: string[] = [];
  let cursor = rule.nextDate;
  let count = Math.max(0, generatedCount);

  while (cursor <= today && dates.length < Math.max(1, limit)) {
    if (isExhausted(rule.recurrence, cursor, count)) break;
    dates.push(cursor);
    count += 1;
    cursor = nextOccurrence(rule.recurrence, cursor);
  }

  const exhausted = isExhausted(rule.recurrence, cursor, count);
  const capped = !exhausted && dates.length >= Math.max(1, limit) && cursor <= today;

  return {
    dates,
    nextDate: cursor,
    lastGeneratedDate: dates.length > 0 ? dates[dates.length - 1] : rule.lastGeneratedDate,
    exhausted,
    capped,
  };
}

/** Future occurrence dates for a rule, strictly between `from` and `to`. */
export function plannedOccurrences(
  rule: RecurringRule,
  from: string,
  to: string,
  generatedCount = 0,
  limit = 60,
): string[] {
  if (!rule.active || rule.nextDate > to) return [];

  const dates: string[] = [];
  let cursor = rule.nextDate;
  let count = Math.max(0, generatedCount);

  while (cursor <= to && dates.length < Math.max(1, limit)) {
    if (isExhausted(rule.recurrence, cursor, count)) break;
    if (cursor >= from) dates.push(cursor);
    count += 1;
    cursor = nextOccurrence(rule.recurrence, cursor);
  }

  return dates;
}

export function occurrenceKey(recurringId: string, date: string): string {
  return `${recurringId}|${date}`;
}

/**
 * Stable id for a generated occurrence.
 *
 * Two devices that catch up the same rule on the same day must mint the same
 * id, otherwise a later merge would keep both copies. SHA-256(ruleId + date)
 * gives that without a shared counter.
 */
export async function recurringTransactionId(ruleId: string, date: string): Promise<string> {
  const input = new TextEncoder().encode(`budget-recurring|${ruleId}|${date}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `rtx-${hex.slice(0, 32)}`;
}

/** How many rows each rule has already generated. */
export function generatedCounts(transactions: readonly Transaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    if (!transaction.recurringId) continue;
    counts.set(transaction.recurringId, (counts.get(transaction.recurringId) ?? 0) + 1);
  }
  return counts;
}

export interface PlannedItem {
  rule: RecurringRule;
  date: string;
}

/** Planned rows inside the upcoming window, sorted by date then amount. */
export function plannedItems(
  rules: RecurringRule[],
  transactions: Transaction[],
  today = todayISO(),
  days = PLANNED_WINDOW_DAYS,
): PlannedItem[] {
  const counts = generatedCounts(transactions);
  const to = addDays(today, days);
  const items: PlannedItem[] = [];

  for (const rule of rules) {
    const dates = plannedOccurrences(rule, today, to, counts.get(rule.id) ?? 0);
    for (const date of dates) items.push({ rule, date });
  }

  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || Math.abs(b.rule.amount) - Math.abs(a.rule.amount),
  );
}
