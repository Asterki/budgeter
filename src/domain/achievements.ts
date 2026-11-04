/**
 * Budget habit achievements.
 *
 * Achievement checks are pure and read the current ledger plus the persisted
 * counters. Unlock ids are stable, so sync can union them safely.
 */

import { accountBalance } from './money';
import { todayISO } from './date';
import type { Account, Progress, Transaction } from './types';

export interface Achievement {
  id: string;
  title: string;
  description: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-entry', title: 'First Entry', description: 'Log your first transaction.' },
  { id: 'ten-entries', title: 'Keeping Tabs', description: 'Log 10 transactions.' },
  { id: 'hundred-entries', title: 'Century Club', description: 'Log 100 transactions.' },
  { id: 'thousand-entries', title: 'Ledger Legend', description: 'Log 1,000 transactions.' },
  { id: 'streak-7', title: 'Week One', description: 'Log something 7 days in a row.' },
  { id: 'streak-30', title: 'Month Strong', description: 'Log something 30 days in a row.' },
  { id: 'streak-100', title: 'Hundred-Day Habit', description: 'Log something 100 days in a row.' },
  {
    id: 'under-budget',
    title: 'Under Budget',
    description: 'Finish a month within your spending limits.',
  },
  {
    id: 'three-under',
    title: 'Three Months Under',
    description: 'Stay under budget three months in a row.',
  },
  {
    id: 'zero-based',
    title: 'Zero-Based Month',
    description: 'Give every expense category a budget for a month.',
  },
  {
    id: 'budget-master',
    title: 'Budget Master',
    description: 'Keep every budgeted category under its limit for a month.',
  },
  {
    id: 'savings-streak',
    title: 'Savings Streak',
    description: 'Save 20% or more for three months running.',
  },
  {
    id: 'no-spend-day',
    title: 'No-Spend Day',
    description: 'Finish a day without logging an expense.',
  },
  {
    id: 'no-spend-weekend',
    title: 'No-Spend Weekend',
    description: 'Keep both Saturday and Sunday expense-free.',
  },
  {
    id: 'reconciled-all',
    title: 'Reconciled Everything',
    description: 'Mark every transaction in the ledger as cleared.',
  },
  {
    id: 'debt-free',
    title: 'Debt-Free Account',
    description: 'Bring a credit account back to zero or better.',
  },
  {
    id: 'emergency-fund',
    title: 'Emergency Fund',
    description: 'Hold savings worth three months of average expenses.',
  },
  {
    id: 'savings-target',
    title: 'Savings Target',
    description: 'Finish a month with a 20% savings rate.',
  },
];

export const ACHIEVEMENT_XP = 20;

export interface AchievementContext {
  progress: Progress;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
}

function averageMonthlyExpenses(transactions: readonly Transaction[]): number {
  const current = todayISO().slice(0, 7);
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type === 'transfer' || transaction.amount >= 0) continue;
    const month = transaction.date.slice(0, 7);
    if (month >= current) continue;
    totals.set(month, (totals.get(month) ?? 0) - transaction.amount);
  }
  const months = [...totals.values()].sort((a, b) => b - a).slice(0, 3);
  if (months.length === 0) return 0;
  return Math.round(months.reduce((total, value) => total + value, 0) / months.length);
}

export function unlockedAchievements(context: AchievementContext): string[] {
  const { progress, accounts, transactions } = context;
  const liveAccounts = accounts.filter((account) => !account.archived);
  const realTransactions = transactions.filter((transaction) => transaction.type !== 'transfer');
  const clearedAll =
    realTransactions.length > 0 && realTransactions.every((transaction) => transaction.cleared);

  const savings = liveAccounts
    .filter((account) => account.type === 'savings')
    .reduce((total, account) => total + accountBalance(account, transactions), 0);
  const averageExpenses = averageMonthlyExpenses(transactions);
  const emergencyFund = averageExpenses > 0 && savings >= averageExpenses * 3;

  const debtFree = liveAccounts.some(
    (account) =>
      account.type === 'credit' &&
      accountBalance(account, transactions) >= 0 &&
      transactions.some((transaction) => transaction.accountId === account.id && transaction.cleared),
  );

  const unlocked: string[] = [];
  const add = (condition: boolean, id: string) => {
    if (condition) unlocked.push(id);
  };

  add(progress.totalLogged >= 1, 'first-entry');
  add(progress.totalLogged >= 10, 'ten-entries');
  add(progress.totalLogged >= 100, 'hundred-entries');
  add(progress.totalLogged >= 1000, 'thousand-entries');
  add(progress.bestStreak >= 7, 'streak-7');
  add(progress.bestStreak >= 30, 'streak-30');
  add(progress.bestStreak >= 100, 'streak-100');
  add(progress.underBudgetMonths >= 1, 'under-budget');
  add(progress.bestUnderBudgetStreak >= 3, 'three-under');
  add(progress.zeroBasedMonths >= 1, 'zero-based');
  add(progress.budgetMasterMonths >= 1, 'budget-master');
  add(progress.bestSavingsStreak >= 3, 'savings-streak');
  add(progress.noSpendDays >= 1, 'no-spend-day');
  add(progress.noSpendWeekends >= 1, 'no-spend-weekend');
  add(clearedAll, 'reconciled-all');
  add(debtFree, 'debt-free');
  add(emergencyFund, 'emergency-fund');
  add(progress.savingsMonths >= 1, 'savings-target');

  return unlocked;
}

export function achievementTitle(id: string): string {
  return ACHIEVEMENTS.find((achievement) => achievement.id === id)?.title ?? id;
}

/** Adds XP for each newly satisfied achievement and unions the ids. */
export function applyAchievementUnlocks(
  progress: Progress,
  context: AchievementContext,
): { progress: Progress; unlocked: string[] } {
  const satisfied = unlockedAchievements({ ...context, progress });
  const fresh = satisfied.filter((id) => !progress.unlocked.includes(id));
  if (fresh.length === 0) return { progress, unlocked: [] };
  return {
    progress: {
      ...progress,
      xp: progress.xp + fresh.length * ACHIEVEMENT_XP,
      unlocked: [...new Set([...progress.unlocked, ...fresh])].sort(),
    },
    unlocked: fresh,
  };
}
