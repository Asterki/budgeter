/**
 * IndexedDB persistence layer.
 *
 * Tasker is local-first: this module is the single source of truth for every
 * task, project, place, push subscription and setting. There is no server-side
 * database — the app works fully offline.
 */

import type { Place, Project, PushSubscriptionRecord, Settings, Task } from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/types';

const DB_NAME = 'tasker';
const DB_VERSION = 1;

export const STORE = {
  tasks: 'tasks',
  projects: 'projects',
  places: 'places',
  subscriptions: 'subscriptions',
  settings: 'settings',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

const SETTINGS_KEY = 'app';

let dbPromise: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
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

      if (!db.objectStoreNames.contains(STORE.tasks)) {
        const tasks = db.createObjectStore(STORE.tasks, { keyPath: 'id' });
        tasks.createIndex('byDate', 'date');
        tasks.createIndex('byProject', 'projectId');
        tasks.createIndex('byCompleted', 'completed');
      }
      if (!db.objectStoreNames.contains(STORE.projects)) {
        db.createObjectStore(STORE.projects, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.places)) {
        db.createObjectStore(STORE.places, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.subscriptions)) {
        db.createObjectStore(STORE.subscriptions, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings);
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

async function putValue<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value as unknown as object, key);
  await transactionDone(tx);
}

async function putValues<T>(store: StoreName, values: T[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  const target = tx.objectStore(store);
  for (const value of values) target.put(value as unknown as object);
  await transactionDone(tx);
}

async function deleteValue(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await transactionDone(tx);
}

async function clearStore(store: StoreName): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await transactionDone(tx);
}

export interface DatabaseSnapshot {
  tasks: Task[];
  projects: Project[];
  places: Place[];
  subscriptions: PushSubscriptionRecord[];
  settings: Settings;
}

/** Loads the complete application state in one shot (used on boot). */
export async function loadSnapshot(): Promise<DatabaseSnapshot> {
  const db = await openDatabase();
  const tx = db.transaction(
    [STORE.tasks, STORE.projects, STORE.places, STORE.subscriptions, STORE.settings],
    'readonly',
  );

  const [tasks, projects, places, subscriptions, settings] = await Promise.all([
    request(tx.objectStore(STORE.tasks).getAll() as IDBRequest<Task[]>),
    request(tx.objectStore(STORE.projects).getAll() as IDBRequest<Project[]>),
    request(tx.objectStore(STORE.places).getAll() as IDBRequest<Place[]>),
    request(tx.objectStore(STORE.subscriptions).getAll() as IDBRequest<PushSubscriptionRecord[]>),
    request(tx.objectStore(STORE.settings).get(SETTINGS_KEY) as IDBRequest<Settings | undefined>),
  ]);

  return {
    tasks,
    projects,
    places,
    subscriptions,
    settings: settings ?? { ...DEFAULT_SETTINGS },
  };
}

export const db = {
  tasks: {
    all: () => readAll<Task>(STORE.tasks),
    put: (task: Task) => putValue(STORE.tasks, task),
    putMany: (tasks: Task[]) => putValues(STORE.tasks, tasks),
    remove: (id: string) => deleteValue(STORE.tasks, id),
    clear: () => clearStore(STORE.tasks),
  },
  projects: {
    all: () => readAll<Project>(STORE.projects),
    put: (project: Project) => putValue(STORE.projects, project),
    putMany: (projects: Project[]) => putValues(STORE.projects, projects),
    remove: (id: string) => deleteValue(STORE.projects, id),
    clear: () => clearStore(STORE.projects),
  },
  places: {
    all: () => readAll<Place>(STORE.places),
    put: (place: Place) => putValue(STORE.places, place),
    putMany: (places: Place[]) => putValues(STORE.places, places),
    remove: (id: string) => deleteValue(STORE.places, id),
    clear: () => clearStore(STORE.places),
  },
  subscriptions: {
    all: () => readAll<PushSubscriptionRecord>(STORE.subscriptions),
    put: (sub: PushSubscriptionRecord) => putValue(STORE.subscriptions, sub),
    remove: (id: string) => deleteValue(STORE.subscriptions, id),
    clear: () => clearStore(STORE.subscriptions),
  },
  settings: {
    async get(): Promise<Settings> {
      const db = await openDatabase();
      const tx = db.transaction(STORE.settings, 'readonly');
      const value = await request(tx.objectStore(STORE.settings).get(SETTINGS_KEY) as IDBRequest<Settings | undefined>);
      return value ?? { ...DEFAULT_SETTINGS };
    },
    put: (settings: Settings) => putValue(STORE.settings, settings, SETTINGS_KEY),
    clear: () => clearStore(STORE.settings),
  },
};

/** Wipes every store — used by the "Reset app" action. */
export async function clearAll(): Promise<void> {
  await Promise.all([
    db.tasks.clear(),
    db.projects.clear(),
    db.places.clear(),
    db.subscriptions.clear(),
    db.settings.clear(),
  ]);
}

/** Generates a collision-resistant id without pulling in a uuid dependency. */
export function createId(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
