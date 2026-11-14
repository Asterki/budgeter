/**
 * Application state.
 *
 * A single React context owns every domain collection. Every mutation is
 * written through to IndexedDB immediately, so the app is durable by default
 * and can be closed at any moment without losing work.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clearAll, createId, db, loadSnapshot, normalizeSettings, type DatabaseSnapshot } from '../db/database';
import type {
  Account,
  AccountType,
  BackupFile,
  Budget,
  Category,
  CategoryGroup,
  CategoryKind,
  CategorizationRule,
  Payee,
  Progress,
  RecurringRule,
  Settings,
  Transaction,
  TransactionType,
} from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/types';
import { todayISO } from '../domain/date';
import { nextOccurrence } from '../domain/recurrence';
import { achievementTitle, applyAchievementUnlocks } from '../domain/achievements';
import { closedMonths, reviewMonth } from '../domain/monthly';
import {
  applyMonthReview,
  applyReconciliation,
  applyTransactionLog,
  levelForXp,
} from '../domain/progress';
import {
  dueOccurrences,
  generatedCounts,
  occurrenceKey,
  recurringTransactionId,
} from '../domain/recurring';
import {
  disconnectSync,
  getSyncInfo,
  loadSyncRuntime,
  registerApplyHandler,
  whenInitialSyncSettles,
} from '../sync/engine';
import { emitReward } from './rewards';

export const ACCOUNT_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39c5cf'];

export const CATEGORY_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39c5cf'];

const BACKUP_VERSION = 5;

export interface NewAccountInput {
  name: string;
  type?: AccountType;
  color?: string;
  openingBalance?: number;
  creditLimit?: number;
  currency?: string;
}

export interface NewCategoryInput {
  name: string;
  kind?: CategoryKind;
  color?: string;
  groupId?: string | null;
}

export interface NewTransactionInput {
  accountId: string;
  date: string;
  /** Signed cents; negative is an outflow. */
  amount: number;
  type?: TransactionType;
  categoryId?: string | null;
  payeeId?: string | null;
  transferAccountId?: string | null;
  notes?: string;
  tags?: string[];
  cleared?: boolean;
  recurringId?: string | null;
}

export interface NewTransferInput {
  /** Account the money leaves. */
  fromAccountId: string;
  /** Account the money arrives in. */
  toAccountId: string;
  /** Positive magnitude in cents. */
  amount: number;
  date: string;
  notes?: string;
  tags?: string[];
  cleared?: boolean;
}

export interface NewRecurringInput {
  accountId: string;
  amount: number;
  type?: TransactionType;
  categoryId?: string | null;
  payeeId?: string | null;
  transferAccountId?: string | null;
  notes?: string;
  tags?: string[];
  cleared?: boolean;
  recurrence: RecurringRule['recurrence'];
  /** First date the rule still owes. Defaults to `nextDate`. */
  nextDate: string;
  /** Set when the first occurrence was recorded by hand. */
  lastGeneratedDate?: string | null;
}

interface BudgetContextValue {
  ready: boolean;
  accounts: Account[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  payees: Payee[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: RecurringRule[];
  rules: CategorizationRule[];
  settings: Settings;

  createAccount: (input: NewAccountInput) => Account;
  updateAccount: (id: string, patch: Partial<Omit<Account, 'id'>>) => void;
  deleteAccount: (id: string) => void;
  archiveAccount: (id: string, archived?: boolean) => void;

  createCategoryGroup: (name: string) => CategoryGroup;
  updateCategoryGroup: (id: string, patch: Partial<Omit<CategoryGroup, 'id'>>) => void;
  deleteCategoryGroup: (id: string) => void;

  createCategory: (input: NewCategoryInput) => Category;
  updateCategory: (id: string, patch: Partial<Omit<Category, 'id'>>) => void;
  deleteCategory: (id: string) => void;
  archiveCategory: (id: string, archived?: boolean) => void;
  /** Deletes a category and moves its transactions to another category (or none). */
  deleteCategoryReassign: (id: string, targetCategoryId: string | null) => void;

  createPayee: (name: string, defaultCategoryId?: string | null) => Payee;
  updatePayee: (id: string, patch: Partial<Omit<Payee, 'id'>>) => void;
  deletePayee: (id: string) => void;

  createRule: (pattern: string, categoryId: string) => CategorizationRule;
  deleteRule: (id: string) => void;

  /** Creates an expense/income row, or both halves of a transfer. */
  createTransaction: (input: NewTransactionInput) => Transaction;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, 'id'>>) => void;
  deleteTransaction: (id: string) => void;
  /** Writes imported rows without awarding XP. Returns how many were added. */
  importTransactions: (inputs: NewTransactionInput[]) => number;

  /** Creates both linked rows of a transfer. */
  createTransfer: (input: NewTransferInput) => { from: Transaction; to: Transaction };
  /** Deletes both rows that share a transfer pair id. */
  deleteTransfer: (pairId: string) => void;

  /** Creates or updates the limit for one category/month. */
  setBudget: (categoryId: string, month: string, limit: number, rollover?: boolean) => Budget;
  deleteBudget: (id: string) => void;
  /** Copies every limit from one month to another; returns how many were written. */
  copyBudgets: (fromMonth: string, toMonth: string) => number;

  createRecurring: (input: NewRecurringInput) => RecurringRule;
  updateRecurring: (id: string, patch: Partial<Omit<RecurringRule, 'id'>>) => void;
  /** Optionally removes rows this rule generated today or later. Returns how many rows went. */
  deleteRecurring: (id: string, deleteGenerated?: boolean) => number;
  /** Moves the rule past its next occurrence without recording it. */
  skipRecurring: (id: string) => void;
  /** Materialises due rows; safe to call repeatedly and on every app wake. */
  catchUpRecurring: () => Promise<number>;

  updateSettings: (patch: Partial<Settings>) => void;

  buildBackup: () => BackupFile;
  restoreBackup: (backup: BackupFile) => Promise<void>;
  resetEverything: () => Promise<void>;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

function nextOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), 0) + 1;
}

/** Applies a patch to one entity and writes only that record. */
function patchOne<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<Omit<T, 'id'>>,
  now?: number,
): T[] {
  return items.map((item) =>
    item.id === id ? { ...item, ...patch, ...(now === undefined ? {} : { updatedAt: now }) } : item,
  );
}

function transferHalves(
  input: NewTransactionInput,
  now: number,
): { from: Transaction; to: Transaction } | null {
  if (input.type !== 'transfer' || !input.transferAccountId) return null;
  if (input.transferAccountId === input.accountId) return null;

  const pairId = createId('xfer');
  const magnitude = Math.abs(Math.round(input.amount));
  const base = {
    date: input.date,
    notes: input.notes ?? '',
    tags: input.tags ?? [],
    cleared: input.cleared ?? false,
    transferPairId: pairId,
    type: 'transfer' as const,
    categoryId: null,
    payeeId: null,
    recurringId: input.recurringId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const from: Transaction = {
    ...base,
    id: createId('txn'),
    accountId: input.accountId,
    amount: -magnitude,
    transferAccountId: input.transferAccountId,
  };
  const to: Transaction = {
    ...base,
    id: createId('txn'),
    accountId: input.transferAccountId,
    amount: magnitude,
    transferAccountId: input.accountId,
  };
  return { from, to };
}

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<RecurringRule[]>([]);
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Refs mirror state so callbacks can read the latest values without being
  // re-created (and without stale closures).
  const accountsRef = useRef(accounts);
  const categoriesRef = useRef(categories);
  const categoryGroupsRef = useRef(categoryGroups);
  const payeesRef = useRef(payees);
  const transactionsRef = useRef(transactions);
  const budgetsRef = useRef(budgets);
  const recurringRef = useRef(recurring);
  const rulesRef = useRef(rules);
  const settingsRef = useRef(settings);
  accountsRef.current = accounts;
  categoriesRef.current = categories;
  categoryGroupsRef.current = categoryGroups;
  payeesRef.current = payees;
  transactionsRef.current = transactions;
  budgetsRef.current = budgets;
  recurringRef.current = recurring;
  rulesRef.current = rules;
  settingsRef.current = settings;

  /* ── Rewards ────────────────────────────────────────────────────────────── */

  const persistProgress = useCallback((next: Progress) => {
    const nextSettings: Settings = { ...settingsRef.current, progress: next };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    void db.settings.put(nextSettings);
  }, []);

  const awardTransactions = useCallback(
    (next: Progress, transactions: readonly Transaction[]): Progress => {
      const achievements = applyAchievementUnlocks(next, {
        progress: next,
        accounts: accountsRef.current,
        transactions,
      });
      return achievements.progress;
    },
    [],
  );

  const awardLogging = useCallback(
    (transaction: Transaction, allTransactions: readonly Transaction[]) => {
      const before = settingsRef.current.progress;
      const reward = applyTransactionLog(before, transaction, allTransactions);
      if (!reward) return;
      const withAchievements = awardTransactions(reward.progress, allTransactions);
      const unlocked = withAchievements.unlocked.filter((id) => !before.unlocked.includes(id));
      persistProgress(withAchievements);
      emitReward({
        xp: withAchievements.xp - before.xp,
        message:
          reward.combo > 1
            ? `${reward.combo}× combo · ${reward.streak}-day streak`
            : `${reward.streak}-day logging streak`,
        achievements: unlocked.map(achievementTitle),
        leveledUp: levelForXp(withAchievements.xp) > levelForXp(before.xp),
        level: levelForXp(withAchievements.xp),
      });
    },
    [awardTransactions, persistProgress],
  );

  useEffect(() => {
    let cancelled = false;

    const applySnapshot = (snapshot: DatabaseSnapshot) => {
      setAccounts(snapshot.accounts);
      setCategories(snapshot.categories);
      setCategoryGroups(snapshot.categoryGroups);
      setPayees(snapshot.payees);
      setTransactions(snapshot.transactions);
      setBudgets(snapshot.budgets);
      setRecurring(snapshot.recurring);
      setRules(snapshot.rules);
      setSettings(snapshot.settings);
    };

    const boot = async () => {
      const snapshot = await loadSnapshot();
      if (cancelled) return;
      applySnapshot(snapshot);

      registerApplyHandler(() => {
        void loadSnapshot().then((next) => {
          if (!cancelled) applySnapshot(next);
        });
      });

      // The recorder must be configured before anything writes, and the
      // catch-up effect below must not race the first pull, so the sync runtime
      // loads before the app declares itself ready.
      try {
        await loadSyncRuntime();
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void boot();
    return () => {
      cancelled = true;
      registerApplyHandler(null);
    };
  }, []);

  const catchUpRunning = useRef(false);

  const catchUpRecurring = useCallback(async (): Promise<number> => {
    if (catchUpRunning.current) return 0;
    catchUpRunning.current = true;
    try {
      const today = todayISO();
      const rules = recurringRef.current;
      if (!rules.some((rule) => rule.active)) return 0;

      const existing = new Set(
        transactionsRef.current
          .filter((transaction) => transaction.recurringId)
          .map((transaction) => occurrenceKey(transaction.recurringId!, transaction.date)),
      );
      const counts = generatedCounts(transactionsRef.current);
      const createdAt = Date.now();
      const created: Transaction[] = [];
      const changedRules: RecurringRule[] = [];

      for (const rule of rules) {
        if (!rule.active || rule.type === 'transfer') continue;

        const due = dueOccurrences(rule, today, counts.get(rule.id) ?? 0);
        for (const date of due.dates) {
          const key = occurrenceKey(rule.id, date);
          if (existing.has(key)) continue;
          existing.add(key);
          created.push({
            id: await recurringTransactionId(rule.id, date),
            accountId: rule.accountId,
            date,
            amount: rule.amount,
            type: rule.type,
            categoryId: rule.categoryId,
            payeeId: rule.payeeId,
            transferAccountId: null,
            transferPairId: null,
            notes: rule.notes,
            tags: rule.tags,
            cleared: rule.cleared,
            recurringId: rule.id,
            createdAt,
            updatedAt: createdAt,
          });
        }

        const nextActive = due.exhausted ? false : rule.active;
        if (
          due.dates.length > 0 ||
          due.nextDate !== rule.nextDate ||
          due.lastGeneratedDate !== rule.lastGeneratedDate ||
          nextActive !== rule.active
        ) {
          changedRules.push({
            ...rule,
            nextDate: due.nextDate,
            lastGeneratedDate: due.lastGeneratedDate,
            active: nextActive,
            updatedAt: createdAt,
          });
        }
      }

      if (created.length > 0) {
        await db.transactions.putMany(created);
        transactionsRef.current = [...created, ...transactionsRef.current];
        setTransactions(transactionsRef.current);
      }
      if (changedRules.length > 0) {
        await db.recurring.putMany(changedRules);
        recurringRef.current = recurringRef.current.map(
          (rule) => changedRules.find((changed) => changed.id === rule.id) ?? rule,
        );
        setRecurring(recurringRef.current);
      }
      return created.length;
    } finally {
      catchUpRunning.current = false;
    }
  }, []);

  const evaluationRunning = useRef(false);

  const evaluateClosedMonths = useCallback(async (): Promise<number> => {
    if (evaluationRunning.current) return 0;
    evaluationRunning.current = true;
    try {
      const transactions = transactionsRef.current;
      const budgets = budgetsRef.current;
      const months = closedMonths(transactions, budgets, todayISO());
      const before = settingsRef.current.progress;
      let progress = before;
      let gained = 0;
      const unlocked: string[] = [];

      for (const month of months) {
        if (progress.evaluatedMonths.includes(month)) continue;
        const review = reviewMonth(month, transactions, categoriesRef.current, budgets);
        const reward = applyMonthReview(progress, review);
        if (!reward) continue;
        const achievements = applyAchievementUnlocks(reward.progress, {
          progress: reward.progress,
          accounts: accountsRef.current,
          transactions,
        });
        progress = achievements.progress;
        unlocked.push(...achievements.unlocked);
        gained += reward.xpGain + (achievements.progress.xp - reward.progress.xp);
      }

      if (gained === 0 && unlocked.length === 0) return 0;
      persistProgress(progress);
      emitReward({
        xp: gained,
        message: 'Month review complete',
        achievements: unlocked.map(achievementTitle),
        leveledUp: levelForXp(progress.xp) > levelForXp(before.xp),
        level: levelForXp(progress.xp),
      });
      return gained;
    } finally {
      evaluationRunning.current = false;
    }
  }, [persistProgress]);

  useEffect(() => {
    if (!ready) return;
    const run = async () => {
      // Background writers must not race the first pull: a pull can deliver the
      // same occurrence, and an offline boot must still catch up, so wait for
      // the first attempt (bounded) rather than for success.
      await whenInitialSyncSettles();
      await catchUpRecurring();
      await evaluateClosedMonths();
    };
    void run();

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void run();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [ready, catchUpRecurring, evaluateClosedMonths]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    void db.settings.put(next);
  }, []);

  /* ── Accounts ───────────────────────────────────────────────────────────── */

  const createAccount = useCallback((input: NewAccountInput): Account => {
    const now = Date.now();
    const account: Account = {
      id: createId('acct'),
      name: input.name.trim() || 'Account',
      type: input.type ?? 'checking',
      color: input.color ?? ACCOUNT_COLORS[accountsRef.current.length % ACCOUNT_COLORS.length],
      openingBalance: Math.round(input.openingBalance ?? 0),
      ...(input.creditLimit !== undefined ? { creditLimit: Math.round(input.creditLimit) } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      archived: false,
      order: nextOrder(accountsRef.current),
      createdAt: now,
      updatedAt: now,
    };
    setAccounts((prev) => [...prev, account]);
    void db.accounts.put(account);
    return account;
  }, []);

  const updateAccount = useCallback((id: string, patch: Partial<Omit<Account, 'id'>>) => {
    setAccounts((prev) => {
      const next = patchOne(prev, id, patch, Date.now());
      const updated = next.find((account) => account.id === id);
      if (updated) void db.accounts.put(updated);
      return next;
    });
  }, []);

  /** Archiving hides an account without touching its history. */
  const archiveAccount = useCallback(
    (id: string, archived = true) => updateAccount(id, { archived }),
    [updateAccount],
  );

  const deleteAccount = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((account) => account.id !== id));
    void db.accounts.remove(id);

    // Remove the account's rows and both halves of any transfer touching it.
    const doomed = transactionsRef.current.filter(
      (transaction) => transaction.accountId === id || transaction.transferAccountId === id,
    );
    const pairIds = new Set(doomed.map((transaction) => transaction.transferPairId).filter(Boolean));
    const ids = transactionsRef.current
      .filter(
        (transaction) =>
          transaction.accountId === id ||
          transaction.transferAccountId === id ||
          (transaction.transferPairId !== null && pairIds.has(transaction.transferPairId)),
      )
      .map((transaction) => transaction.id);
    const idSet = new Set(ids);
    setTransactions((prev) => prev.filter((transaction) => !idSet.has(transaction.id)));
    void db.transactions.removeMany(ids);
  }, []);

  /* ── Category groups ────────────────────────────────────────────────────── */

  const createCategoryGroup = useCallback((name: string): CategoryGroup => {
    const group: CategoryGroup = {
      id: createId('group'),
      name: name.trim() || 'Group',
      order: nextOrder(categoryGroupsRef.current),
    };
    setCategoryGroups((prev) => [...prev, group]);
    void db.categoryGroups.put(group);
    return group;
  }, []);

  const updateCategoryGroup = useCallback((id: string, patch: Partial<Omit<CategoryGroup, 'id'>>) => {
    setCategoryGroups((prev) => {
      const next = patchOne(prev, id, patch);
      const updated = next.find((group) => group.id === id);
      if (updated) void db.categoryGroups.put(updated);
      return next;
    });
  }, []);

  const deleteCategoryGroup = useCallback((id: string) => {
    setCategoryGroups((prev) => prev.filter((group) => group.id !== id));
    void db.categoryGroups.remove(id);
    setCategories((prev) => {
      const touched = prev.filter((category) => category.groupId === id);
      const next = prev.map((category) =>
        category.groupId === id ? { ...category, groupId: null, updatedAt: Date.now() } : category,
      );
      next
        .filter((category) => touched.some((item) => item.id === category.id))
        .forEach((category) => void db.categories.put(category));
      return next;
    });
  }, []);

  /* ── Categories ─────────────────────────────────────────────────────────── */

  const createCategory = useCallback((input: NewCategoryInput): Category => {
    const name = input.name.trim() || 'Category';
    const kind = input.kind ?? 'expense';

    // Reuse an existing category with the same name and kind instead of
    // creating near-duplicate rows from quick-add or import flows.
    const existing = categoriesRef.current.find(
      (category) => category.name.toLowerCase() === name.toLowerCase() && category.kind === kind,
    );
    if (existing) return existing;

    const now = Date.now();
    const category: Category = {
      id: createId('cat'),
      name,
      kind,
      color: input.color ?? CATEGORY_COLORS[categoriesRef.current.length % CATEGORY_COLORS.length],
      groupId: input.groupId ?? null,
      order: nextOrder(categoriesRef.current),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    setCategories((prev) => [...prev, category]);
    void db.categories.put(category);
    return category;
  }, []);

  const updateCategory = useCallback((id: string, patch: Partial<Omit<Category, 'id'>>) => {
    setCategories((prev) => {
      const next = patchOne(prev, id, patch, Date.now());
      const updated = next.find((category) => category.id === id);
      if (updated) void db.categories.put(updated);
      return next;
    });
  }, []);

  const deleteCategory = useCallback((id: string) => {
    setCategories((prev) => prev.filter((category) => category.id !== id));
    void db.categories.remove(id);

    setBudgets((prev) => {
      const doomed = prev.filter((budget) => budget.categoryId === id);
      const next = prev.filter((budget) => budget.categoryId !== id);
      void db.budgets.removeMany(doomed.map((budget) => budget.id));
      return next;
    });
    setTransactions((prev) => {
      const affected = prev.filter((transaction) => transaction.categoryId === id);
      const next = prev.map((transaction) =>
        transaction.categoryId === id
          ? { ...transaction, categoryId: null, updatedAt: Date.now() }
          : transaction,
      );
      affected.forEach((transaction) =>
        void db.transactions.put({
          ...transaction,
          categoryId: null,
          updatedAt: Date.now(),
        }),
      );
      return next;
    });
  }, []);

  const archiveCategory = useCallback(
    (id: string, archived = true) => updateCategory(id, { archived }),
    [updateCategory],
  );

  /**
   * Deletes a category after moving its transactions to another category (or
   * to Uncategorized). Budgets for the deleted category are removed.
   */
  const deleteCategoryReassign = useCallback((id: string, targetCategoryId: string | null) => {
    setCategories((prev) => prev.filter((category) => category.id !== id));
    void db.categories.remove(id);

    setBudgets((prev) => {
      const doomed = prev.filter((budget) => budget.categoryId === id);
      if (doomed.length > 0) void db.budgets.removeMany(doomed.map((budget) => budget.id));
      return prev.filter((budget) => budget.categoryId !== id);
    });

    setTransactions((prev) => {
      const now = Date.now();
      const moved = prev
        .filter((transaction) => transaction.categoryId === id)
        .map((transaction) => ({ ...transaction, categoryId: targetCategoryId, updatedAt: now }));
      if (moved.length > 0) void db.transactions.putMany(moved);
      return prev.map((transaction) =>
        transaction.categoryId === id
          ? { ...transaction, categoryId: targetCategoryId, updatedAt: now }
          : transaction,
      );
    });
  }, []);

  /* ── Payees ─────────────────────────────────────────────────────────────── */

  const createPayee = useCallback((name: string, defaultCategoryId: string | null = null): Payee => {
    const payee: Payee = {
      id: createId('payee'),
      name: name.trim() || 'Payee',
      defaultCategoryId,
      createdAt: Date.now(),
    };
    setPayees((prev) => [...prev, payee]);
    void db.payees.put(payee);
    return payee;
  }, []);

  const updatePayee = useCallback((id: string, patch: Partial<Omit<Payee, 'id'>>) => {
    setPayees((prev) => {
      const next = patchOne(prev, id, patch);
      const updated = next.find((payee) => payee.id === id);
      if (updated) void db.payees.put(updated);
      return next;
    });
  }, []);

  const deletePayee = useCallback((id: string) => {
    setPayees((prev) => prev.filter((payee) => payee.id !== id));
    void db.payees.remove(id);
    setTransactions((prev) => {
      const affected = prev.filter((transaction) => transaction.payeeId === id);
      const next = prev.map((transaction) =>
        transaction.payeeId === id
          ? { ...transaction, payeeId: null, updatedAt: Date.now() }
          : transaction,
      );
      affected.forEach((transaction) =>
        void db.transactions.put({ ...transaction, payeeId: null, updatedAt: Date.now() }),
      );
      return next;
    });
  }, []);

  /* ── Categorization rules ───────────────────────────────────────────────── */

  const createRule = useCallback((pattern: string, categoryId: string): CategorizationRule => {
    const now = Date.now();
    const rule: CategorizationRule = {
      id: createId('rule'),
      pattern: pattern.trim(),
      categoryId,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...rulesRef.current, rule];
    rulesRef.current = next;
    setRules(next);
    void db.rules.put(rule);
    return rule;
  }, []);

  const deleteRule = useCallback((id: string) => {
    const next = rulesRef.current.filter((rule) => rule.id !== id);
    rulesRef.current = next;
    setRules(next);
    void db.rules.remove(id);
  }, []);

  /* ── Transactions ───────────────────────────────────────────────────────── */

  const createTransaction = useCallback((input: NewTransactionInput): Transaction => {
    const now = Date.now();
    const pair = transferHalves(input, now);

    if (pair) {
      setTransactions((prev) => [...prev, pair.from, pair.to]);
      void db.transactions.putTransferPair(pair.from, pair.to);
      return pair.from;
    }

    const amount = Math.round(input.amount);
    const transaction: Transaction = {
      id: createId('txn'),
      accountId: input.accountId,
      date: input.date,
      amount,
      type: input.type === 'transfer' ? 'expense' : input.type ?? (amount >= 0 ? 'income' : 'expense'),
      categoryId: input.categoryId ?? null,
      payeeId: input.payeeId ?? null,
      transferAccountId: null,
      transferPairId: null,
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      cleared: input.cleared ?? false,
      recurringId: input.recurringId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const next = [transaction, ...transactionsRef.current];
    transactionsRef.current = next;
    setTransactions(next);
    void db.transactions.put(transaction);
    awardLogging(transaction, next);
    return transaction;
  }, [awardLogging]);

  const importTransactions = useCallback((inputs: NewTransactionInput[]): number => {
    if (inputs.length === 0) return 0;
    const now = Date.now();
    const created: Transaction[] = inputs.map((input) => {
      const amount = Math.round(input.amount);
      return {
        id: createId('txn'),
        accountId: input.accountId,
        date: input.date,
        amount,
        type: input.type ?? (amount >= 0 ? 'income' : 'expense'),
        categoryId: input.categoryId ?? null,
        payeeId: input.payeeId ?? null,
        transferAccountId: null,
        transferPairId: null,
        notes: input.notes ?? '',
        tags: input.tags ?? [],
        cleared: input.cleared ?? false,
        recurringId: null,
        createdAt: now,
        updatedAt: now,
      };
    });
    const next = [...created, ...transactionsRef.current];
    transactionsRef.current = next;
    setTransactions(next);
    void db.transactions.putMany(created);
    return created.length;
  }, []);

  const updateTransaction = useCallback((id: string, patch: Partial<Omit<Transaction, 'id'>>) => {
    const target = transactionsRef.current.find((transaction) => transaction.id === id);
    const reconciling =
      patch.cleared === true && !!target && !target.cleared && target.type !== 'transfer';

    setTransactions((prev) => {
      const current = prev.find((transaction) => transaction.id === id);
      if (!current) return prev;

      const now = Date.now();
      const next = patchOne(prev, id, patch, now);
      const updated = next.find((transaction) => transaction.id === id);
      if (updated) void db.transactions.put(updated);

      // Keep the other half of a transfer in step when the shared fields change.
      if (current.type === 'transfer' && current.transferPairId) {
        const partner = next.find(
          (transaction) =>
            transaction.transferPairId === current.transferPairId &&
            transaction.id !== current.id,
        );
        if (partner) {
          const partnerPatch: Partial<Transaction> = { updatedAt: now };
          if (patch.amount !== undefined) partnerPatch.amount = -Math.abs(updated?.amount ?? 0);
          if (patch.date !== undefined) partnerPatch.date = patch.date;
          if (patch.notes !== undefined) partnerPatch.notes = patch.notes;
          if (patch.tags !== undefined) partnerPatch.tags = patch.tags;
          if (patch.cleared !== undefined) partnerPatch.cleared = patch.cleared;
          const updatedPartner = { ...partner, ...partnerPatch };
          void db.transactions.put(updatedPartner);
          return next.map((transaction) =>
            transaction.id === partner.id ? updatedPartner : transaction,
          );
        }
      }

      return next;
    });

    if (reconciling && target) {
      const before = settingsRef.current.progress;
      const reward = applyReconciliation(before, target);
      if (reward) {
        const cleared = transactionsRef.current.map((transaction) =>
          transaction.id === target.id ? { ...transaction, cleared: true } : transaction,
        );
        const withAchievements = applyAchievementUnlocks(reward.progress, {
          progress: reward.progress,
          accounts: accountsRef.current,
          transactions: cleared,
        });
        persistProgress(withAchievements.progress);
        emitReward({
          xp: withAchievements.progress.xp - before.xp,
          message: 'Transaction reconciled',
          achievements: withAchievements.unlocked.map(achievementTitle),
          leveledUp: levelForXp(withAchievements.progress.xp) > levelForXp(before.xp),
          level: levelForXp(withAchievements.progress.xp),
        });
      }
    }
  }, [persistProgress]);

  const deleteTransaction = useCallback((id: string) => {
    const target = transactionsRef.current.find((transaction) => transaction.id === id);
    const ids = target?.transferPairId
      ? transactionsRef.current
          .filter((transaction) => transaction.transferPairId === target.transferPairId)
          .map((transaction) => transaction.id)
      : [id];
    const idSet = new Set(ids);
    setTransactions((prev) => prev.filter((transaction) => !idSet.has(transaction.id)));
    void db.transactions.removeMany(ids);
  }, []);

  const createTransfer = useCallback((input: NewTransferInput) => {
    const pair = transferHalves(
      {
        accountId: input.fromAccountId,
        transferAccountId: input.toAccountId,
        amount: Math.abs(Math.round(input.amount)),
        date: input.date,
        type: 'transfer',
        notes: input.notes ?? '',
        tags: input.tags ?? [],
        cleared: input.cleared ?? false,
      },
      Date.now(),
    );
    if (!pair) throw new Error('Choose two different accounts for a transfer.');
    setTransactions((prev) => [pair.from, ...prev, pair.to]);
    void db.transactions.putTransferPair(pair.from, pair.to);
    return pair;
  }, []);

  const deleteTransfer = useCallback((pairId: string) => {
    const ids = transactionsRef.current
      .filter((transaction) => transaction.transferPairId === pairId)
      .map((transaction) => transaction.id);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setTransactions((prev) => prev.filter((transaction) => !idSet.has(transaction.id)));
    void db.transactions.removeMany(ids);
  }, []);

  /* ── Budgets ────────────────────────────────────────────────────────────── */

  const setBudget = useCallback(
    (categoryId: string, month: string, limit: number, rollover?: boolean): Budget => {
      const existing = budgetsRef.current.find(
        (budget) => budget.categoryId === categoryId && budget.month === month,
      );
      const now = Date.now();
      const amount = Math.max(0, Math.round(limit));

      if (existing) {
        const updated: Budget = {
          ...existing,
          limit: amount,
          rollover: rollover ?? existing.rollover,
          updatedAt: now,
        };
        setBudgets((prev) => prev.map((budget) => (budget.id === existing.id ? updated : budget)));
        void db.budgets.put(updated);
        return updated;
      }

      const budget: Budget = {
        id: createId('budget'),
        categoryId,
        month,
        limit: amount,
        rollover: rollover ?? false,
        createdAt: now,
        updatedAt: now,
      };
      setBudgets((prev) => [...prev, budget]);
      void db.budgets.put(budget);
      return budget;
    },
    [],
  );

  const copyBudgets = useCallback((fromMonth: string, toMonth: string): number => {
    if (fromMonth === toMonth) return 0;

    const source = budgetsRef.current.filter((budget) => budget.month === fromMonth);
    if (source.length === 0) return 0;

    const existing = new Map(
      budgetsRef.current
        .filter((budget) => budget.month === toMonth)
        .map((budget) => [budget.categoryId, budget]),
    );
    const now = Date.now();
    const written: Budget[] = [];
    const created: Budget[] = [];

    for (const budget of source) {
      const match = existing.get(budget.categoryId);
      if (match) {
        const updated: Budget = {
          ...match,
          limit: budget.limit,
          rollover: budget.rollover,
          updatedAt: now,
        };
        written.push(updated);
        existing.set(budget.categoryId, updated);
      } else {
        const fresh: Budget = {
          id: createId('budget'),
          categoryId: budget.categoryId,
          month: toMonth,
          limit: budget.limit,
          rollover: budget.rollover,
          createdAt: now,
          updatedAt: now,
        };
        written.push(fresh);
        created.push(fresh);
        existing.set(budget.categoryId, fresh);
      }
    }

    if (created.length > 0 || written.length > 0) {
      const byId = new Map(written.map((budget) => [budget.id, budget]));
      setBudgets((prev) => {
        const next = prev.map((budget) => byId.get(budget.id) ?? budget);
        return [...next, ...created.filter((budget) => !prev.some((item) => item.id === budget.id))];
      });
    }
    void db.budgets.putMany(written);
    return written.length;
  }, []);

  const deleteBudget = useCallback((id: string) => {
    setBudgets((prev) => prev.filter((budget) => budget.id !== id));
    void db.budgets.remove(id);
  }, []);

  /* ── Recurring rules ────────────────────────────────────────────────────── */

  const createRecurring = useCallback((input: NewRecurringInput): RecurringRule => {
    const now = Date.now();
    const rule: RecurringRule = {
      id: createId('recur'),
      accountId: input.accountId,
      amount: Math.round(input.amount),
      type: input.type ?? (input.amount >= 0 ? 'income' : 'expense'),
      categoryId: input.categoryId ?? null,
      payeeId: input.payeeId ?? null,
      transferAccountId: input.transferAccountId ?? null,
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      cleared: input.cleared ?? false,
      recurrence: input.recurrence,
      nextDate: input.nextDate,
      lastGeneratedDate: input.lastGeneratedDate ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    setRecurring((prev) => [...prev, rule]);
    void db.recurring.put(rule);
    return rule;
  }, []);

  const updateRecurring = useCallback((id: string, patch: Partial<Omit<RecurringRule, 'id'>>) => {
    setRecurring((prev) => {
      const next = patchOne(prev, id, patch, Date.now());
      const updated = next.find((rule) => rule.id === id);
      if (updated) void db.recurring.put(updated);
      return next;
    });
  }, []);

  const deleteRecurring = useCallback((id: string, deleteGenerated = false): number => {
    let removed = 0;

    if (deleteGenerated) {
      const today = todayISO();
      const ids = new Set(
        transactionsRef.current
          .filter((transaction) => transaction.recurringId === id && transaction.date >= today)
          .map((transaction) => transaction.id),
      );
      if (ids.size > 0) {
        setTransactions((prev) => prev.filter((transaction) => !ids.has(transaction.id)));
        void db.transactions.removeMany([...ids]);
        removed = ids.size;
      }
    }

    setRecurring((prev) => prev.filter((rule) => rule.id !== id));
    void db.recurring.remove(id);
    return removed;
  }, []);

  const skipRecurring = useCallback((id: string) => {
    setRecurring((prev) =>
      prev.map((rule) => {
        if (rule.id !== id) return rule;
        const nextDate = nextOccurrence(rule.recurrence, rule.nextDate);
        const ended = rule.recurrence.until !== null && nextDate > rule.recurrence.until;
        const updated: RecurringRule = {
          ...rule,
          nextDate,
          active: ended ? false : rule.active,
          updatedAt: Date.now(),
        };
        void db.recurring.put(updated);
        return updated;
      }),
    );
  }, []);

  /* ── Data portability ───────────────────────────────────────────────────── */

  const buildBackup = useCallback(
    (): BackupFile => ({
      app: 'budget',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      accounts: accountsRef.current,
      categories: categoriesRef.current,
      categoryGroups: categoryGroupsRef.current,
      payees: payeesRef.current,
      transactions: transactionsRef.current,
      budgets: budgetsRef.current,
      recurring: recurringRef.current,
      rules: rulesRef.current,
      settings: settingsRef.current,
    }),
    [],
  );

  const restoreBackup = useCallback(async (backup: BackupFile) => {
    const app = (backup as { app?: unknown } | null)?.app;
    if (
      !backup ||
      app !== 'budget' ||
      !Array.isArray(backup.accounts) ||
      !Array.isArray(backup.transactions)
    ) {
      throw new Error('This file is not a Budget backup.');
    }
    if (await getSyncInfo()) {
      throw new Error('Disconnect sync before restoring a backup.');
    }
    await clearAll();

    await db.accounts.putMany(backup.accounts ?? []);
    await db.categoryGroups.putMany(backup.categoryGroups ?? []);
    await db.categories.putMany(backup.categories ?? []);
    await db.payees.putMany(backup.payees ?? []);
    await db.transactions.putMany(backup.transactions ?? []);
    await db.budgets.putMany(backup.budgets ?? []);
    await db.recurring.putMany(backup.recurring ?? []);
    await db.rules.putMany(backup.rules ?? []);
    await db.settings.put(normalizeSettings(backup.settings));

    const snapshot = await loadSnapshot();
    setAccounts(snapshot.accounts);
    setCategories(snapshot.categories);
    setCategoryGroups(snapshot.categoryGroups);
    setPayees(snapshot.payees);
    setTransactions(snapshot.transactions);
    setBudgets(snapshot.budgets);
    setRecurring(snapshot.recurring);
    setRules(snapshot.rules);
    setSettings(snapshot.settings);
  }, []);

  const resetEverything = useCallback(async () => {
    await disconnectSync();
    await clearAll();
    setAccounts([]);
    setCategories([]);
    setCategoryGroups([]);
    setPayees([]);
    setTransactions([]);
    setBudgets([]);
    setRecurring([]);
    setRules([]);
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const value = useMemo<BudgetContextValue>(
    () => ({
      ready,
      accounts,
      categories,
      categoryGroups,
      payees,
      transactions,
      budgets,
      recurring,
      rules,
      settings,
      createAccount,
      updateAccount,
      deleteAccount,
      archiveAccount,
      createCategoryGroup,
      updateCategoryGroup,
      deleteCategoryGroup,
      createCategory,
      updateCategory,
      deleteCategory,
      archiveCategory,
      deleteCategoryReassign,
      createPayee,
      updatePayee,
      deletePayee,
      createRule,
      deleteRule,
      createTransaction,
      updateTransaction,
      deleteTransaction,
      importTransactions,
      createTransfer,
      deleteTransfer,
      setBudget,
      deleteBudget,
      copyBudgets,
      createRecurring,
      updateRecurring,
      deleteRecurring,
      skipRecurring,
      catchUpRecurring,
      updateSettings,
      buildBackup,
      restoreBackup,
      resetEverything,
    }),
    [
      ready,
      accounts,
      categories,
      categoryGroups,
      payees,
      transactions,
      budgets,
      recurring,
      rules,
      settings,
      createAccount,
      updateAccount,
      deleteAccount,
      archiveAccount,
      createCategoryGroup,
      updateCategoryGroup,
      deleteCategoryGroup,
      createCategory,
      updateCategory,
      deleteCategory,
      archiveCategory,
      deleteCategoryReassign,
      createPayee,
      updatePayee,
      deletePayee,
      createRule,
      deleteRule,
      createTransaction,
      updateTransaction,
      deleteTransaction,
      importTransactions,
      createTransfer,
      deleteTransfer,
      setBudget,
      deleteBudget,
      copyBudgets,
      createRecurring,
      updateRecurring,
      deleteRecurring,
      skipRecurring,
      catchUpRecurring,
      updateSettings,
      buildBackup,
      restoreBackup,
      resetEverything,
    ],
  );

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget(): BudgetContextValue {
  const context = useContext(BudgetContext);
  if (!context) throw new Error('useBudget must be used inside <BudgetProvider>.');
  return context;
}
