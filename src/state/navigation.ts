/** Navigation model shared by the shell, the rail and the bottom tab bar. */

export type ViewKey = 'tasks' | 'calendar' | 'roadmap' | 'settings';

export type TaskScope =
  | 'all'
  | 'today'
  | 'upcoming'
  | 'inbox'
  | 'completed'
  | 'project'
  | 'place';

export interface NavSelection {
  view: ViewKey;
  scope: TaskScope;
  projectId: string | null;
  place: string | null;
}

export const INITIAL_SELECTION: NavSelection = {
  view: 'tasks',
  scope: 'today',
  projectId: null,
  place: null,
};
