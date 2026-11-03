/**
 * Progress maths for the completion loop.
 *
 * Everything here is pure: the store feeds in the current progress and a task,
 * and gets back the next progress plus whatever the UI should celebrate.
 *
 * Rewards stack in four layers so a single tick feels good without becoming
 * noise:
 *   1. base XP per priority
 *   2. a checklist bonus for finishing a parent's last subtask
 *   3. a combo multiplier for completing tasks in quick succession
 *   4. achievements, streaks and levels that surface as toasts
 */

import type { Priority, Progress, Task } from './types';
import { EMPTY_PROGRESS } from './types';
import { addDays, dateRange, todayISO } from './date';

export const XP_BY_PRIORITY: Record<Priority, number> = { 1: 12, 2: 8, 3: 5, 4: 3 };
/** Extra XP when finishing the last subtask of a checklist. */
export const CHECKLIST_BONUS = 6;
/** Window in which back-to-back completions keep building the combo. */
export const COMBO_WINDOW = 8000;
/** The combo multiplier is capped so a long run stays believable. */
export const COMBO_CAP = 5;

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

/** The combo the *next* completion would land on, for instant feedback. */
export function nextCombo(progress: Progress, at = Date.now()): number {
  const chain = progress.lastComboAt !== null && at - progress.lastComboAt < COMBO_WINDOW;
  return Math.min(chain ? progress.combo + 1 : 1, COMBO_CAP);
}

/** What a completion is worth from the tick alone (base XP × combo). */
export function previewGain(
  progress: Progress,
  priority: Priority,
  at = Date.now(),
): { xp: number; multiplier: number } {
  const combo = nextCombo(progress, at);
  return { xp: Math.round(xpForTask(priority) * combo), multiplier: combo };
}

/* ── Achievements ─────────────────────────────────────────────────────────── */

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  check: (progress: Progress) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', icon: '🌱', title: 'First step', description: 'Complete your first task', check: (p) => p.totalCompleted >= 1 },
  { id: 'ten', icon: '🎯', title: 'Getting going', description: 'Complete 10 tasks', check: (p) => p.totalCompleted >= 10 },
  { id: 'fifty', icon: '🏗️', title: 'Builder', description: 'Complete 50 tasks', check: (p) => p.totalCompleted >= 50 },
  { id: 'hundred', icon: '💯', title: 'Century', description: 'Complete 100 tasks', check: (p) => p.totalCompleted >= 100 },
  { id: 'streak3', icon: '🔥', title: 'Warming up', description: 'Reach a 3-day streak', check: (p) => p.bestStreak >= 3 },
  { id: 'streak7', icon: '🗓️', title: 'Week strong', description: 'Reach a 7-day streak', check: (p) => p.bestStreak >= 7 },
  { id: 'streak30', icon: '🏔️', title: 'Mountain mover', description: 'Reach a 30-day streak', check: (p) => p.bestStreak >= 30 },
  { id: 'checklist', icon: '🧩', title: 'Checklist master', description: 'Clear 10 checklists', check: (p) => p.checklistsCleared >= 10 },
  { id: 'combo', icon: '⚡', title: 'In the zone', description: 'Land a ×5 combo', check: (p) => p.bestCombo >= COMBO_CAP },
  { id: 'day10', icon: '☀️', title: 'Big day', description: 'Complete 10 tasks in one day', check: (p) => p.bestDayCount >= 10 },
  { id: 'level5', icon: '🏅', title: 'Rising', description: 'Reach level 5', check: (p) => levelForXp(p.xp).level >= 5 },
  { id: 'level10', icon: '👑', title: 'Veteran', description: 'Reach level 10', check: (p) => levelForXp(p.xp).level >= 10 },
];

/** Achievement ids that are satisfied but not yet recorded as unlocked. */
export function newlyUnlocked(progress: Progress): Achievement[] {
  const owned = new Set(progress.unlocked);
  return ACHIEVEMENTS.filter((achievement) => !owned.has(achievement.id) && achievement.check(progress));
}

export interface CompletionOutcome {
  xpGain: number;
  /** Portion of `xpGain` that came from clearing a checklist. */
  checklistBonus: number;
  /** Combo multiplier applied to this completion. */
  multiplier: number;
  combo: number;
  progress: Progress;
  leveledUp: boolean;
  level: LevelInfo;
  /** Encouraging line to show once a day-count threshold is crossed. */
  milestone: string | null;
  /** Achievements unlocked by this completion. */
  achievements: Achievement[];
  /** Set when this completion finished a parent's whole checklist. */
  clearedParentId: string | null;
  /** Everything needed to reverse the completion, when that is possible. */
  undo: CompletionUndo | null;
}

/** Snapshot that lets the UI offer a one-tap "Undo". */
export interface CompletionUndo {
  taskId: string;
  /** Additional tasks (subtree) that were completed along with it. */
  alsoCompletedIds: string[];
  xpGain: number;
  label: string;
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
  alsoCompletedIds: string[],
  at = Date.now(),
): CompletionOutcome {
  const today = todayISO();
  const sameDay = progress.todayDate === today;
  const todayCount = (sameDay ? progress.todayCount : 0) + 1;

  // The streak only breaks once a whole day passes with nothing completed.
  let streak = progress.streak;
  if (progress.lastCompletionDate !== today) {
    streak = progress.lastCompletionDate === addDays(today, -1) ? progress.streak + 1 : 1;
  }

  const combo = nextCombo(progress, at);
  const base = xpForTask(task.priority) + (clearedParentId ? CHECKLIST_BONUS : 0);
  const xpGain = Math.round(base * combo);
  const before = levelForXp(progress.xp);

  const next: Progress = {
    ...progress,
    xp: progress.xp + xpGain,
    totalCompleted: progress.totalCompleted + 1,
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    lastCompletionDate: today,
    todayCount,
    todayDate: today,
    bestDayCount: Math.max(progress.bestDayCount, todayCount),
    combo,
    bestCombo: Math.max(progress.bestCombo, combo),
    lastComboAt: at,
    checklistsCleared: progress.checklistsCleared + (clearedParentId ? 1 : 0),
    updatedAt: at,
  };

  const achievements = newlyUnlocked(next);
  const withUnlocks: Progress = {
    ...next,
    unlocked: [...next.unlocked, ...achievements.map((achievement) => achievement.id)],
  };

  const level = levelForXp(withUnlocks.xp);

  return {
    xpGain,
    checklistBonus: clearedParentId ? CHECKLIST_BONUS * combo : 0,
    multiplier: combo,
    combo,
    progress: withUnlocks,
    leveledUp: level.level > before.level,
    level,
    milestone: sameDay ? null : MILESTONES[todayCount] ?? null,
    achievements,
    clearedParentId,
    undo: {
      taskId: task.id,
      alsoCompletedIds,
      xpGain,
      label: task.title,
    },
  };
}

/** Reverses a completion's XP so an undone task never leaves a phantom reward. */
export function revertCompletion(progress: Progress, undo: CompletionUndo): Progress {
  return {
    ...progress,
    xp: Math.max(0, progress.xp - undo.xpGain),
    totalCompleted: Math.max(0, progress.totalCompleted - 1),
    todayCount: Math.max(0, progress.todayCount - 1),
    updatedAt: Date.now(),
  };
}

/**
 * Folds progress from another device into the local record.
 *
 * Counters only ever grow, so they take the highest value; achievements are
 * unioned; day-specific fields follow the most recent completion. The result is
 * deterministic, so two devices converge after one exchange.
 */
export function mergeProgress(local: Progress, remote: Progress): Progress {
  const a: Progress = { ...EMPTY_PROGRESS, ...local, unlocked: local.unlocked ?? [] };
  const b: Progress = { ...EMPTY_PROGRESS, ...remote, unlocked: remote.unlocked ?? [] };

  const latestDate =
    !a.lastCompletionDate || (b.lastCompletionDate && b.lastCompletionDate > a.lastCompletionDate)
      ? b.lastCompletionDate
      : a.lastCompletionDate;

  // A streak belongs to the most recent chain, not simply the largest number.
  let streak: number;
  if (a.lastCompletionDate === b.lastCompletionDate) streak = Math.max(a.streak, b.streak);
  else streak = a.lastCompletionDate === latestDate ? a.streak : b.streak;

  const latestToday =
    !a.todayDate || (b.todayDate && b.todayDate > a.todayDate) ? b.todayDate : a.todayDate;
  const todayCount =
    a.todayDate === b.todayDate && a.todayDate !== null
      ? Math.max(a.todayCount, b.todayCount)
      : a.todayDate === latestToday
        ? a.todayCount
        : b.todayCount;

  const latestRecord = b.updatedAt > a.updatedAt ? b : a;

  return {
    xp: Math.max(a.xp, b.xp),
    totalCompleted: Math.max(a.totalCompleted, b.totalCompleted),
    streak,
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    lastCompletionDate: latestDate,
    todayCount,
    todayDate: latestToday,
    bestDayCount: Math.max(a.bestDayCount, b.bestDayCount),
    combo: latestRecord.combo,
    bestCombo: Math.max(a.bestCombo, b.bestCombo),
    lastComboAt:
      a.lastComboAt === null
        ? b.lastComboAt
        : b.lastComboAt === null
          ? a.lastComboAt
          : Math.max(a.lastComboAt, b.lastComboAt),
    checklistsCleared: Math.max(a.checklistsCleared, b.checklistsCleared),
    unlocked: Array.from(new Set([...a.unlocked, ...b.unlocked])).sort(),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
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

/** True when the combo window is still open, used to show the flame. */
export function comboActive(progress: Progress, at = Date.now()): boolean {
  return progress.lastComboAt !== null && at - progress.lastComboAt < COMBO_WINDOW && progress.combo > 1;
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
