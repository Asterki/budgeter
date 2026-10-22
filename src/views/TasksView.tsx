/**
 * Tasks view — a clean, sortable, filterable list with debounced live search.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { Priority, Task } from '../domain/types';
import { addDays, todayISO } from '../domain/date';
import { useProjectMap, useTasker } from '../state/store';
import { useDebouncedValue } from '../state/hooks';
import { DEFAULT_FILTERS, FilterBar, type FilterState, type GroupKey } from '../components/FilterBar';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../components/TaskRow';
import type { TaskScope } from '../state/navigation';

interface TasksViewProps {
  title: string;
  subtitle?: string;
  scope: TaskScope;
  projectId?: string | null;
  place?: string | null;
  onOpenTask: (task: Task) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  quickAddInputRef?: Ref<HTMLInputElement>;
  focusTarget?: 'quickadd' | 'search' | null;
  onFocusHandled?: () => void;
}

const PRIORITY_GROUP_LABEL: Record<Priority, string> = {
  1: 'P1 · Urgent',
  2: 'P2 · High',
  3: 'P3 · Medium',
  4: 'P4 · None',
};

function sortTasks(tasks: Task[], sort: FilterState['sort']): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case 'date':
      return copy.sort((a, b) => {
        if (a.date === b.date) {
          if (a.time === b.time) return a.priority - b.priority;
          if (!a.time) return 1;
          if (!b.time) return -1;
          return a.time < b.time ? -1 : 1;
        }
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? -1 : 1;
      });
    case 'priority':
      return copy.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const aDate = a.date ?? '9999-12-31';
        const bDate = b.date ?? '9999-12-31';
        if (aDate === bDate) return 0;
        return aDate < bDate ? -1 : 1;
      });
    case 'created':
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case 'alpha':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'manual':
    default:
      return copy.sort((a, b) => a.order - b.order);
  }
}

export function TasksView({
  title,
  subtitle,
  scope,
  projectId,
  place,
  onOpenTask,
  searchInputRef,
  quickAddInputRef,
  focusTarget,
  onFocusHandled,
}: TasksViewProps) {
  const { tasks, projects } = useTasker();
  const projectMap = useProjectMap();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.search, 220);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickRef = useRef<HTMLInputElement>(null);

  // The shell asks the view to focus a field after a shortcut or button press.
  useEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget === 'search' ? searchRef : quickRef;
    target.current?.focus();
    onFocusHandled?.();
  }, [focusTarget, onFocusHandled]);

  const scoped = useMemo(() => {
    const today = todayISO();
    switch (scope) {
      case 'today':
        return tasks.filter((task) => task.date === today);
      case 'upcoming':
        return tasks.filter((task) => task.date !== null && task.date > today);
      case 'inbox':
        return tasks.filter((task) => task.projectId === null);
      case 'completed':
        return tasks.filter((task) => task.completed);
      case 'project':
        return tasks.filter((task) => task.projectId === projectId);
      case 'place':
        return tasks.filter((task) => (task.place ?? '') === (place ?? ''));
      case 'all':
      default:
        return tasks;
    }
  }, [tasks, scope, projectId, place]);

  const visible = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    const filtered = scoped.filter((task) => {
      if (!filters.showCompleted && scope !== 'completed' && task.completed) return false;
      if (scope === 'completed' && !task.completed) return false;
      if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
      if (!needle) return true;
      const project = task.projectId ? projectMap.get(task.projectId)?.name ?? '' : '';
      return `${task.title} ${task.notes} ${task.place ?? ''} ${project} ${task.tags.join(' ')} ${task.lane}`
        .toLowerCase()
        .includes(needle);
    });
    return sortTasks(filtered, filters.sort);
  }, [scoped, filters, debouncedSearch, projectMap, scope]);

  const groups = useMemo(() => groupTasks(visible, filters.groupBy, projectMap), [visible, filters.groupBy, projectMap]);

  const defaultProjectId = scope === 'project' ? projectId ?? null : null;

  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">{title}</h1>
          <p className="view__subtitle">
            {subtitle ?? `${visible.length} task${visible.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </header>

      {scope !== 'completed' && (
        <QuickAdd
          projectId={defaultProjectId}
          inputRef={quickAddInputRef ?? quickRef}
          placeholder={
            scope === 'project'
              ? `Add to ${projects.find((p) => p.id === projectId)?.name ?? 'project'}…`
              : undefined
          }
        />
      )}

      <FilterBar filters={filters} onChange={setFilters} resultCount={visible.length} inputRef={searchInputRef ?? searchRef} />

      {visible.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Nothing here yet</p>
          <p className="empty__hint">
            {scope === 'completed'
              ? 'Completed tasks will appear here.'
              : 'Add a task above — try “Ship the release #Tasker tomorrow !1 @desk”.'}
          </p>
        </div>
      ) : (
        <div className="groups">
          {groups.map((group) => (
            <section className="group" key={group.key}>
              {filters.groupBy !== 'none' && (
                <header className="group__header">
                  <span className="group__title">{group.label}</span>
                  <span className="group__count">{group.tasks.length}</span>
                </header>
              )}
              <ul className="task-list">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} onOpen={onOpenTask} showProject={scope !== 'project'} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

interface TaskGroup {
  key: string;
  label: string;
  tasks: Task[];
}

function groupTasks(tasks: Task[], groupBy: GroupKey, projectMap: Map<string, { name: string; color: string }>): TaskGroup[] {
  if (groupBy === 'none') return [{ key: 'all', label: 'All tasks', tasks }];

  const buckets = new Map<string, TaskGroup>();
  const today = todayISO();
  const weekEnd = addDays(today, 7);

  const push = (key: string, label: string, task: Task) => {
    const existing = buckets.get(key) ?? { key, label, tasks: [] };
    existing.tasks.push(task);
    buckets.set(key, existing);
  };

  for (const task of tasks) {
    switch (groupBy) {
      case 'date': {
        if (!task.date) push('nodate', 'No date', task);
        else if (task.date < today) push('overdue', 'Overdue', task);
        else if (task.date === today) push('today', 'Today', task);
        else if (task.date === addDays(today, 1)) push('tomorrow', 'Tomorrow', task);
        else if (task.date <= weekEnd) push('week', 'This week', task);
        else push('later', 'Later', task);
        break;
      }
      case 'project': {
        if (!task.projectId) push('inbox', 'Inbox', task);
        else push(task.projectId, projectMap.get(task.projectId)?.name ?? 'Project', task);
        break;
      }
      case 'priority':
        push(`p${task.priority}`, PRIORITY_GROUP_LABEL[task.priority], task);
        break;
      case 'place':
        push(task.place ?? 'none', task.place ? `@${task.place}` : 'No place', task);
        break;
      case 'lane':
        push(task.lane || 'none', task.lane || 'No lane', task);
        break;
    }
  }

  const ORDER = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate', 'inbox'];
  const list = [...buckets.values()];
  if (groupBy === 'date') {
    return list.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  }
  if (groupBy === 'priority') {
    return list.sort((a, b) => a.key.localeCompare(b.key));
  }
  return list.sort((a, b) => a.label.localeCompare(b.label));
}
