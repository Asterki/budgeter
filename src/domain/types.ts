/**
 * Tasker domain model.
 *
 * Everything the app knows about is described here. Records are stored verbatim
 * in IndexedDB, so these shapes double as the on-disk schema (see `src/db/database.ts`).
 */

/** Todoist-style priority: 1 is the most urgent, 4 is the default / none. */
export type Priority = 1 | 2 | 3 | 4;

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** A recurrence rule supports simple cycles and custom patterns. */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Every N days / weeks / months / years. */
  interval: number;
  /** For weekly rules: 0 (Sunday) – 6 (Saturday). Empty means "same weekday as the task". */
  byWeekday: number[];
  /** For monthly / yearly rules: explicit day-of-month numbers. */
  byMonthDay: number[];
  /** Optional hard stop. */
  until: string | null;
  /** Optional maximum number of occurrences. */
  count: number | null;
}

/** A tag belongs to exactly one project. */
export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  tags: Tag[];
  order: number;
  createdAt: number;
}

/** A contextual or physical location, e.g. `@work`, `@home`, `@downtown`. */
export interface Place {
  id: string;
  name: string;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  projectId: string | null;
  place: string | null;
  priority: Priority;

  /** Absolute calendar date as `YYYY-MM-DD`, or null for "someday". */
  date: string | null;
  /** Absolute time as `HH:mm` (24h). Null when all-day or unscheduled. */
  time: string | null;
  /** True for day-level events, false for micro-scheduled timeframes. */
  allDay: boolean;
  /** Optional duration in minutes for a micro-scheduled timeframe. */
  duration: number;

  /** Names of the project tags attached to this task. */
  tags: string[];
  /** Groups tasks into an execution sequence on the roadmap. */
  lane: string;
  recurrence: RecurrenceRule | null;

  completed: boolean;
  completedAt: number | null;
  /** Set once a notification has been delivered for this occurrence. */
  reminded: boolean;
  /** Stable id shared by every occurrence generated from one recurring task. */
  seriesId: string;

  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  /** Single key/value bag persisted in IndexedDB. */
  theme: 'nordic-light' | 'nordic-dark';
  notificationsEnabled: boolean;
  /** Minutes before the task time to fire a reminder. 0 = exactly on time. */
  reminderLeadMinutes: number;
  defaultProjectId: string | null;
  lastSyncAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'nordic-light',
  notificationsEnabled: false,
  reminderLeadMinutes: 0,
  defaultProjectId: null,
  lastSyncAt: null,
};

/** Shape of a full JSON backup produced by "Export". */
export interface BackupFile {
  app: 'tasker';
  version: number;
  exportedAt: string;
  projects: Project[];
  places: Place[];
  tasks: Task[];
  settings: Settings;
  subscriptions: PushSubscriptionRecord[];
}
