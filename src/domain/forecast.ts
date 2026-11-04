/**
 * Cash-flow forecasting.
 *
 * Starts from today's real balances and walks future recurring occurrences
 * forward. Nothing here writes; planned rows stay virtual until catch-up makes
 * them real. Transfers are skipped because recurring transfers are not
 * supported by the composer.
 */

import { addDays } from './date';
import { generatedCounts, plannedOccurrences } from './recurring';
import { accountBalance } from './money';
import type { Account, RecurringRule, Transaction } from './types';

export interface ForecastPoint {
  date: string;
  balance: number;
  change: number;
}

export interface AccountForecast {
  accountId: string;
  name: string;
  color: string;
  /** Balance at the start of the forecast (today). */
  start: number;
  end: number;
  low: number;
  lowDate: string;
  negativeDates: string[];
  points: ForecastPoint[];
}

export const DEFAULT_FORECAST_DAYS = 90;

/**
 * Project each active account forward for `days` days.
 *
 * `today` should be the local current date. Planned occurrences are read from
 * each rule's `nextDate`, so dates already generated are not counted twice.
 */
export function forecastAccounts(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  rules: readonly RecurringRule[],
  today: string,
  days = DEFAULT_FORECAST_DAYS,
): AccountForecast[] {
  const counts = generatedCounts(transactions);
  const from = addDays(today, 1);
  const to = addDays(today, Math.max(1, days));

  return accounts
    .filter((account) => !account.archived)
    .map((account) => {
      const deltas = new Map<string, number>();
      for (const rule of rules) {
        if (!rule.active || rule.accountId !== account.id || rule.type === 'transfer') continue;
        const dates = plannedOccurrences(
          rule,
          from,
          to,
          counts.get(rule.id) ?? 0,
          Math.max(60, days + 7),
        );
        for (const date of dates) {
          deltas.set(date, (deltas.get(date) ?? 0) + rule.amount);
        }
      }

      const start = accountBalance(account, transactions);
      const points: ForecastPoint[] = [
        { date: today, balance: start, change: 0 },
      ];
      const negativeDates: string[] = [];
      let balance = start;
      let low = start;
      let lowDate = today;
      let date = from;

      while (date <= to) {
        const change = deltas.get(date) ?? 0;
        balance += change;
        if (balance < low) {
          low = balance;
          lowDate = date;
        }
        if (balance < 0) negativeDates.push(date);
        points.push({ date, balance, change });
        date = addDays(date, 1);
      }

      return {
        accountId: account.id,
        name: account.name,
        color: account.color,
        start,
        end: balance,
        low,
        lowDate,
        negativeDates,
        points,
      };
    });
}

/** Combined projected balance for every active account, one point per day. */
export function forecastTotal(forecasts: readonly AccountForecast[]): ForecastPoint[] {
  if (forecasts.length === 0) return [];
  const points = forecasts[0].points;

  return points.map((point, index) => {
    let balance = 0;
    let change = 0;
    for (const forecast of forecasts) {
      const match = forecast.points[index];
      if (!match) continue;
      balance += match.balance;
      change += match.change;
    }
    return { date: point.date, balance, change };
  });
}

export interface NegativeDay {
  date: string;
  accounts: string[];
}

/** Days where at least one account is projected below zero, oldest first. */
export function negativeDays(forecasts: readonly AccountForecast[]): NegativeDay[] {
  const byDate = new Map<string, string[]>();
  for (const forecast of forecasts) {
    for (const date of forecast.negativeDates) {
      const list = byDate.get(date) ?? [];
      list.push(forecast.name);
      byDate.set(date, list);
    }
  }

  return [...byDate]
    .map(([date, accounts]) => ({ date, accounts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
