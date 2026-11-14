/**
 * IndexedDB persistence layer.
 *
 * Budget is local-first: this module is the single source of truth for every
 * account, category, payee, transaction, budget and setting. There is no
 * server-side database — the app works fully offline. Sync metadata (outbox,
 * versions, keys) lives in separate stores so domain records stay clean.
 */

import type {
  Account,
  Budget,
  CategorizationRule,
  Category,
  CategoryGroup,
  Payee,
  RecurringRule,
  Settings,
  Transaction,
} from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/types';
import { compareHlc } from '../sync/hlc';

const DB_NAME = 'budget';
/** v5 introduced the budgeting schema; v6 added categorization rules. */
const DB_VERSION = 6;

export const STORE = {
  accounts: 'accounts',
  categories: 'categories',
  categoryGroups: 'categoryGroups',
  payees: 'payees',
  transactions: 'transactions',
  budgets: 'budgets',
  recurring: 'recurring',
  rules: 'rules',
  settings: 'settings',
} as const;

export const SYNC_STORE = {
  outbox: 'sync_outbox',
  versions: 'sync_versions',
  state: 'sync_state',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];
export type EntityKind =
  | 'account'
  | 'category'
  | 'categoryGroup'
  | 'payee'
  | 'transaction'
  | 'budget'
  | 'recurring'
  | 'rule'
  | 'settings';

const SETTINGS_KEY = 'app';
const LEGACY_STORES = ['tasks', 'projects', 'places', 'subscriptions'];

let dbPromise: Promise<IDBDatabase> | null = null;

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);

    open.onupgradeneeded = () => {
      const db = open.result;

      for (const legacy of LEGACY_STORES) {
        if (db.objectStoreNames.contains(legacy)) db.deleteObjectStore(legacy);
      }

      if (!db.objectStoreNames.contains(STORE.accounts)) {
        const accounts = db.createObjectStore(STORE.accounts, { keyPath: 'id' });
        accounts.createIndex('byOrder', 'order');
      }
      if (!db.objectStoreNames.contains(STORE.categories)) {
        const categories = db.createObjectStore(STORE.categories, { keyPath: 'id' });
        categories.createIndex('byGroup', 'groupId');
      }
      if (!db.objectStoreNames.contains(STORE.categoryGroups)) {
        db.createObjectStore(STORE.categoryGroups, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.payees)) {
        db.createObjectStore(STORE.payees, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.transactions)) {
        const transactions = db.createObjectStore(STORE.transactions, { keyPath: 'id' });
        transactions.createIndex('byDate', 'date');
        transactions.createIndex('byAccount', 'accountId');
        transactions.createIndex('byCategory', 'categoryId');
      }
      if (!db.objectStoreNames.contains(STORE.budgets)) {
        const budgets = db.createObjectStore(STORE.budgets, { keyPath: 'id' });
        budgets.createIndex('byMonth', 'month');
      }
      if (!db.objectStoreNames.contains(STORE.recurring)) {
        const recurring = db.createObjectStore(STORE.recurring, { keyPath: 'id' });
        recurring.createIndex('byNextDate', 'nextDate');
      }
      if (!db.objectStoreNames.contains(STORE.rules)) {
        db.createObjectStore(STORE.rules, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings);
      }

      if (!db.objectStoreNames.contains(SYNC_STORE.outbox)) {
        const outbox = db.createObjectStore(SYNC_STORE.outbox, { keyPath: 'changeId' });
        outbox.createIndex('byEntity', ['entityType', 'entityId']);
      }
      if (!db.objectStoreNames.contains(SYNC_STORE.versions)) {
        db.createObjectStore(SYNC_STORE.versions, { keyPath: ['entityType', 'entityId'] });
      }
      if (!db.objectStoreNames.contains(SYNC_STORE.state)) {
        db.createObjectStore(SYNC_STORE.state, { keyPath: 'key' });
      }
    };

    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });

  return dbPromise;
}

async function readAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  return request(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

/* ── Write lock and sync writer ───────────────────────────────────────────── */

/** Reverse of `entityStore`: maps each domain store to its sync entity kind. */
const KIND_BY_STORE: Record<StoreName, EntityKind> = {
  accounts: 'account',
  categories: 'category',
  categoryGroups: 'categoryGroup',
  payees: 'payee',
  transactions: 'transaction',
  budgets: 'budget',
  recurring: 'recurring',
  rules: 'rule',
  settings: 'settings',
};

/**
 * Every domain write — local mutation or incoming remote change — funnels
 * through this promise chain so an entity, its version and its outbox row are
 * committed as one serialised unit. It cannot deadlock: `getVersion`,
 * `putVersion`, `putOutbox` and the silent remote writers never re-enter it.
 */
let queue: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Optional hook installed by the sync recorder. When set, every domain write is
 * version-gated and mirrored into the outbox inside the same exclusive slot.
 * When null, writes behave exactly as the plain pre-sync code: entity only, no
 * version and no outbox.
 */
export interface SyncWriter {
  nextHlc(): string;
  toChange(
    kind: EntityKind,
    id: string,
    value: unknown | null,
  ): {
    changeId: string;
    entityType: EntityKind;
    entityId: string;
    hlc: string;
    deleted: boolean;
    payload: unknown;
  };
  commitLastHlc(hlc: string): Promise<void>;
  onLocalWrite?(): void;
}

let syncWriter: SyncWriter | null = null;

export function setSyncWriter(writer: SyncWriter | null): void {
  syncWriter = writer;
}

/** Entity id for a store value: settings use a fixed key, everything else its id. */
function entityIdFor(kind: EntityKind, value: unknown, key?: IDBValidKey): string {
  if (kind === 'settings') return SETTINGS_KEY;
  const id = (value as { id?: unknown } | null)?.id;
  if (id != null) return String(id);
  return key != null ? String(key) : '';
}

async function writeEntity(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value as object, key);
  await transactionDone(tx);
}

async function writeEntities(store: StoreName, values: unknown[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  const target = tx.objectStore(store);
  for (const value of values) target.put(value as object);
  await transactionDone(tx);
}

async function deleteEntity(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await transactionDone(tx);
}

async function putValue<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<{ written: string[] }> {
  return runExclusive(async () => {
    const kind = KIND_BY_STORE[store];
    const id = entityIdFor(kind, value, key);
    const writer = syncWriter;

    if (!writer) {
      await writeEntity(store, value, key);
      return { written: [id] };
    }

    const hlc = writer.nextHlc();
    const stored = await getVersion(kind, id);
    if (stored && compareHlc(hlc, stored.hlc) <= 0) return { written: [] };

    await writeEntity(store, value, key);
    await putVersion({ entityType: kind, entityId: id, hlc, deleted: false, queued: true });
    await clearOutboxForEntity(kind, id);
    await putOutbox(writer.toChange(kind, id, value));
    await writer.commitLastHlc(hlc);
    writer.onLocalWrite?.();
    return { written: [id] };
  });
}

async function putValues<T>(store: StoreName, values: T[]): Promise<{ written: string[] }> {
  if (values.length === 0) return { written: [] };
  return runExclusive(async () => {
    const kind = KIND_BY_STORE[store];
    const writer = syncWriter;

    if (!writer) {
      await writeEntities(store, values as unknown[]);
      return { written: values.map((value) => entityIdFor(kind, value)) };
    }

    const hlc = writer.nextHlc();
    const accepted: Array<{ id: string; value: T }> = [];
    for (const value of values) {
      const id = entityIdFor(kind, value);
      const stored = await getVersion(kind, id);
      if (stored && compareHlc(hlc, stored.hlc) <= 0) continue;
      accepted.push({ id, value });
    }

    if (accepted.length === 0) return { written: [] };

    await writeEntities(store, accepted.map((entry) => entry.value) as unknown[]);
    for (const entry of accepted) {
      await putVersion({ entityType: kind, entityId: entry.id, hlc, deleted: false, queued: true });
      await clearOutboxForEntity(kind, entry.id);
      await putOutbox(writer.toChange(kind, entry.id, entry.value));
    }
    await writer.commitLastHlc(hlc);
    writer.onLocalWrite?.();
    return { written: accepted.map((entry) => entry.id) };
  });
}

async function deleteValue(store: StoreName, key: IDBValidKey): Promise<{ written: string[] }> {
  return runExclusive(async () => {
    const kind = KIND_BY_STORE[store];
    const id = kind === 'settings' ? SETTINGS_KEY : String(key);
    const writer = syncWriter;

    if (!writer) {
      await deleteEntity(store, key);
      return { written: [id] };
    }

    const hlc = writer.nextHlc();
    const stored = await getVersion(kind, id);
    if (stored && compareHlc(hlc, stored.hlc) <= 0) return { written: [] };

    await deleteEntity(store, key);
    await putVersion({ entityType: kind, entityId: id, hlc, deleted: true, queued: true });
    await clearOutboxForEntity(kind, id);
    await putOutbox(writer.toChange(kind, id, null));
    await writer.commitLastHlc(hlc);
    writer.onLocalWrite?.();
    return { written: [id] };
  });
}

async function removeMany(store: StoreName, ids: string[]): Promise<{ written: string[] }> {
  if (ids.length === 0) return { written: [] };
  return runExclusive(async () => {
    const kind = KIND_BY_STORE[store];
    const writer = syncWriter;

    if (!writer) {
      const db = await openDatabase();
      const tx = db.transaction(store, 'readwrite');
      const target = tx.objectStore(store);
      for (const id of ids) target.delete(id);
      await transactionDone(tx);
      return { written: [...ids] };
    }

    const hlc = writer.nextHlc();
    const accepted: string[] = [];
    for (const id of ids) {
      const stored = await getVersion(kind, id);
      if (stored && compareHlc(hlc, stored.hlc) <= 0) continue;
      accepted.push(id);
    }

    if (accepted.length === 0) return { written: [] };

    const db = await openDatabase();
    const tx = db.transaction(store, 'readwrite');
    const target = tx.objectStore(store);
    for (const id of accepted) target.delete(id);
    await transactionDone(tx);

    for (const id of accepted) {
      await putVersion({ entityType: kind, entityId: id, hlc, deleted: true, queued: true });
      await clearOutboxForEntity(kind, id);
      await putOutbox(writer.toChange(kind, id, null));
    }
    await writer.commitLastHlc(hlc);
    writer.onLocalWrite?.();
    return { written: accepted };
  });
}

async function clearStore(store: StoreName): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await transactionDone(tx);
}

/* ── Schema normalisation ─────────────────────────────────────────────────── */

function wholeCents(value: unknown): number {
  return Number.isFinite(value) ? Math.round(value as number) : 0;
}

function timestamp(value: unknown): number {
  return Number.isFinite(value) ? (value as number) : Date.now();
}

/**
 * Fills in fields added after a record was written. Records are stored
 * verbatim, so older rows simply read back with the new fields defaulted.
 */
export function normalizeAccount(account: Partial<Account>): Account {
  return {
    id: account.id ?? '',
    name: account.name ?? 'Account',
    type: account.type ?? 'checking',
    color: account.color ?? '#58a6ff',
    openingBalance: wholeCents(account.openingBalance),
    ...(Number.isFinite(account.creditLimit)
      ? { creditLimit: wholeCents(account.creditLimit) }
      : {}),
    ...(account.currency ? { currency: account.currency } : {}),
    archived: account.archived ?? false,
    order: account.order ?? 0,
    createdAt: timestamp(account.createdAt),
    updatedAt: timestamp(account.updatedAt ?? account.createdAt),
  };
}

export function normalizeCategory(category: Partial<Category>): Category {
  return {
    id: category.id ?? '',
    name: category.name ?? 'Category',
    color: category.color ?? '#58a6ff',
    kind: category.kind ?? 'expense',
    groupId: category.groupId ?? null,
    order: category.order ?? 0,
    archived: category.archived ?? false,
    createdAt: timestamp(category.createdAt),
    updatedAt: timestamp(category.updatedAt ?? category.createdAt),
  };
}

export function normalizeCategoryGroup(group: Partial<CategoryGroup>): CategoryGroup {
  return {
    id: group.id ?? '',
    name: group.name ?? 'Group',
    order: group.order ?? 0,
  };
}

export function normalizePayee(payee: Partial<Payee>): Payee {
  return {
    id: payee.id ?? '',
    name: payee.name ?? 'Payee',
    defaultCategoryId: payee.defaultCategoryId ?? null,
    createdAt: timestamp(payee.createdAt),
  };
}

export function normalizeTransaction(transaction: Partial<Transaction>): Transaction {
  return {
    id: transaction.id ?? '',
    accountId: transaction.accountId ?? '',
    date: transaction.date ?? '',
    amount: wholeCents(transaction.amount),
    type: transaction.type ?? 'expense',
    categoryId: transaction.categoryId ?? null,
    payeeId: transaction.payeeId ?? null,
    transferAccountId: transaction.transferAccountId ?? null,
    transferPairId: transaction.transferPairId ?? null,
    notes: transaction.notes ?? '',
    tags: transaction.tags ?? [],
    cleared: transaction.cleared ?? false,
    recurringId: transaction.recurringId ?? null,
    createdAt: timestamp(transaction.createdAt),
    updatedAt: timestamp(transaction.updatedAt ?? transaction.createdAt),
  };
}

export function normalizeBudget(budget: Partial<Budget>): Budget {
  return {
    id: budget.id ?? '',
    categoryId: budget.categoryId ?? '',
    month: budget.month ?? '',
    limit: wholeCents(budget.limit),
    rollover: budget.rollover ?? false,
    createdAt: timestamp(budget.createdAt),
    updatedAt: timestamp(budget.updatedAt ?? budget.createdAt),
  };
}

export function normalizeCategoryRule(rule: Partial<CategorizationRule>): CategorizationRule {
  return {
    id: rule.id ?? '',
    pattern: rule.pattern ?? '',
    categoryId: rule.categoryId ?? '',
    createdAt: timestamp(rule.createdAt),
    updatedAt: timestamp(rule.updatedAt ?? rule.createdAt),
  };
}

export function normalizeRecurring(rule: Partial<RecurringRule>): RecurringRule {  return {
    id: rule.id ?? '',
    accountId: rule.accountId ?? '',
    amount: wholeCents(rule.amount),
    type: rule.type ?? 'expense',
    categoryId: rule.categoryId ?? null,
    payeeId: rule.payeeId ?? null,
    transferAccountId: rule.transferAccountId ?? null,
    notes: rule.notes ?? '',
    tags: rule.tags ?? [],
    cleared: rule.cleared ?? false,
    recurrence: rule.recurrence ?? {
      freq: 'monthly',
      interval: 1,
      byWeekday: [],
      byMonthDay: [],
      until: null,
      count: null,
    },
    nextDate: rule.nextDate ?? '',
    lastGeneratedDate: rule.lastGeneratedDate ?? null,
    active: rule.active ?? true,
    createdAt: timestamp(rule.createdAt),
    updatedAt: timestamp(rule.updatedAt ?? rule.createdAt),
  };
}

export function normalizeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const value = stored ?? {};
  const storedTheme = (value as { theme?: unknown }).theme;
  const storedProgress = (value.progress ?? {}) as {
    unlocked?: unknown;
    evaluatedMonths?: unknown;
    rewarded?: unknown;
  };
  return {
    // Older builds stored `nordic-light` / `nordic-dark`; map them to the
    // current ids so restored backups and existing devices keep their theme.
    theme:
      storedTheme === 'dark' || storedTheme === 'nordic-dark'
        ? 'dark'
        : storedTheme === 'light' || storedTheme === 'nordic-light'
          ? 'light'
          : DEFAULT_SETTINGS.theme,
    currency: value.currency ?? DEFAULT_SETTINGS.currency,
    locale: value.locale ?? DEFAULT_SETTINGS.locale,
    firstDayOfWeek: value.firstDayOfWeek ?? DEFAULT_SETTINGS.firstDayOfWeek,
    weekStartsOn: value.weekStartsOn ?? DEFAULT_SETTINGS.weekStartsOn,
    progress: {
      ...DEFAULT_SETTINGS.progress,
      ...storedProgress,
      unlocked: Array.isArray(storedProgress.unlocked) ? storedProgress.unlocked : [],
      evaluatedMonths: Array.isArray(storedProgress.evaluatedMonths)
        ? storedProgress.evaluatedMonths
        : [],
      rewarded: Array.isArray(storedProgress.rewarded) ? storedProgress.rewarded : [],
    },
    soundEnabled: value.soundEnabled ?? false,
    hapticsEnabled: value.hapticsEnabled ?? true,
    hideBalances: value.hideBalances ?? false,
  };
}

export interface DatabaseSnapshot {
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

/** Loads the complete application state in one shot (used on boot). */
export async function loadSnapshot(): Promise<DatabaseSnapshot> {
  const db = await openDatabase();
  const tx = db.transaction(
    [
      STORE.accounts,
      STORE.categories,
      STORE.categoryGroups,
      STORE.payees,
      STORE.transactions,
      STORE.budgets,
      STORE.recurring,
      STORE.rules,
      STORE.settings,
    ],
    'readonly',
  );

  const [
    accounts,
    categories,
    categoryGroups,
    payees,
    transactions,
    budgets,
    recurring,
    rules,
    settings,
  ] = await Promise.all([
    request(tx.objectStore(STORE.accounts).getAll() as IDBRequest<Account[]>),
    request(tx.objectStore(STORE.categories).getAll() as IDBRequest<Category[]>),
    request(tx.objectStore(STORE.categoryGroups).getAll() as IDBRequest<CategoryGroup[]>),
    request(tx.objectStore(STORE.payees).getAll() as IDBRequest<Payee[]>),
    request(tx.objectStore(STORE.transactions).getAll() as IDBRequest<Transaction[]>),
    request(tx.objectStore(STORE.budgets).getAll() as IDBRequest<Budget[]>),
    request(tx.objectStore(STORE.recurring).getAll() as IDBRequest<RecurringRule[]>),
    request(tx.objectStore(STORE.rules).getAll() as IDBRequest<CategorizationRule[]>),
    request(tx.objectStore(STORE.settings).get(SETTINGS_KEY) as IDBRequest<Settings | undefined>),
  ]);

  return {
    accounts: accounts.map(normalizeAccount).sort((a, b) => a.order - b.order),
    categories: categories.map(normalizeCategory).sort((a, b) => a.order - b.order),
    categoryGroups: categoryGroups.map(normalizeCategoryGroup).sort((a, b) => a.order - b.order),
    payees: payees.map(normalizePayee).sort((a, b) => a.name.localeCompare(b.name)),
    transactions: transactions.map(normalizeTransaction).sort((a, b) => b.date.localeCompare(a.date)),
    budgets: budgets.map(normalizeBudget),
    recurring: recurring.map(normalizeRecurring).sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
    rules: rules.map(normalizeCategoryRule).sort((a, b) => a.pattern.localeCompare(b.pattern)),
    settings: normalizeSettings(settings),
  };
}

export const db = {
  accounts: {
    all: () => readAll<Account>(STORE.accounts),
    put: (account: Account) => putValue(STORE.accounts, account),
    putMany: (accounts: Account[]) => putValues(STORE.accounts, accounts),
    remove: (id: string) => deleteValue(STORE.accounts, id),
    clear: () => clearStore(STORE.accounts),
  },
  categories: {
    all: () => readAll<Category>(STORE.categories),
    put: (category: Category) => putValue(STORE.categories, category),
    putMany: (categories: Category[]) => putValues(STORE.categories, categories),
    remove: (id: string) => deleteValue(STORE.categories, id),
    clear: () => clearStore(STORE.categories),
  },
  categoryGroups: {
    all: () => readAll<CategoryGroup>(STORE.categoryGroups),
    put: (group: CategoryGroup) => putValue(STORE.categoryGroups, group),
    putMany: (groups: CategoryGroup[]) => putValues(STORE.categoryGroups, groups),
    remove: (id: string) => deleteValue(STORE.categoryGroups, id),
    clear: () => clearStore(STORE.categoryGroups),
  },
  payees: {
    all: () => readAll<Payee>(STORE.payees),
    put: (payee: Payee) => putValue(STORE.payees, payee),
    putMany: (payees: Payee[]) => putValues(STORE.payees, payees),
    remove: (id: string) => deleteValue(STORE.payees, id),
    clear: () => clearStore(STORE.payees),
  },
  transactions: {
    all: () => readAll<Transaction>(STORE.transactions),
    put: (transaction: Transaction) => putValue(STORE.transactions, transaction),
    putMany: (transactions: Transaction[]) => putValues(STORE.transactions, transactions),
    /**
     * Writes both halves of a transfer in one IndexedDB transaction so a crash
     * can never leave an unbalanced pair behind.
     */
    putTransferPair: (from: Transaction, to: Transaction) => putValues(STORE.transactions, [from, to]),
    remove: (id: string) => deleteValue(STORE.transactions, id),
    removeMany: (ids: string[]) => removeMany(STORE.transactions, ids),
    clear: () => clearStore(STORE.transactions),
  },
  budgets: {
    all: () => readAll<Budget>(STORE.budgets),
    put: (budget: Budget) => putValue(STORE.budgets, budget),
    putMany: (budgets: Budget[]) => putValues(STORE.budgets, budgets),
    remove: (id: string) => deleteValue(STORE.budgets, id),
    removeMany: (ids: string[]) => removeMany(STORE.budgets, ids),
    clear: () => clearStore(STORE.budgets),
  },
  recurring: {
    all: () => readAll<RecurringRule>(STORE.recurring),
    put: (rule: RecurringRule) => putValue(STORE.recurring, rule),
    putMany: (rules: RecurringRule[]) => putValues(STORE.recurring, rules),
    remove: (id: string) => deleteValue(STORE.recurring, id),
    clear: () => clearStore(STORE.recurring),
  },
  rules: {
    all: () => readAll<CategorizationRule>(STORE.rules),
    put: (rule: CategorizationRule) => putValue(STORE.rules, rule),
    putMany: (rules: CategorizationRule[]) => putValues(STORE.rules, rules),
    remove: (id: string) => deleteValue(STORE.rules, id),
    clear: () => clearStore(STORE.rules),
  },
  settings: {
    async get(): Promise<Settings> {
      const database = await openDatabase();
      const tx = database.transaction(STORE.settings, 'readonly');
      const value = await request(tx.objectStore(STORE.settings).get(SETTINGS_KEY) as IDBRequest<Settings | undefined>);
      return normalizeSettings(value);
    },
    put: (settings: Settings) => putValue(STORE.settings, settings, SETTINGS_KEY),
    clear: () => clearStore(STORE.settings),
  },
};

/** Wipes every domain store — used by the "Reset app" action. */
export async function clearAll(): Promise<void> {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.categoryGroups.clear(),
    db.payees.clear(),
    db.transactions.clear(),
    db.budgets.clear(),
    db.recurring.clear(),
    db.rules.clear(),
    db.settings.clear(),
  ]);
}

/* ── Sync metadata ────────────────────────────────────────────────────────── */

export interface OutboxRecord<T = unknown> {
  changeId: string;
  entityType: EntityKind;
  entityId: string;
  hlc: string;
  deleted: boolean;
  payload: T;
}

export interface VersionRecord {
  entityType: EntityKind;
  entityId: string;
  hlc: string;
  deleted: boolean;
  /**
   * True while this version is still owed to the relay. Set when a local write
   * enqueues, cleared once the relay confirms the change. A version that is
   * still `queued` with no outbox row is a write that crashed between the two
   * writes, and reconciliation re-enqueues it.
   */
  queued?: boolean;
}

export function entityStore(kind: EntityKind): StoreName {
  switch (kind) {
    case 'account':
      return STORE.accounts;
    case 'category':
      return STORE.categories;
    case 'categoryGroup':
      return STORE.categoryGroups;
    case 'payee':
      return STORE.payees;
    case 'transaction':
      return STORE.transactions;
    case 'budget':
      return STORE.budgets;
    case 'recurring':
      return STORE.recurring;
    case 'rule':
      return STORE.rules;
    case 'settings':
      return STORE.settings;
  }
}

export async function getVersion(kind: EntityKind, id: string): Promise<VersionRecord | undefined> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.versions, 'readonly');
  return request(
    tx.objectStore(SYNC_STORE.versions).get([kind, id]) as IDBRequest<VersionRecord | undefined>,
  );
}

export async function putVersion(version: VersionRecord): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.versions, 'readwrite');
  tx.objectStore(SYNC_STORE.versions).put(version);
  await transactionDone(tx);
}

export async function listVersions(): Promise<VersionRecord[]> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.versions, 'readonly');
  return request(tx.objectStore(SYNC_STORE.versions).getAll() as IDBRequest<VersionRecord[]>);
}

export async function listOutbox<T = unknown>(): Promise<OutboxRecord<T>[]> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.outbox, 'readonly');
  return request(tx.objectStore(SYNC_STORE.outbox).getAll() as IDBRequest<OutboxRecord<T>[]>);
}

export async function putOutbox(record: OutboxRecord): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.outbox, 'readwrite');
  tx.objectStore(SYNC_STORE.outbox).put(record);
  await transactionDone(tx);
}

export async function removeOutbox(changeIds: string[]): Promise<void> {
  if (changeIds.length === 0) return;
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.outbox, 'readwrite');
  const store = tx.objectStore(SYNC_STORE.outbox);
  for (const id of changeIds) store.delete(id);
  await transactionDone(tx);
}

export async function clearOutboxForEntity(kind: EntityKind, id: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.outbox, 'readwrite');
  const store = tx.objectStore(SYNC_STORE.outbox);
  const index = store.index('byEntity');
  const cursor = await request(index.openCursor([kind, id]));
  if (cursor) cursor.delete();
  await transactionDone(tx);
}

export async function readSyncState<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.state, 'readonly');
  const row = await request(
    tx.objectStore(SYNC_STORE.state).get(key) as IDBRequest<{ key: string; value: T } | undefined>,
  );
  return row?.value;
}

export async function writeSyncState<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.state, 'readwrite');
  tx.objectStore(SYNC_STORE.state).put({ key, value });
  await transactionDone(tx);
}

export async function deleteSyncState(key: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(SYNC_STORE.state, 'readwrite');
  tx.objectStore(SYNC_STORE.state).delete(key);
  await transactionDone(tx);
}

export async function clearSyncStores(): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(
    [SYNC_STORE.outbox, SYNC_STORE.versions, SYNC_STORE.state],
    'readwrite',
  );
  tx.objectStore(SYNC_STORE.outbox).clear();
  tx.objectStore(SYNC_STORE.versions).clear();
  tx.objectStore(SYNC_STORE.state).clear();
  await transactionDone(tx);
}

/** Reads one entity for the merge engine. */
export async function readEntity<T>(kind: EntityKind, id: string): Promise<T | undefined> {
  const database = await openDatabase();
  const store = entityStore(kind);
  const tx = database.transaction(store, 'readonly');
  const key = kind === 'settings' ? SETTINGS_KEY : id;
  return request(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

/** Writes a remote entity without echoing it back into the outbox. */
export async function writeEntitySilently(kind: EntityKind, value: unknown): Promise<void> {
  const database = await openDatabase();
  const store = entityStore(kind);
  const tx = database.transaction(store, 'readwrite');
  tx.objectStore(store).put(value as object, kind === 'settings' ? SETTINGS_KEY : undefined);
  await transactionDone(tx);
}

/** Removes a remote entity without recording a tombstone. */
export async function deleteEntitySilently(kind: EntityKind, id: string): Promise<void> {
  const database = await openDatabase();
  const store = entityStore(kind);
  const tx = database.transaction(store, 'readwrite');
  tx.objectStore(store).delete(kind === 'settings' ? SETTINGS_KEY : id);
  await transactionDone(tx);
}

/** Generates a collision-resistant id without pulling in a uuid dependency. */
export function createId(_prefix = 'id'): string {
  // Every entity gets a real UUID so two devices can never mint the same id.
  return crypto.randomUUID();
}
