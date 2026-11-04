/**
 * Month review for the reward engine.
 *
 * A month is closed once it is before the current month. These helpers only use
 * local `YYYY-MM` / `YYYY-MM-DD` strings and signed cent amounts.
 */

import { rolloverIn, spentInMonth, monthRange } from './budget';
import { addDays, daysBetween, todayISO, weekdayOf } from './date';
import type { Budget, Category, Transaction } from './types';

export interface MonthReview {
  month: string;
  income: number;
  spent: number;
  budgeted: number;
  spentOnBudgeted: number;
  budgetedCategories: number;
  overBudgetCategories: number;
  activeExpenseCategories: number;
  zeroBased: boolean;
  underBudget: boolean;
  budgetMaster: boolean;
  savingsRate: number;
  noSpendDays: number;
  noSpendWeekend: boolean;
}

function eachDay(from: string, to: string, visit: (date: string) => void): void {
  const count = Math.max(0, daysBetween(from, to));
  for (let index = 0; index <= count; index += 1) {
    visit(addDays(from, index));
  }
}

export function reviewMonth(
  month: string,
  transactions: readonly Transaction[],
  categories: readonly Category[],
  budgets: readonly Budget[],
): MonthReview {
  const rows = transactions.filter(
    (transaction) => transaction.type !== 'transfer' && transaction.date.startsWith(month),
  );
  const income = rows
    .filter((transaction) => transaction.amount > 0)
    .reduce((total, transaction) => total + transaction.amount, 0);
  const spent = rows
    .filter((transaction) => transaction.amount < 0)
    .reduce((total, transaction) => total - transaction.amount, 0);

  const expenseCategories = categories.filter(
    (category) => category.kind === 'expense' && !category.archived,
  );
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const budgetFor = new Map(monthBudgets.map((budget) => [budget.categoryId, budget]));

  let budgeted = 0;
  let availableTotal = 0;
  let spentOnBudgeted = 0;
  let overBudgetCategories = 0;
  let budgetedCategories = 0;

  for (const category of expenseCategories) {
    const budget = budgetFor.get(category.id);
    if (!budget) continue;
    const limit = Math.max(0, budget.limit);
    const available = limit + rolloverIn(category.id, month, transactions, budgets);
    const categorySpent = spentInMonth(transactions, category.id, month);
    budgeted += limit;
    availableTotal += available;
    spentOnBudgeted += categorySpent;
    budgetedCategories += 1;
    if (categorySpent > available) overBudgetCategories += 1;
  }

  const zeroBased =
    expenseCategories.length > 0 && budgetedCategories === expenseCategories.length;
  const underBudget = budgetedCategories > 0 && spentOnBudgeted <= availableTotal;
  const budgetMaster = budgetedCategories > 0 && overBudgetCategories === 0;
  const savingsRate = income > 0 ? (income - spent) / income : 0;

  const { from, to } = monthRange(month);
  const today = todayISO();
  const end = to < today ? to : today;
  const spendDays = new Set(
    rows.filter((transaction) => transaction.amount < 0).map((transaction) => transaction.date),
  );
  let noSpendDays = 0;
  const silent = new Set<string>();
  if (end >= from) {
    eachDay(from, end, (date) => {
      if (!spendDays.has(date)) {
        noSpendDays += 1;
        silent.add(date);
      }
    });
  }

  let noSpendWeekend = false;
  if (end >= from) {
    eachDay(from, end, (date) => {
      const weekday = weekdayOf(date);
      if (weekday !== 6) return;
      const sunday = new Date(`${date}T12:00:00`);
      sunday.setDate(sunday.getDate() + 1);
      const sundayISO = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(sunday.getDate()).padStart(2, '0')}`;
      if (sundayISO <= end && silent.has(date) && silent.has(sundayISO)) {
        noSpendWeekend = true;
      }
    });
  }

  return {
    month,
    income,
    spent,
    budgeted,
    spentOnBudgeted,
    budgetedCategories,
    overBudgetCategories,
    activeExpenseCategories: expenseCategories.length,
    zeroBased,
    underBudget,
    budgetMaster,
    savingsRate,
    noSpendDays,
    noSpendWeekend,
  };
}

/** Closed months that have data, oldest first, excluding the current month. */
export function closedMonths(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  today = todayISO(),
): string[] {
  const current = today.slice(0, 7);
  const months = new Set<string>();
  for (const transaction of transactions) months.add(transaction.date.slice(0, 7));
  for (const budget of budgets) months.add(budget.month);
  return [...months].filter((month) => month < current).sort();
}
