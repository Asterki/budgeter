/**
 * Assertion smoke checks for the pure money helpers.
 *
 * Run with `pnpm smoke` (tsx). No test framework: these assertions guard the
 * parsing/formatting contract without adding a test dependency.
 */

import assert from 'node:assert/strict';

import { parseAmount, formatMoney, sumBy, accountBalance, categoryActivity } from '../src/domain/money';
import {
  averageSpending,
  budgetStatus,
  monthRange,
  monthSummary,
  nextMonth,
  previousMonth,
  spentInMonth,
} from '../src/domain/budget';
import type { Account, Budget, Category, Transaction } from '../src/domain/types';
import { EMPTY_PROGRESS } from '../src/domain/types';
import {
  activityStreak,
  applyMonthReview,
  applyTransactionLog,
  mergeProgress,
} from '../src/domain/progress';
import { applyAchievementUnlocks } from '../src/domain/achievements';
import { closedMonths, reviewMonth } from '../src/domain/monthly';

const account: Account = {
  id: 'acct-1',
  name: 'Checking',
  type: 'checking',
  color: '#58a6ff',
  openingBalance: 100_000,
  archived: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
};

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    accountId: account.id,
    date: '2026-11-03',
    amount: 0,
    type: 'expense',
    categoryId: null,
    payeeId: null,
    transferAccountId: null,
    transferPairId: null,
    notes: '',
    tags: [],
    cleared: false,
    recurringId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

assert.equal(parseAmount('12.34'), 1234);
assert.equal(parseAmount('-12.34'), -1234);
assert.equal(parseAmount('(12.34)'), -1234);
assert.equal(parseAmount('$1,234.50'), 123450);
assert.equal(parseAmount('0.5'), 50);
assert.equal(parseAmount('1.005'), 101);
assert.equal(parseAmount(''), Number.NaN);
assert.equal(parseAmount('abc'), Number.NaN);

assert.equal(formatMoney(123456, 'USD', 'en-US'), '$1,234.56');
assert.equal(formatMoney(-500, 'USD', 'en-US'), '-$5.00');
assert.equal(formatMoney(1000, 'EUR', 'de-DE'), '10,00 €');

assert.equal(sumBy([1, 2, 3], (value) => value * 2), 12);
assert.equal(sumBy([], (value) => value), 0);

const transactions = [
  transaction({ amount: -2500, categoryId: 'food' }),
  transaction({ amount: -1500, categoryId: 'food', date: '2026-10-31' }),
  transaction({ amount: 5000, type: 'income', categoryId: 'salary' }),
  transaction({ amount: -1000, type: 'transfer', transferAccountId: 'acct-2' }),
];

assert.equal(accountBalance(account, transactions), 100_000 - 2500 - 1500 + 5000 - 1000);
assert.equal(categoryActivity(transactions, 'food', '2026-11'), -2500);
assert.equal(categoryActivity(transactions, 'food', '2026-12'), 0);
assert.equal(categoryActivity(transactions, 'salary', '2026-11'), 5000);



/* ── Natural-language parser ────────────────────────────────────────────── */

import { parseTransactionInput, type ParseContext } from '../src/domain/parser';
import type { Category, Payee } from '../src/domain/types';

const TODAY = '2026-11-03'; // Tuesday

const checking: Account = { ...account, id: 'acct-checking', name: 'Checking', openingBalance: 0 };
const savings: Account = { ...account, id: 'acct-savings', name: 'Savings', openingBalance: 0 };

const food: Category = {
  id: 'cat-food',
  name: 'Food',
  color: '#d29922',
  kind: 'expense',
  groupId: null,
  order: 0,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
};
const salary: Category = { ...food, id: 'cat-salary', name: 'Salary', kind: 'income' };
const housing: Category = { ...food, id: 'cat-housing', name: 'Housing' };
const drinks: Category = { ...food, id: 'cat-drinks', name: 'Drinks' };

const starbucks: Payee = {
  id: 'payee-starbucks',
  name: 'Starbucks',
  defaultCategoryId: food.id,
  createdAt: 0,
};

const context: ParseContext = {
  accounts: [checking, savings],
  categories: [food, salary, housing, drinks],
  payees: [starbucks],
  defaultAccountId: checking.id,
  currency: 'USD',
  locale: 'en-US',
  today: TODAY,
};

const parse = (input: string, overrides: Partial<ParseContext> = {}) =>
  parseTransactionInput(input, { ...context, ...overrides });

const coffee = parse('coffee 4.50 @Starbucks #Food');
assert.equal(coffee.valid, true);
assert.equal(coffee.type, 'expense');
assert.equal(coffee.amount, 450);
assert.equal(coffee.payeeName, 'Starbucks');
assert.equal(coffee.categoryName, 'Food');
assert.equal(coffee.notes, 'coffee');
assert.equal(coffee.date, TODAY);
assert.equal(coffee.accountName, 'Checking');

// A known payee supplies its default category when none was typed.
assert.equal(parse('coffee 4.50 @Starbucks').categoryId, food.id);
assert.equal(parse('coffee 4.50 @Starbucks').isNewPayee, false);

// Unknown payees/categories are flagged for creation; unknown accounts are errors.
assert.equal(parse('tea 2 @Cafe').isNewPayee, true);
assert.equal(parse('tea 2 #Drinks').isNewCategory, false);
assert.equal(parse('tea 2 #Smoothies').isNewCategory, true);
assert.ok(parse('tea 2 ^Wallet').errors.some((error) => error.code === 'account-unknown'));

// Income uses an explicit plus sign.
const paycheck = parse('salary +2500 ^Checking friday');
assert.equal(paycheck.type, 'income');
assert.equal(paycheck.amount, 250_000);
assert.equal(paycheck.accountName, 'Checking');
assert.equal(paycheck.date, '2026-11-06');
assert.equal(paycheck.notes, 'salary');

// Recurring pattern: monthly on the 1st.
const rent = parse('rent 1200 monthly on the 1st #Housing');
assert.equal(rent.recurrence?.freq, 'monthly');
assert.deepEqual(rent.recurrence?.byMonthDay, [1]);
assert.equal(rent.date, '2026-12-01');
assert.equal(rent.categoryId, housing.id);
assert.equal(rent.notes, 'rent');
assert.equal(rent.amount, 120_000);

// Transfer syntax, both explicit from/to and the arrow shorthand.
const transfer = parse('transfer 300 from Checking to Savings');
assert.equal(transfer.type, 'transfer');
assert.equal(transfer.amount, 30_000);
assert.equal(transfer.accountId, checking.id);
assert.equal(transfer.transferAccountId, savings.id);
assert.equal(transfer.notes, '');
assert.equal(parse('transfer 300 from Checking -> Savings').transferAccountId, savings.id);
assert.equal(parse('300 from Checking to Savings').type, 'transfer');
assert.equal(parse('transfer 300 from Checking to Checking').errors[0]?.code, 'transfer-same');

// Locale-aware decimals and thousands.
assert.equal(parse('lunch 12,5 yesterday').amount, 1250);
assert.equal(parse('lunch 12,5 yesterday').date, '2026-11-02');
assert.equal(parse('taxi $18 2d ago').amount, 1800);
assert.equal(parse('taxi $18 2d ago').date, '2026-11-01');
assert.equal(parse('groceries 84.20 last monday').amount, 8420);
assert.equal(parse('groceries 84.20 last monday').date, '2026-11-02');
assert.equal(parse('rent 1,200.50').amount, 120_050);
assert.equal(parse('rent 1.234,56', { locale: 'de-DE' }).amount, 123_456);
assert.equal(parse('rent $1,234').amount, 123_400);

// Amount validation.
assert.ok(parse('coffee @Starbucks').errors.some((error) => error.code === 'amount-missing'));
assert.equal(parse('coffee @Starbucks').valid, false);
assert.ok(parse('coffee 4.50 6').errors.some((error) => error.code === 'amount-ambiguous'));
assert.ok(parse('coffee 0').errors.some((error) => error.code === 'amount-missing'));
assert.equal(parse('-20 coffee').amount, 2000);
assert.equal(parse('-20 coffee').type, 'expense');

// Relative dates.
assert.equal(parse('coffee 4 tomorrow').date, '2026-11-04');
assert.equal(parse('coffee 4 tuesday').date, '2026-11-10');
assert.equal(parse('coffee 4 in 2 weeks').date, '2026-11-17');
assert.equal(parse('coffee 4 2026-12-25').date, '2026-12-25');

// Recurrence variants.
assert.equal(parse('coffee 4 every 2 weeks').recurrence?.interval, 2);
assert.deepEqual(parse('coffee 4 every monday').recurrence?.byWeekday, [1]);
assert.deepEqual(parse('coffee 4 every week').recurrence?.byWeekday, []);
assert.ok(parse('transfer 300 from Checking to Savings monthly').errors.some((error) => error.code === 'recurring-transfer'));

// Tags, cleared and remaining notes.
const tagged = parse('coffee +Morning +work !cleared');
assert.deepEqual(tagged.tags, ['morning', 'work']);
assert.equal(tagged.cleared, true);
assert.equal(tagged.notes, 'coffee');
assert.equal(parse('coffee 4 and a bun @Starbucks').notes, 'coffee and a bun');


/* ── Budgets ──────────────────────────────────────────────────────────────── */

const foodCategory: Category = {
  id: 'food',
  name: 'Food',
  color: '#d29922',
  kind: 'expense',
  groupId: null,
  order: 0,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
};

function budget(overrides: Partial<Budget>): Budget {
  return {
    id: crypto.randomUUID(),
    categoryId: foodCategory.id,
    month: '2026-11',
    limit: 0,
    rollover: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const budgetTransactions: Transaction[] = [
  transaction({ amount: -3000, categoryId: foodCategory.id, date: '2026-11-05' }),
  transaction({ amount: -2000, categoryId: foodCategory.id, date: '2026-11-20' }),
  transaction({ amount: -1000, categoryId: foodCategory.id, date: '2026-10-10' }),
  transaction({ amount: -4000, categoryId: foodCategory.id, date: '2026-09-10' }),
  transaction({ amount: -500, type: 'transfer', date: '2026-11-02' }),
  transaction({ amount: 5000, type: 'income', date: '2026-11-01' }),
];

const november = budget({ limit: 8000 });
const novemberStatus = budgetStatus(foodCategory, '2026-11', budgetTransactions, november, [november]);
assert.equal(novemberStatus.limit, 8000);
assert.equal(novemberStatus.spent, 5000);
assert.equal(novemberStatus.remaining, 3000);
assert.equal(novemberStatus.rolloverIn, 0);
assert.equal(novemberStatus.overspent, false);
assert.equal(Math.round(novemberStatus.pct), 63);

const overspentStatus = budgetStatus(
  foodCategory,
  '2026-11',
  budgetTransactions,
  budget({ limit: 4000 }),
  [budget({ limit: 4000 })],
);
assert.equal(overspentStatus.spent, 5000);
assert.equal(overspentStatus.remaining, -1000);
assert.equal(overspentStatus.overspent, true);
assert.equal(overspentStatus.pct, 125);

// Zero limit still reports spending and is overspent.
const zeroStatus = budgetStatus(foodCategory, '2026-11', budgetTransactions, budget({ limit: 0 }), []);
assert.equal(zeroStatus.limit, 0);
assert.equal(zeroStatus.spent, 5000);
assert.equal(zeroStatus.remaining, -5000);
assert.equal(zeroStatus.pct, 100);
assert.equal(zeroStatus.overspent, true);

// No budget record behaves like a zero limit.
const missingStatus = budgetStatus(foodCategory, '2026-11', budgetTransactions, undefined);
assert.equal(missingStatus.remaining, -5000);
assert.equal(missingStatus.overspent, true);

// Rollover carries the previous month's remaining balance.
const october = budget({ month: '2026-10', limit: 6000, rollover: false });
const novemberRollover = budget({ month: '2026-11', limit: 8000, rollover: true });
const rolloverStatus = budgetStatus(foodCategory, '2026-11', budgetTransactions, novemberRollover, [
  october,
  novemberRollover,
]);
assert.equal(rolloverStatus.rolloverIn, 5000);
assert.equal(rolloverStatus.remaining, 8000 + 5000 - 5000);

// Rollover carries overspend as a negative amount.
assert.equal(
  budgetStatus(foodCategory, '2026-11', budgetTransactions, novemberRollover, [
    budget({ month: '2026-10', limit: 500 }),
    novemberRollover,
  ]).rolloverIn,
  -500,
);

// Rollover chains through multiple months when each budget enables it.
const chain = [
  budget({ month: '2026-09', limit: 5000, rollover: true }),
  budget({ month: '2026-10', limit: 5000, rollover: true }),
  budget({ month: '2026-11', limit: 5000, rollover: true }),
];
// Sep spent 4000 -> +1000; Oct limit 5000 + 1000 - 1000 = 5000 carried.
assert.equal(budgetStatus(foodCategory, '2026-11', budgetTransactions, chain[2], chain).rolloverIn, 5000);

// Rollover stops when the previous month does not opt in.
assert.equal(
  budgetStatus(foodCategory, '2026-11', budgetTransactions, novemberRollover, [
    budget({ month: '2026-10', limit: 5000, rollover: false }),
    novemberRollover,
  ]).rolloverIn,
  4000,
);

// Month boundaries: adjacent months do not leak into November spending.
assert.equal(spentInMonth(budgetTransactions, foodCategory.id, '2026-11'), 5000);
assert.equal(spentInMonth(budgetTransactions, foodCategory.id, '2026-10'), 1000);
assert.equal(spentInMonth(budgetTransactions, foodCategory.id, '2026-09'), 4000);
assert.equal(spentInMonth(budgetTransactions, foodCategory.id, '2026-12'), 0);

// Summary.
const summary = monthSummary('2026-11', budgetTransactions, [november], [foodCategory]);
assert.equal(summary.income, 5000);
assert.equal(summary.spent, 5000);
assert.equal(summary.budgeted, 8000);
assert.equal(summary.unbudgeted, 0);
assert.equal(summary.remaining, 3000);
assert.equal(summary.savingsRate, 0);

const unbudgetedSummary = monthSummary('2026-11', budgetTransactions, [], [foodCategory]);
assert.equal(unbudgetedSummary.unbudgeted, 5000);
assert.equal(unbudgetedSummary.budgeted, 0);
assert.equal(unbudgetedSummary.remaining, 0);

const savingsSummary = monthSummary(
  '2026-11',
  [...budgetTransactions, transaction({ amount: 5000, type: 'income', date: '2026-11-15' })],
  [november],
  [foodCategory],
);
assert.equal(savingsSummary.income, 10_000);
assert.equal(savingsSummary.savingsRate, 0.5);

// Averages cover the three months before the target month.
assert.equal(averageSpending(foodCategory.id, '2026-11', budgetTransactions), 1667);
assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
assert.equal(monthRange('2026-11').to, '2026-11-30');
assert.equal(previousMonth('2026-01'), '2025-12');
assert.equal(nextMonth('2026-12'), '2027-01');

/* ── Scheduled transactions ─────────────────────────────────────────────── */

import { dueOccurrences, occurrenceKey, plannedItems, plannedOccurrences, recurringTransactionId } from '../src/domain/recurring';
import type { RecurrenceRule, RecurringRule } from '../src/domain/types';

function recurrence(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    freq: 'monthly',
    interval: 1,
    byWeekday: [],
    byMonthDay: [],
    until: null,
    count: null,
    ...overrides,
  };
}

function recurringRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1',
    accountId: account.id,
    amount: -1200,
    type: 'expense',
    categoryId: null,
    payeeId: null,
    transferAccountId: null,
    notes: 'Rent',
    tags: [],
    cleared: false,
    recurrence: recurrence(),
    nextDate: '2026-11-01',
    lastGeneratedDate: null,
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// Monthly on the 31st clamps to short months, then returns to the 31st.
const monthly31 = recurringRule({
  nextDate: '2026-01-31',
  recurrence: recurrence({ freq: 'monthly', byMonthDay: [31] }),
});
assert.deepEqual(dueOccurrences(monthly31, '2026-03-31').dates, [
  '2026-01-31',
  '2026-02-28',
  '2026-03-31',
]);
assert.equal(dueOccurrences(monthly31, '2026-03-31').nextDate, '2026-04-30');

// Weekly with two weekdays advances through both.
const weeklyMonWed = recurringRule({
  nextDate: '2026-11-02',
  recurrence: recurrence({ freq: 'weekly', byWeekday: [1, 3] }),
});
assert.deepEqual(dueOccurrences(weeklyMonWed, '2026-11-11').dates, [
  '2026-11-02',
  '2026-11-04',
  '2026-11-09',
  '2026-11-11',
]);

// Count caps the total number of occurrences.
const counted = recurringRule({
  nextDate: '2026-11-02',
  recurrence: recurrence({ freq: 'weekly', byWeekday: [1], count: 3 }),
});
const countedDue = dueOccurrences(counted, '2026-12-31');
assert.deepEqual(countedDue.dates, ['2026-11-02', '2026-11-09', '2026-11-16']);
assert.equal(countedDue.exhausted, true);

// Until caps by date, inclusive of the end date.
const untiled = recurringRule({
  nextDate: '2026-11-01',
  recurrence: recurrence({ freq: 'daily', until: '2026-11-05' }),
});
const untilDue = dueOccurrences(untiled, '2026-11-10');
assert.equal(untilDue.dates.length, 5);
assert.equal(untilDue.dates.at(-1), '2026-11-05');
assert.equal(untilDue.exhausted, true);

// A 90-day idle gap catches up every missing day and stops at today.
const idleStart = '2026-08-05';
const idle = recurringRule({ nextDate: idleStart, recurrence: recurrence({ freq: 'daily' }) });
const idleDue = dueOccurrences(idle, '2026-11-03');
assert.equal(idleDue.dates.length, 91);
assert.equal(idleDue.dates[0], idleStart);
assert.equal(idleDue.dates.at(-1), '2026-11-03');
assert.equal(idleDue.exhausted, false);

// Very old rules stop at the per-pass cap and resume on the next pass.
const ancient = recurringRule({ nextDate: '2024-01-01', recurrence: recurrence({ freq: 'daily' }) });
const ancientDue = dueOccurrences(ancient, '2026-11-03');
assert.equal(ancientDue.dates.length, 366);
assert.equal(ancientDue.capped, true);

// Occurrence keys make generation idempotent per rule and date.
assert.equal(occurrenceKey('rule-1', '2026-11-03'), 'rule-1|2026-11-03');

// Planned dates are future only and respect the window.
const planned = plannedOccurrences(weeklyMonWed, '2026-11-03', '2026-12-01');
assert.deepEqual(planned, ['2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18', '2026-11-23', '2026-11-25', '2026-11-30']);

const items = plannedItems(
  [weeklyMonWed],
  [transaction({ date: '2026-11-02', recurringId: weeklyMonWed.id })],
  '2026-11-03',
  14,
);
assert.equal(items.length, 4);
assert.equal(items[0].date, '2026-11-04');
assert.ok(items.every((item) => item.date > '2026-11-03'));

// Paused rules produce no planned rows.
assert.deepEqual(plannedItems([{ ...weeklyMonWed, active: false }], [], '2026-11-03', 14), []);


import {
  bucketFor,
  categoryTrends,
  netWorthSeries,
  periodSeries,
  previousRange,
  rangeTotals,
  resolveRange,
  spendingByCategory,
  topPayees,
} from '../src/domain/reports';
import { forecastAccounts, forecastTotal, negativeDays } from '../src/domain/forecast';
import type { Payee } from '../src/domain/types';

const payeeList: Payee[] = [
  { id: 'payee-coffee', name: 'Coffee Bar', defaultCategoryId: food.id, createdAt: 0 },
  { id: 'payee-store', name: 'Corner Store', defaultCategoryId: null, createdAt: 0 },
];

const reportTransactions: Transaction[] = [
  transaction({ id: 'r1', date: '2026-10-15', amount: -10_000, categoryId: food.id, payeeId: 'payee-coffee' }),
  transaction({ id: 'r2', date: '2026-11-02', amount: -4_000, categoryId: food.id, payeeId: 'payee-store' }),
  transaction({ id: 'r3', date: '2026-11-03', amount: -6_000, categoryId: food.id, payeeId: 'payee-coffee' }),
  transaction({ id: 'r4', date: '2026-11-03', amount: 50_000, type: 'income', categoryId: salary.id }),
  transaction({ id: 'r5', date: '2026-11-03', amount: 0, type: 'transfer', categoryId: null }),
];

// Range presets and previous periods.
assert.deepEqual(resolveRange('month', '2026-11-14'), { from: '2026-11-01', to: '2026-11-30' });
assert.deepEqual(resolveRange('quarter', '2026-11-14'), { from: '2026-10-01', to: '2026-12-31' });
assert.deepEqual(resolveRange('year', '2026-11-14'), { from: '2026-01-01', to: '2026-12-31' });
assert.deepEqual(resolveRange('custom', '2026-11-14', { from: '2026-11-05', to: '2026-11-01' }), {
  from: '2026-11-01',
  to: '2026-11-05',
});
assert.deepEqual(previousRange({ from: '2026-11-01', to: '2026-11-30' }), {
  from: '2026-10-02',
  to: '2026-10-31',
});
assert.equal(bucketFor({ from: '2026-11-01', to: '2026-11-30' }), 'day');
assert.equal(bucketFor({ from: '2026-01-01', to: '2026-12-31' }), 'month');

// Daily buckets keep income, spending and net separate.
const novSeries = periodSeries(
  reportTransactions,
  { from: '2026-11-01', to: '2026-11-03' },
  'day',
);
assert.equal(novSeries.length, 3);
assert.equal(novSeries[2].income, 50_000);
assert.equal(novSeries[2].expense, 6_000);
assert.equal(novSeries[2].net, 44_000);
assert.equal(novSeries[0].expense, 0);

// Category spending excludes income and transfers and sorts by size.
const slices = spendingByCategory(reportTransactions, [food, salary], {
  from: '2026-11-01',
  to: '2026-11-30',
});
assert.equal(slices.length, 1);
assert.equal(slices[0].categoryId, food.id);
assert.equal(slices[0].total, 10_000);

// Range totals and savings rate.
const totals = rangeTotals(reportTransactions, { from: '2026-11-01', to: '2026-11-30' });
assert.equal(totals.income, 50_000);
assert.equal(totals.expense, 10_000);
assert.equal(totals.net, 40_000);
assert.equal(totals.savingsRate, 0.8);

// Net worth starts from opening balances and walks forward.
const worth = netWorthSeries(
  [account],
  reportTransactions,
  { from: '2026-11-01', to: '2026-11-03' },
  'day',
);
assert.equal(worth.length, 3);
assert.equal(worth[0].value, 90_000);
assert.equal(worth[2].value, 130_000);

// Top payees aggregate spending and counts.
const payees = topPayees(reportTransactions, payeeList, {
  from: '2026-11-01',
  to: '2026-11-30',
});
assert.equal(payees.length, 2);
assert.equal(payees[0].payeeId, 'payee-coffee');
assert.equal(payees[0].total, 6_000);

// Category trends compare with the previous equal period.
const trends = categoryTrends(reportTransactions, [food, salary], {
  from: '2026-11-01',
  to: '2026-11-30',
});
const foodTrend = trends.find((row) => row.categoryId === food.id);
assert.ok(foodTrend);
assert.equal(foodTrend.current, 10_000);
assert.equal(foodTrend.previous, 10_000);
assert.equal(foodTrend.delta, 0);

// Forecast walks planned occurrences forward and never stores them.
const forecastRules: RecurringRule[] = [
  recurringRule({
    id: 'forecast-daily',
    nextDate: '2026-11-04',
    amount: -1_000,
    recurrence: recurrence({ freq: 'daily' }),
  }),
];
const dailyForecast = forecastAccounts([account], [], forecastRules, TODAY, 10);
assert.equal(dailyForecast.length, 1);
assert.equal(dailyForecast[0].start, 100_000);
assert.equal(dailyForecast[0].end, 90_000);
assert.equal(dailyForecast[0].points.length, 11);
assert.deepEqual(dailyForecast[0].negativeDates, []);
assert.equal(forecastTotal(dailyForecast)[10].balance, 90_000);

// An expensive weekly bill drives an account negative and is flagged.
const expensive: RecurringRule[] = [
  recurringRule({
    id: 'forecast-weekly',
    accountId: 'acct-poor',
    nextDate: '2026-11-05',
    amount: -200_000,
    recurrence: recurrence({ freq: 'weekly', byWeekday: [4] }),
  }),
];
const poorAccount: Account = { ...account, id: 'acct-poor', openingBalance: 50_000 };
const negativeForecast = forecastAccounts([poorAccount], [], expensive, TODAY, 30);
assert.ok(negativeForecast[0].negativeDates.length > 0);
assert.equal(negativeForecast[0].negativeDates[0], '2026-11-05');
assert.deepEqual(negativeDays(negativeForecast)[0].accounts, ['Checking']);

// A rule that already generated today is not double-counted.
const alreadyRun = forecastAccounts(
  [account],
  [transaction({ date: '2026-11-03', amount: -1_000, recurringId: 'forecast-daily' })],
  [recurringRule({ ...forecastRules[0], lastGeneratedDate: '2026-11-03' })],
  TODAY,
  1,
);
assert.equal(alreadyRun[0].end, 98_000);

// Generated occurrence ids are stable across devices and unique per date.
const occurrenceA = await recurringTransactionId('rule-1', '2026-11-03');
assert.equal(occurrenceA, await recurringTransactionId('rule-1', '2026-11-03'));
assert.notEqual(occurrenceA, await recurringTransactionId('rule-1', '2026-11-04'));
assert.ok(occurrenceA.startsWith('rtx-'));

/* ── Gamification: streaks, month reviews, achievements ─────────────────── */

const octoberBudget = budget({ month: '2026-10', limit: 10_000 });
const octoberTransactions = [
  transaction({ id: 'oct-1', date: '2026-10-05', amount: -8_000, categoryId: foodCategory.id }),
];

const octoberReview = reviewMonth(
  '2026-10',
  octoberTransactions,
  [foodCategory],
  [octoberBudget],
);
assert.equal(octoberReview.underBudget, true);
assert.equal(octoberReview.budgetMaster, true);
assert.equal(octoberReview.zeroBased, true);
assert.equal(octoberReview.savingsRate, 0);
assert.equal(octoberReview.spentOnBudgeted, 8_000);
assert.ok(octoberReview.noSpendDays > 0);

const octoberReward = applyMonthReview({ ...EMPTY_PROGRESS }, octoberReview, 1_000);
assert.ok(octoberReward);
assert.equal(octoberReward.progress.underBudgetMonths, 1);
assert.equal(octoberReward.progress.bestUnderBudgetStreak, 1);
assert.equal(octoberReward.progress.zeroBasedMonths, 1);
assert.equal(octoberReward.progress.budgetMasterMonths, 1);
assert.equal(octoberReward.progress.xp, 30 + 20 + 15);

// Re-evaluating the same month never pays again.
assert.equal(applyMonthReview(octoberReward.progress, octoberReview, 2_000), null);

// Overspending earns no under-budget reward, even when a budget exists.
const overReview = reviewMonth(
  '2026-10',
  [transaction({ id: 'over', date: '2026-10-06', amount: -12_000, categoryId: foodCategory.id })],
  [foodCategory],
  [octoberBudget],
);
assert.equal(overReview.underBudget, false);
assert.equal(overReview.budgetMaster, false);
const overReward = applyMonthReview({ ...EMPTY_PROGRESS }, overReview, 1_000);
assert.ok(overReward);
assert.equal(overReward.progress.underBudgetMonths, 0);
assert.equal(overReward.progress.xp, 15);

// A zero limit counts as a budget, but any spend is automatically over.
const zeroLimitReview = reviewMonth(
  '2026-10',
  [transaction({ id: 'zero', date: '2026-10-07', amount: -500, categoryId: foodCategory.id })],
  [foodCategory],
  [budget({ month: '2026-10', limit: 0 })],
);
assert.equal(zeroLimitReview.zeroBased, true);
assert.equal(zeroLimitReview.underBudget, false);
assert.equal(zeroLimitReview.budgetMaster, false);

// Rollover carry makes a small November limit usable after an October underspend.
const rolloverBudgets = [
  budget({ id: 'r-oct', month: '2026-10', limit: 10_000, rollover: true }),
  budget({ id: 'r-nov', month: '2026-11', limit: 5_000, rollover: true }),
];
const rolloverReview = reviewMonth(
  '2026-11',
  [
    transaction({ id: 'r1', date: '2026-10-04', amount: -6_000, categoryId: foodCategory.id }),
    transaction({ id: 'r2', date: '2026-11-04', amount: -8_000, categoryId: foodCategory.id }),
  ],
  [foodCategory],
  rolloverBudgets,
);
assert.equal(rolloverReview.underBudget, true);
assert.equal(rolloverReview.budgetMaster, true);

// Income gives a savings rate; spending more than income gives a negative one.
const savingsReview = reviewMonth(
  '2026-10',
  [
    transaction({ id: 'inc', date: '2026-10-01', amount: 100_000, type: 'income' }),
    transaction({ id: 'spend', date: '2026-10-02', amount: -50_000, categoryId: foodCategory.id }),
  ],
  [foodCategory],
  [],
);
assert.equal(savingsReview.savingsRate, 0.5);
const savingsReward = applyMonthReview({ ...EMPTY_PROGRESS }, savingsReview, 1_000);
assert.ok(savingsReward);
assert.equal(savingsReward.progress.savingsMonths, 1);
assert.equal(savingsReward.progress.savingsStreak, 1);
assert.equal(savingsReward.progress.xp, 40);

assert.deepEqual(
  closedMonths(
    [
      transaction({ date: '2026-09-10' }),
      transaction({ date: '2026-10-10' }),
      transaction({ date: '2026-11-10' }),
    ],
    [budget({ month: '2026-08' })],
    TODAY,
  ),
  ['2026-08', '2026-09', '2026-10'],
);

// Streaks count consecutive days with a logged transaction.
const dayOne = transaction({ id: 'streak-1', date: '2026-10-01', amount: -100 });
const dayTwo = transaction({ id: 'streak-2', date: '2026-10-02', amount: -200 });
const dayThree = transaction({ id: 'streak-3', date: '2026-10-03', amount: -300 });
let streakProgress = { ...EMPTY_PROGRESS };
let streakReward = applyTransactionLog(
  streakProgress,
  dayOne,
  [dayOne],
  10_000,
  '2026-10-03',
);
assert.ok(streakReward);
streakProgress = streakReward.progress;
streakReward = applyTransactionLog(
  streakProgress,
  dayTwo,
  [dayOne, dayTwo],
  11_000,
  '2026-10-03',
);
assert.ok(streakReward);
streakProgress = streakReward.progress;
streakReward = applyTransactionLog(
  streakProgress,
  dayThree,
  [dayOne, dayTwo, dayThree],
  12_000,
  '2026-10-03',
);
assert.ok(streakReward);
assert.equal(streakReward.progress.streak, 3);
assert.equal(streakReward.progress.bestStreak, 3);
assert.equal(streakReward.progress.combo, 3);
assert.equal(streakReward.progress.totalLogged, 3);

// Logging the exact same transaction id again never pays twice.
assert.equal(
  applyTransactionLog(streakReward.progress, dayThree, [dayOne, dayTwo, dayThree], 20_000, '2026-10-03'),
  null,
);

// A gap resets the active streak.
assert.equal(activityStreak(['2026-10-01', '2026-10-03'], '2026-10-03'), 1);
assert.equal(activityStreak(['2026-10-01'], '2026-10-03'), 0);

// Achievements unlock from persisted counters and the live ledger.
const achievementSeed = {
  ...EMPTY_PROGRESS,
  totalLogged: 10,
  bestStreak: 7,
  underBudgetMonths: 1,
  zeroBasedMonths: 1,
  budgetMasterMonths: 1,
  savingsMonths: 1,
  noSpendDays: 1,
  noSpendWeekends: 1,
};
const achievementResult = applyAchievementUnlocks(achievementSeed, {
  progress: achievementSeed,
  accounts: [account],
  transactions: [transaction({ id: 'cleared', cleared: true })],
});
assert.ok(achievementResult.unlocked.includes('first-entry'));
assert.ok(achievementResult.unlocked.includes('ten-entries'));
assert.ok(achievementResult.unlocked.includes('streak-7'));
assert.ok(achievementResult.unlocked.includes('under-budget'));
assert.ok(achievementResult.unlocked.includes('zero-based'));
assert.ok(achievementResult.unlocked.includes('budget-master'));
assert.ok(achievementResult.unlocked.includes('reconciled-all'));
assert.equal(achievementResult.progress.xp, achievementResult.unlocked.length * 20);

// Sync merge unions evaluated months and dedupe keys instead of losing one side.
const merged = mergeProgress(
  { ...EMPTY_PROGRESS, evaluatedMonths: ['2026-09'], rewarded: ['tx:a'], xp: 100 },
  { ...EMPTY_PROGRESS, evaluatedMonths: ['2026-10'], rewarded: ['tx:b'], xp: 90 },
);
assert.deepEqual(merged.evaluatedMonths, ['2026-09', '2026-10']);
assert.deepEqual(merged.rewarded, ['tx:a', 'tx:b']);
assert.equal(merged.xp, 100);

// CSV parsing, mapping, duplicate detection, rules and masked amounts.
import {
  detectDateFormat,
  detectDelimiter,
  duplicateKey,
  existingTransactionKeys,
  guessMapping,
  parseCsv,
  parseCsvDate,
  parseImportRows,
  transactionsToCsv,
} from '../src/domain/csv';
import { planImport } from '../src/domain/import';
import { matchCategoryRule } from '../src/domain/rules';
import type { CategorizationRule } from '../src/domain/types';

const csvText = 'Date,Description,Amount,Notes\n2026-11-01,"Cafe, Corner",-4.50,latte\n2026-11-02,Salary,2500.00,pay';
const csvTable = parseCsv(csvText);
assert.deepEqual(csvTable.headers, ['Date', 'Description', 'Amount', 'Notes']);
assert.equal(csvTable.rows.length, 2);
assert.equal(csvTable.rows[0][1], 'Cafe, Corner');
assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');

const guessed = guessMapping(csvTable.headers);
assert.equal(guessed.date, 0);
assert.equal(guessed.payee, 1);
assert.equal(guessed.amount, 2);
assert.equal(guessed.notes, 3);

assert.equal(detectDateFormat(['2026-11-01']), 'YYYY-MM-DD');
assert.equal(detectDateFormat(['01.11.2026']), 'DD.MM.YYYY');
assert.equal(detectDateFormat(['11/25/2026']), 'MM/DD/YYYY');
assert.equal(parseCsvDate('01.11.2026', 'DD.MM.YYYY'), '2026-11-01');
assert.equal(parseCsvDate('11/25/2026', 'MM/DD/YYYY'), '2026-11-25');
assert.equal(parseCsvDate('31/02/2026', 'DD/MM/YYYY'), null);

const debitTable = parseCsv('Date,Debit,Credit\n2026-11-01,12.50,\n2026-11-02,,100');
const debitRows = parseImportRows(
  debitTable,
  { date: 0, amount: -1, debit: 1, credit: 2, payee: -1, notes: -1, category: -1 },
  'YYYY-MM-DD',
  'en-US',
);
assert.equal(debitRows.rows[0].amount, -1250);
assert.equal(debitRows.rows[1].amount, 10000);
assert.equal(
  duplicateKey('acct', '2026-11-01', -1250, 'Cafe'),
  duplicateKey('acct', '2026-11-01', -1250, '  cafe '),
);
const existing = existingTransactionKeys(
  [transaction({ id: 'dup', date: '2026-11-01', amount: -1250, payeeId: 'p1' })],
  new Map([['p1', 'Cafe']]),
);
assert.ok(existing.has(duplicateKey(account.id, '2026-11-01', -1250, 'Cafe')));

const ruleList: CategorizationRule[] = [
  { id: 'r1', pattern: 'coffee', categoryId: 'food', createdAt: 0, updatedAt: 0 },
];
assert.equal(matchCategoryRule(ruleList, ['Corner Coffee', ''])?.categoryId, 'food');
assert.equal(matchCategoryRule(ruleList, ['Groceries']), undefined);
assert.equal(matchCategoryRule([{ ...ruleList[0], pattern: '  ' }], ['coffee']), undefined);

const importPlan = planImport(
  [
    { date: '2026-11-01', amount: -450, payee: 'Corner Coffee', notes: 'latte', category: '' },
    { date: '2026-11-02', amount: -2000, payee: 'Market', notes: 'veg', category: 'Food' },
  ],
  {
    accountId: account.id,
    payees: [{ id: 'p1', name: 'Corner Coffee', defaultCategoryId: 'food', createdAt: 0 }],
    categories: [
      { id: 'food', name: 'Food', kind: 'expense', color: '#000', groupId: null, order: 0, archived: false, createdAt: 0, updatedAt: 0 },
    ],
    rules: ruleList,
    transactions: [],
  },
);
assert.equal(importPlan.duplicates, 0);
assert.equal(importPlan.rows[0].categoryId, 'food');
assert.equal(importPlan.rows[1].categoryId, 'food');
assert.equal(importPlan.rows[0].payeeId, 'p1');

const exported = parseCsv(
  transactionsToCsv([
    {
      date: '2026-11-01',
      account: 'Checking',
      amount: -450,
      type: 'expense',
      category: 'Food',
      payee: 'Cafe, Corner',
      notes: 'say "hi"',
      tags: ['coffee'],
      cleared: true,
    },
  ]),
);
assert.equal(exported.rows[0][0], '2026-11-01');
assert.equal(exported.rows[0][2], '-4.50');
assert.equal(exported.rows[0][5], 'Cafe, Corner');
assert.equal(exported.rows[0][8], 'yes');

assert.equal(formatMoney(1234, 'USD', 'en-US', true), '••••');
assert.equal(formatMoney(1234, 'USD', 'en-US'), '$12.34');

console.log('money, parser, budget, recurring, reports and forecast smoke checks passed');
