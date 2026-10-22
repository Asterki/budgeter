/**
 * Recurrence engine.
 *
 * Supports the simple cycles (daily / weekly / monthly / yearly) plus custom
 * patterns: multi-week intervals, explicit weekdays, explicit days of month,
 * an end date and a maximum occurrence count.
 */

import type { RecurrenceFreq, RecurrenceRule } from './types';
import {
  addDays,
  addMonths,
  addYears,
  daysBetween,
  fromISODate,
  startOfWeek,
  weekdayOf,
  WEEKDAYS_SHORT,
} from './date';

export function createRecurrence(freq: RecurrenceFreq, dateISO: string): RecurrenceRule {
  const rule: RecurrenceRule = {
    freq,
    interval: 1,
    byWeekday: [],
    byMonthDay: [],
    until: null,
    count: null,
  };
  if (freq === 'weekly') rule.byWeekday = [weekdayOf(dateISO)];
  if (freq === 'monthly' || freq === 'yearly') rule.byMonthDay = [fromISODate(dateISO).getDate()];
  return rule;
}

function matchesWeekday(rule: RecurrenceRule, iso: string): boolean {
  if (rule.byWeekday.length === 0) return true;
  return rule.byWeekday.includes(weekdayOf(iso));
}

function nextWeekly(rule: RecurrenceRule, currentISO: string): string {
  if (rule.byWeekday.length === 0) {
    return addDays(currentISO, 7 * Math.max(1, rule.interval));
  }
  const anchor = startOfWeek(currentISO);
  const limit = 7 * Math.max(1, rule.interval) * 8;
  for (let i = 1; i <= limit; i += 1) {
    const candidate = addDays(currentISO, i);
    if (!matchesWeekday(rule, candidate)) continue;
    const weeks = daysBetween(anchor, startOfWeek(candidate)) / 7;
    if (weeks % Math.max(1, rule.interval) === 0) return candidate;
  }
  return addDays(currentISO, 7 * Math.max(1, rule.interval));
}

function nextMonthly(rule: RecurrenceRule, currentISO: string): string {
  const interval = Math.max(1, rule.interval);
  const current = fromISODate(currentISO);
  const targetDay = rule.byMonthDay[0] ?? current.getDate();

  for (let step = 0; step <= 120; step += 1) {
    const cursor = new Date(current.getFullYear(), current.getMonth() + step * interval, 1);
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day = Math.min(targetDay, lastDay);
    const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    if (candidate.getTime() > current.getTime()) {
      const y = candidate.getFullYear();
      const m = String(candidate.getMonth() + 1).padStart(2, '0');
      const d = String(candidate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return addMonths(currentISO, interval);
}

function nextYearly(rule: RecurrenceRule, currentISO: string): string {
  return addYears(currentISO, Math.max(1, rule.interval));
}

/** The next occurrence strictly after `currentISO`. */
export function nextOccurrence(rule: RecurrenceRule, currentISO: string): string {
  switch (rule.freq) {
    case 'daily':
      return addDays(currentISO, Math.max(1, rule.interval));
    case 'weekly':
      return nextWeekly(rule, currentISO);
    case 'monthly':
      return nextMonthly(rule, currentISO);
    case 'yearly':
      return nextYearly(rule, currentISO);
  }
}

/** True when the rule has run out (end date passed or occurrence budget spent). */
export function isExhausted(rule: RecurrenceRule, nextISO: string, occurrences: number): boolean {
  if (rule.until && nextISO > rule.until) return true;
  if (rule.count !== null && occurrences >= rule.count) return true;
  return false;
}

/** Short human description, e.g. "Every 2 weeks on Mon, Wed". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const interval = Math.max(1, rule.interval);
  const every = interval === 1 ? 'Every' : `Every ${interval}`;

  switch (rule.freq) {
    case 'daily':
      return interval === 1 ? 'Every day' : `Every ${interval} days`;
    case 'weekly': {
      const days = rule.byWeekday
        .slice()
        .sort((a, b) => a - b)
        .map((d) => WEEKDAYS_SHORT[d])
        .join(', ');
      const base = interval === 1 ? 'Every week' : `Every ${interval} weeks`;
      return days ? `${base} on ${days}` : base;
    }
    case 'monthly': {
      const day = rule.byMonthDay[0];
      const base = interval === 1 ? 'Every month' : `Every ${interval} months`;
      return day ? `${base} on day ${day}` : base;
    }
    case 'yearly':
      return interval === 1 ? 'Every year' : `${every} years`;
  }
}
