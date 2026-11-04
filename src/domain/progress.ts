/**
 * Budget progress, levels and month-end rewards.
 *
 * All counters are accumulated (never derived from history) so deleting a
 * transaction cannot farm XP or rewind a level. `rewarded` keys dedupe by
 * transaction id across retries and devices.
 */

import { addDays, todayISO } from './date';
import type { MonthReview } from './monthly';
import type { Progress, Transaction } from './types';
import { EMPTY_PROGRESS } from './types';

export const XP_PER_LOG = 5;
export const XP_PER_RECONCILE = 3;
export const XP_UNDER_BUDGET = 30;
export const XP_BUDGET_MASTER = 20;
export const XP_ZERO_BASED = 15;
export const XP_SAVINGS_TARGET = 40;
export const COMBO_WINDOW_MS = 8_000;
export const COMBO_CAP = 5;
export const SAVINGS_TARGET = 0.2;

export interface LogReward {
  progress: Progress;
  xpGain: number;
  combo: number;
  streak: number;
  levelBefore: number;
  levelAfter: number;
  newDay: boolean;
}

export interface ReconcileReward {
  progress: Progress;
  xpGain: number;
}

export interface MonthReward {
  progress: Progress;
  xpGain: number;
  underBudget: boolean;
  savingsTarget: boolean;
}

/** Levels require 100 XP for level 2, then 200, 300, … */
export function levelForXp(xp: number): number {
  let level = 1;
  let threshold = 0;
  while (xp >= threshold + level * 100) {
    threshold += level * 100;
    level += 1;
  }
  return level;
}

export function levelFloor(level: number): number {
  let threshold = 0;
  for (let step = 1; step < level; step += 1) threshold += step * 100;
  return threshold;
}

export function levelProgress(xp: number): { level: number; floor: number; next: number } {
  const level = levelForXp(xp);
  const floor = levelFloor(level);
  return { level, floor, next: floor + level * 100 };
}

export function activityStreak(dates: readonly string[], today: string): number {
  const days = new Set(dates);
  let cursor = today;
  if (!days.has(cursor)) {
    cursor = addDays(today, -1);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function applyTransactionLog(
  progress: Progress,
  transaction: Transaction,
  transactions: readonly Transaction[],
  now = Date.now(),
  today = todayISO(),
): LogReward | null {
  const key = `tx:${transaction.id}`;
  if (transaction.type === 'transfer' || progress.rewarded.includes(key)) return null;

  const combo =
    progress.lastComboAt !== null && now - progress.lastComboAt <= COMBO_WINDOW_MS
      ? Math.min(COMBO_CAP, Math.max(1, progress.combo) + 1)
      : 1;
  const dates = transactions.map((row) => row.date);
  if (!dates.includes(transaction.date)) dates.push(transaction.date);
  const streak = activityStreak(dates, today);
  const newDay = progress.lastLogDate !== today;
  const streakBonus = newDay ? Math.min(streak, 14) : 0;
  const xpGain = XP_PER_LOG * combo + streakBonus;
  const levelBefore = levelForXp(progress.xp);
  const nextXp = progress.xp + xpGain;
  const levelAfter = levelForXp(nextXp);
  const next: Progress = {
    ...progress,
    xp: nextXp,
    totalLogged: progress.totalLogged + 1,
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    lastLogDate: today,
    todayCount: progress.todayDate === today ? progress.todayCount + 1 : 1,
    todayDate: today,
    combo,
    bestCombo: Math.max(progress.bestCombo, combo),
    lastComboAt: now,
    rewarded: [...progress.rewarded, key].slice(-4000),
    updatedAt: now,
  };

  return {
    progress: next,
    xpGain,
    combo,
    streak,
    levelBefore,
    levelAfter,
    newDay,
  };
}

export function applyReconciliation(
  progress: Progress,
  transaction: Transaction,
  now = Date.now(),
): ReconcileReward | null {
  const key = `clear:${transaction.id}`;
  if (transaction.type === 'transfer' || progress.rewarded.includes(key)) return null;
  return {
    progress: {
      ...progress,
      xp: progress.xp + XP_PER_RECONCILE,
      reconciled: progress.reconciled + 1,
      rewarded: [...progress.rewarded, key].slice(-4000),
      updatedAt: now,
    },
    xpGain: XP_PER_RECONCILE,
  };
}

export function applyMonthReview(
  progress: Progress,
  review: MonthReview,
  now = Date.now(),
): MonthReward | null {
  if (progress.evaluatedMonths.includes(review.month)) return null;

  const savingsTarget = review.savingsRate >= SAVINGS_TARGET;
  let xpGain = 0;
  if (review.underBudget) xpGain += XP_UNDER_BUDGET;
  if (review.budgetMaster) xpGain += XP_BUDGET_MASTER;
  if (review.zeroBased) xpGain += XP_ZERO_BASED;
  if (savingsTarget) xpGain += XP_SAVINGS_TARGET;

  const underBudgetStreak = review.underBudget ? progress.underBudgetStreak + 1 : 0;
  const savingsStreak = savingsTarget ? progress.savingsStreak + 1 : 0;

  return {
    progress: {
      ...progress,
      xp: progress.xp + xpGain,
      evaluatedMonths: [...progress.evaluatedMonths, review.month].sort(),
      underBudgetMonths: progress.underBudgetMonths + (review.underBudget ? 1 : 0),
      underBudgetStreak,
      bestUnderBudgetStreak: Math.max(progress.bestUnderBudgetStreak, underBudgetStreak),
      zeroBasedMonths: progress.zeroBasedMonths + (review.zeroBased ? 1 : 0),
      budgetMasterMonths: progress.budgetMasterMonths + (review.budgetMaster ? 1 : 0),
      savingsMonths: progress.savingsMonths + (savingsTarget ? 1 : 0),
      savingsStreak,
      bestSavingsStreak: Math.max(progress.bestSavingsStreak, savingsStreak),
      noSpendDays: progress.noSpendDays + review.noSpendDays,
      noSpendWeekends: progress.noSpendWeekends + (review.noSpendWeekend ? 1 : 0),
      updatedAt: now,
    },
    xpGain,
    underBudget: review.underBudget,
    savingsTarget,
  };
}

export function mergeProgress(local: Progress, remote: Progress): Progress {
  const a: Progress = { ...EMPTY_PROGRESS, ...local };
  const b: Progress = { ...EMPTY_PROGRESS, ...remote };

  const latestDate =
    !a.lastLogDate || (b.lastLogDate && b.lastLogDate > a.lastLogDate)
      ? b.lastLogDate
      : a.lastLogDate;

  // A streak belongs to the most recent chain, not simply the largest number.
  let streak: number;
  if (a.lastLogDate === b.lastLogDate) streak = Math.max(a.streak, b.streak);
  else streak = a.lastLogDate === latestDate ? a.streak : b.streak;

  const latestToday =
    !a.todayDate || (b.todayDate && b.todayDate > a.todayDate) ? b.todayDate : a.todayDate;
  const todayCount =
    a.todayDate === b.todayDate && a.todayDate !== null
      ? Math.max(a.todayCount, b.todayCount)
      : a.todayDate === latestToday
        ? a.todayCount
        : b.todayCount;

  const latestRecord = b.updatedAt > a.updatedAt ? b : a;
  const union = (left: string[] | undefined, right: string[] | undefined) =>
    [...new Set([...(left ?? []), ...(right ?? [])])].sort();

  const merged: Progress = {
    xp: Math.max(a.xp, b.xp),
    totalLogged: Math.max(a.totalLogged, b.totalLogged),
    streak,
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    lastLogDate: latestDate,
    todayCount,
    todayDate: latestToday,
    combo: latestRecord.combo,
    bestCombo: Math.max(a.bestCombo, b.bestCombo),
    lastComboAt:
      a.lastComboAt === null
        ? b.lastComboAt
        : b.lastComboAt === null
          ? a.lastComboAt
          : Math.max(a.lastComboAt, b.lastComboAt),
    reconciled: Math.max(a.reconciled, b.reconciled),
    evaluatedMonths: union(a.evaluatedMonths, b.evaluatedMonths),
    underBudgetMonths: Math.max(a.underBudgetMonths, b.underBudgetMonths),
    underBudgetStreak: latestRecord.underBudgetStreak,
    bestUnderBudgetStreak: Math.max(a.bestUnderBudgetStreak, b.bestUnderBudgetStreak),
    zeroBasedMonths: Math.max(a.zeroBasedMonths, b.zeroBasedMonths),
    budgetMasterMonths: Math.max(a.budgetMasterMonths, b.budgetMasterMonths),
    savingsMonths: Math.max(a.savingsMonths, b.savingsMonths),
    savingsStreak: latestRecord.savingsStreak,
    bestSavingsStreak: Math.max(a.bestSavingsStreak, b.bestSavingsStreak),
    noSpendDays: Math.max(a.noSpendDays, b.noSpendDays),
    noSpendWeekends: Math.max(a.noSpendWeekends, b.noSpendWeekends),
    rewarded: union(a.rewarded, b.rewarded).slice(-4000),
    unlocked: union(a.unlocked, b.unlocked),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };

  // Future counters merge numerically by maximum without another migration.
  const known = new Set(Object.keys(merged));
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  const latestRecordValues = latestRecord as unknown as Record<string, unknown>;

  for (const key of new Set([...Object.keys(aRecord), ...Object.keys(bRecord)])) {
    if (known.has(key)) continue;
    const left = aRecord[key];
    const right = bRecord[key];
    if (typeof left === 'number' && typeof right === 'number') {
      (merged as unknown as Record<string, unknown>)[key] = Math.max(left, right);
    } else {
      (merged as unknown as Record<string, unknown>)[key] =
        latestRecordValues[key] ?? left ?? right;
    }
  }

  return merged;
}
