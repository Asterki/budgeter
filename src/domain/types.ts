/**
 * Budget domain model.
 *
 * Everything the app knows about is described here. Records are stored verbatim
 * in IndexedDB, so these shapes double as the on-disk schema (see `src/db/database.ts`).
 *
 * Money is always stored as integer minor units (cents). Amounts on a
 * transaction are signed: negative means money leaving the account.
 */

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'investment';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  color: string;
  /** Balance before any recorded transaction, in cents. */
  openingBalance: number;
  /** Optional credit limit in cents. Only meaningful for credit accounts. */
  creditLimit?: number;
  /** Optional per-account currency override; falls back to the app currency. */
  currency?: string;
  archived: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type CategoryKind = 'expense' | 'income';

/** A spending or income category. Groups are the top-level envelope. */
export interface Category {
  id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  groupId: string | null;
  order: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Top-level grouping of categories, e.g. "Living costs", "Income". */
export interface CategoryGroup {
  id: string;
  name: string;
  order: number;
}

export interface Payee {
  id: string;
  name: string;
  defaultCategoryId: string | null;
  createdAt: number;
}

/** Contains-text rule that assigns a category when the entry has none. */
export interface CategorizationRule {
  id: string;
  pattern: string;
  categoryId: string;
  createdAt: number;
  updatedAt: number;
}

export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Transaction {
  id: string;
  accountId: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Signed cents; negative is an outflow. */
  amount: number;
  type: TransactionType;
  categoryId: string | null;
  payeeId: string | null;
  /** Destination account for one half of a transfer. */
  transferAccountId: string | null;
  /** Shared by both halves of a transfer. */
  transferPairId: string | null;
  notes: string;
  tags: string[];
  cleared: boolean;
  recurringId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Budget {
  id: string;
  categoryId: string;
  /** Budget month, `YYYY-MM`. */
  month: string;
  /** Spending limit in cents. */
  limit: number;
  rollover: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** A recurrence rule supports simple cycles and custom patterns. */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Every N days / weeks / months / years. */
  interval: number;
  /** For weekly rules: 0 (Sunday) – 6 (Saturday). Empty means the start date's weekday. */
  byWeekday: number[];
  /** For monthly / yearly rules: explicit day-of-month numbers. */
  byMonthDay: number[];
  /** Optional hard stop. */
  until: string | null;
  /** Optional maximum number of occurrences. */
  count: number | null;
}

/** Template for transactions that are generated on a schedule. */
export interface RecurringRule {
  id: string;
  accountId: string;
  amount: number;
  type: TransactionType;
  categoryId: string | null;
  payeeId: string | null;
  transferAccountId: string | null;
  notes: string;
  tags: string[];
  cleared: boolean;
  recurrence: RecurrenceRule;
  /** Next date an occurrence should be generated for. */
  nextDate: string;
  lastGeneratedDate: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Running totals kept for the progress panel. Stored rather than derived so
 * deleting history never rewinds the user's level. Streaks count days with at
 * least one logged transaction, and rewarded keys dedupe XP by transaction id.
 */
export interface Progress {
  xp: number;
  /** Transactions logged by the user (generated rows are not counted twice). */
  totalLogged: number;
  /** Consecutive days with at least one logged transaction. */
  streak: number;
  bestStreak: number;
  /** `YYYY-MM-DD` of the most recent logged transaction. */
  lastLogDate: string | null;
  todayCount: number;
  todayDate: string | null;
  /** Rapid-fire logging combo, and when the last link landed. */
  combo: number;
  bestCombo: number;
  lastComboAt: number | null;
  /** Transactions marked cleared, used for the reconciliation badge. */
  reconciled: number;
  /** Closed months evaluated for budget achievements. */
  evaluatedMonths: string[];
  underBudgetMonths: number;
  underBudgetStreak: number;
  bestUnderBudgetStreak: number;
  zeroBasedMonths: number;
  budgetMasterMonths: number;
  savingsMonths: number;
  savingsStreak: number;
  bestSavingsStreak: number;
  noSpendDays: number;
  noSpendWeekends: number;
  /** Dedupe keys such as `tx:<id>` and `clear:<id>`. */
  rewarded: string[];
  /** Unlocked achievement ids. */
  unlocked: string[];
  /** Epoch ms of the last progress mutation, used to order synced records. */
  updatedAt: number;
}

export const EMPTY_PROGRESS: Progress = {
  xp: 0,
  totalLogged: 0,
  streak: 0,
  bestStreak: 0,
  lastLogDate: null,
  todayCount: 0,
  todayDate: null,
  combo: 0,
  bestCombo: 0,
  lastComboAt: null,
  reconciled: 0,
  evaluatedMonths: [],
  underBudgetMonths: 0,
  underBudgetStreak: 0,
  bestUnderBudgetStreak: 0,
  zeroBasedMonths: 0,
  budgetMasterMonths: 0,
  savingsMonths: 0,
  savingsStreak: 0,
  bestSavingsStreak: 0,
  noSpendDays: 0,
  noSpendWeekends: 0,
  rewarded: [],
  unlocked: [],
  updatedAt: 0,
};

export interface Settings {
  /** Single key/value bag persisted in IndexedDB. */
  theme: 'light' | 'dark';
  /** ISO 4217 code used for every displayed amount. */
  currency: string;
  /** BCP 47 locale passed to `Intl.NumberFormat`. */
  locale: string;
  /** Locale's first weekday (0 = Sunday … 6 = Saturday). */
  firstDayOfWeek: number;
  /** User override for the first day of the week. */
  weekStartsOn: number;
  /** Gamification state driven by transaction activity. */
  progress: Progress;
  /** Plays a short chime on completion. Off by default. */
  soundEnabled: boolean;
  /** Vibrates on completion where the device supports it. */
  hapticsEnabled: boolean;
  /** Masks balances and headline totals until switched back off. */
  hideBalances: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  currency: 'USD',
  locale: 'en-US',
  firstDayOfWeek: 0,
  weekStartsOn: 1,
  progress: { ...EMPTY_PROGRESS },
  soundEnabled: false,
  hapticsEnabled: true,
  hideBalances: false,
};

/** Shape of a full JSON backup produced by "Export". */
export interface BackupFile {
  app: 'budget';
  version: number;
  exportedAt: string;
  accounts: Account[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  payees: Payee[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: RecurringRule[];
  rules: CategorizationRule[];
  settings: Settings;
}
