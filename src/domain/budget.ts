/**
 * Budget math.
 *
 * Pure functions over integer cents. A budget belongs to one expense category
 * and one `YYYY-MM` month; rollover carries the previous month's remaining
 * amount (positive or negative) forward, recursively.
 */

import type { Budget, Category, Transaction } from './types';

export interface BudgetStatus {
  /** Base limit for the month, in cents. */
  limit: number;
  /** Positive cents spent in this category during the month. */
  spent: number;
  /** Amount carried in from earlier months, in cents. */
  rolloverIn: number;
  /** limit + rolloverIn - spent, in cents. */
  remaining: number;
  /** Spend as a percentage of the available limit; 0 when nothing is budgeted. */
  pct: number;
  overspent: boolean;
}

export interface MonthSummary {
  income: number;
  /** Spending in expense categories, as positive cents. */
  spent: number;
  budgeted: number;
  /** Spending that falls outside any active budget, positive cents. */
  unbudgeted: number;
  /** (income - spent) / income, 0 when there is no income. */
  savingsRate: number;
  /** Sum of remaining amounts for budgeted categories, in cents. */
  remaining: number;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(today: string): string {
  return monthOf(today);
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(year, monthNumber, 0);
  return {
    from: `${month}-01`,
    to: `${month}-${String(end.getDate()).padStart(2, '0')}`,
  };
}

function findBudget(budgets: readonly Budget[], categoryId: string, month: string): Budget | undefined {
  return budgets.find((budget) => budget.categoryId === categoryId && budget.month === month);
}

/** Positive cents spent by a category in a month. Refunds reduce the total. */
export function spentInMonth(
  transactions: readonly Transaction[],
  categoryId: string,
  month: string,
): number {
  let total = 0;
  for (const transaction of transactions) {
    if (transaction.type === 'transfer') continue;
    if (transaction.categoryId !== categoryId) continue;
    if (monthOf(transaction.date) !== month) continue;
    total += -transaction.amount;
  }
  return total;
}

/**
 * Amount carried into `month`. Zero unless that month's budget has rollover
 * enabled; otherwise the previous month's remaining balance (which may be
 * negative) is added, following the chain of rollover-enabled months.
 */
export function rolloverIn(
  categoryId: string,
  month: string,
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  depth = 60,
): number {
  const current = findBudget(budgets, categoryId, month);
  if (!current?.rollover || depth <= 0) return 0;

  const previous = previousMonth(month);
  const prior = findBudget(budgets, categoryId, previous);
  const carried = rolloverIn(categoryId, previous, transactions, budgets, depth - 1);
  return (prior?.limit ?? 0) + carried - spentInMonth(transactions, categoryId, previous);
}

export function budgetStatus(
  category: Category,
  month: string,
  transactions: Transaction[],
  budget: Budget | null | undefined,
  budgets: Budget[] = [],
): BudgetStatus {
  const limit = budget?.limit ?? 0;
  const spent = spentInMonth(transactions, category.id, month);
  const carry = budget?.rollover
    ? rolloverIn(category.id, month, transactions, budgets.length > 0 ? budgets : [budget])
    : 0;
  const available = limit + carry;
  const remaining = available - spent;
  const pct = available > 0 ? (spent / available) * 100 : spent > 0 ? 100 : 0;

  return {
    limit,
    spent,
    rolloverIn: carry,
    remaining,
    pct,
    overspent: remaining < 0,
  };
}

/** Spending for a category over the `count` months before `month`. */
export function averageSpending(
  categoryId: string,
  month: string,
  transactions: Transaction[],
  count = 3,
): number {
  let total = 0;
  let cursor = previousMonth(month);
  for (let index = 0; index < count; index += 1) {
    total += spentInMonth(transactions, categoryId, cursor);
    cursor = previousMonth(cursor);
  }
  return Math.round(total / count);
}

export function monthSummary(
  month: string,
  transactions: Transaction[],
  budgets: Budget[],
  categories: Category[],
): MonthSummary {
  let income = 0;
  let spent = 0;
  let unbudgeted = 0;

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const monthBudgets = budgets.filter((budget) => budget.month === month);
  const budgetedCategories = new Set(monthBudgets.map((budget) => budget.categoryId));

  for (const transaction of transactions) {
    if (transaction.type === 'transfer') continue;
    if (monthOf(transaction.date) !== month) continue;

    if (transaction.type === 'income') {
      income += transaction.amount;
      continue;
    }

    const amount = -transaction.amount;
    spent += amount;
    if (!transaction.categoryId || !budgetedCategories.has(transaction.categoryId)) {
      unbudgeted += amount;
    }
  }

  let budgeted = 0;
  let remaining = 0;
  for (const budget of monthBudgets) {
    const category = categoryById.get(budget.categoryId);
    if (!category || category.kind !== 'expense') continue;
    const status = budgetStatus(category, month, transactions, budget, budgets);
    budgeted += status.limit;
    remaining += status.remaining;
  }

  return {
    income,
    spent,
    budgeted,
    unbudgeted,
    savingsRate: income > 0 ? (income - spent) / income : 0,
    remaining,
  };
}
