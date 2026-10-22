/**
 * Progress maths for the completion loop.
 *
 * Everything here is pure: the store feeds in the current progress and a task,
 * and gets back the next progress plus whatever the UI should celebrate. XP is
 * earned per priority, with a bonus for clearing a whole checklist.
 */

import type { Priority, Progress, Task } from './types';
import { EMPTY_PROGRESS } from './types';
import { addDays, dateRange, todayISO } from './date';

export const XP_BY_PRIORITY: Record<Priority, number> = { 1: 12, 2: 8, 3: 5, 4: 3 };
/** Extra XP when finishing the last subtask of a checklist. */
export const CHECKLIST_BONUS = 6;

export { EMPTY_PROGRESS };

/** Base XP for ticking a task off. */
export function xpForTask(priority: Priority): number {
  return XP_BY_PRIORITY[priority];
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level needs in total. */
  needed: number;
  /** 0–1, for the progress ring. */
  ratio: number;
}

/** Levels get steadily more expensive: 100, then 200, then 300 XP… */
export function levelForXp(xp: number): LevelInfo {
  let level = 1;
  let into = Math.max(0, xp);
  let needed = 100;
  while (into >= needed) {
    into -= needed;
    level += 1;
    needed = level * 100;
  }
  return { level, into, needed, ratio: needed === 0 ? 0 : into / needed };
}

export interface CompletionOutcome {
  xpGain: number;
  progress: Progress;
  leveledUp: boolean;
  level: LevelInfo;
  /** Encouraging line to show once a day-count threshold is crossed. */
  milestone: string | null;
  /** Set when this completion finished a parent's whole checklist. */
  clearedParentId: string | null;
}

const MILESTONES: Record<number, string> = {
  1: 'First one down',
  3: 'Three in the bag',
  5: 'Five done today',
  10: 'Ten today — on a roll',
  20: 'Twenty today. Unstoppable.',
};

/**
 * Folds one completion into the running progress.
 * `clearedParentId` is decided by the caller, which knows the task tree.
 */
export function applyCompletion(
  progress: Progress,
  task: Task,
  clearedParentId: string | null,
): CompletionOutcome {
  const today = todayISO();
  const sameDay = progress.todayDate === today;
  const todayCount = (sameDay ? progress.todayCount : 0) + 1;

  // The streak only breaks once a whole day passes with nothing completed.
  let streak = progress.streak;
  if (progress.lastCompletionDate !== today) {
    streak = progress.lastCompletionDate === addDays(today, -1) ? progress.streak + 1 : 1;
  }

  const xpGain = xpForTask(task.priority) + (clearedParentId ? CHECKLIST_BONUS : 0);
  const before = levelForXp(progress.xp);

  const next: Progress = {
    xp: progress.xp + xpGain,
    totalCompleted: progress.totalCompleted + 1,
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    lastCompletionDate: today,
    todayCount,
    todayDate: today,
  };

  const level = levelForXp(next.xp);
  return {
    xpGain,
    progress: next,
    leveledUp: level.level > before.level,
    level,
    milestone: sameDay ? null : MILESTONES[todayCount] ?? null,
    clearedParentId,
  };
}

/** A live streak stops counting once a full day is skipped. */
export function currentStreak(progress: Progress): number {
  if (!progress.lastCompletionDate) return 0;
  const today = todayISO();
  if (progress.lastCompletionDate === today || progress.lastCompletionDate === addDays(today, -1)) {
    return progress.streak;
  }
  return 0;
}

/** Completions per day for the last `days` days, oldest first. */
export function completionsByDay(tasks: Task[], days = 14): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!task.completedAt) continue;
    const iso = new Date(task.completedAt).toISOString().slice(0, 10);
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  const end = todayISO();
  const start = addDays(end, -(days - 1));
  return dateRange(start, end).map((date) => ({ date, count: counts.get(date) ?? 0 }));
}
