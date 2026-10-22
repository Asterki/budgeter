/** Navigation model shared by the shell, the rail and the bottom tab bar. */

export type ViewKey = 'tasks' | 'calendar' | 'roadmap' | 'settings';

export type TaskScope =
  | 'scheduled'
  | 'all'
  | 'today'
  | 'upcoming'
  | 'inbox'
  | 'completed'
  | 'project'
  | 'category'
  | 'place';

export interface NavSelection {
  view: ViewKey;
  scope: TaskScope;
  projectId: string | null;
  categoryId: string | null;
  place: string | null;
}

/**
 * The landing view: every task that has a date, grouped by the day it sits on.
 * Undated work stays in the Inbox or inside its project.
 */
export const INITIAL_SELECTION: NavSelection = {
  view: 'tasks',
  scope: 'scheduled',
  projectId: null,
  categoryId: null,
  place: null,
};
