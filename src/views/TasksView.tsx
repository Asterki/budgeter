/**
 * Tasks view — a sortable, filterable, nestable list with debounced live search.
 *
 * The landing scope (`scheduled`) shows every dated task grouped by the day it
 * sits on, so the app opens with the whole plan rather than just today.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { Priority, Task } from '../domain/types';
import { formatDate, relativeDayLabel, todayISO } from '../domain/date';
import { useProjectMap, useTaskChildren, useTasker } from '../state/store';
import { useDebouncedValue } from '../state/hooks';
import { DEFAULT_FILTERS, FilterBar, type FilterState, type GroupKey } from '../components/FilterBar';
import { QuickAdd } from '../components/QuickAdd';
import { TaskTree } from '../components/TaskTree';
import type { TaskScope } from '../state/navigation';

interface TasksViewProps {
  title: string;
  subtitle?: string;
  scope: TaskScope;
  projectId?: string | null;
  categoryId?: string | null;
  place?: string | null;
  onOpenTask: (task: Task) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  quickAddInputRef?: Ref<HTMLInputElement>;
  focusTarget?: 'quickadd' | 'search' | null;
  onFocusHandled?: () => void;
  /** Landing view only, and only when a keyboard is welcome. */
  autoFocusQuickAdd?: boolean;
}

const PRIORITY_GROUP_LABEL: Record<Priority, string> = {
  1: 'P1 · Urgent',
  2: 'P2 · High',
  3: 'P3 · Medium',
  4: 'P4 · None',
};

function byDate(a: Task, b: Task): number {
  if (a.date === b.date) {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.time === b.time) return a.priority - b.priority;
    if (!a.time) return -1;
    if (!b.time) return 1;
    return a.time < b.time ? -1 : 1;
  }
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date < b.date ? -1 : 1;
}

function sortTasks(tasks: Task[], sort: FilterState['sort']): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case 'date':
      return copy.sort(byDate);
    case 'priority':
      return copy.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return byDate(a, b);
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

interface TaskGroup {
  key: string;
  label: string;
  /** Used to order the groups themselves. */
  sortKey: string;
  tasks: Task[];
}

export function TasksView({
  title,
  subtitle,
  scope,
  projectId,
  categoryId,
  place,
  onOpenTask,
  searchInputRef,
  quickAddInputRef,
  focusTarget,
  onFocusHandled,
  autoFocusQuickAdd,
}: TasksViewProps) {
  const { tasks, projects, categories, addTag } = useTasker();
  const projectMap = useProjectMap();
  const childrenMap = useTaskChildren();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(filters.search, 200);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickRef = useRef<HTMLInputElement>(null);

  // Reset per-project filters when the scope changes.
  useEffect(() => {
    setTagFilter(null);
  }, [projectId, scope, categoryId, place]);

  // The shell asks the view to focus a field after a shortcut or button press.
  useEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget === 'search' ? searchRef : quickRef;
    target.current?.focus();
    onFocusHandled?.();
  }, [focusTarget, onFocusHandled]);

  const project = scope === 'project' ? projectMap.get(projectId ?? '') ?? null : null;
  const category = scope === 'category' && categoryId ? categories.find((c) => c.id === categoryId) : null;
  const categoryProjectIds = useMemo(
    () =>
      scope === 'category'
        ? new Set(projects.filter((item) => item.categoryId === categoryId).map((item) => item.id))
        : null,
    [scope, projects, categoryId],
  );

  const scoped = useMemo(() => {
    const today = todayISO();
    switch (scope) {
      case 'scheduled':
        return tasks.filter((task) => !task.completed && task.date !== null);
      case 'today':
        return tasks.filter((task) => !task.completed && task.date === today);
      case 'upcoming':
        return tasks.filter((task) => !task.completed && task.date !== null && task.date > today);
      case 'inbox':
        return tasks.filter((task) => !task.completed && task.projectId === null && task.parentId === null);
      case 'completed':
        return tasks.filter((task) => task.completed);
      case 'project':
        return tasks.filter((task) => !task.completed && task.projectId === projectId);
      case 'category':
        return tasks.filter(
          (task) => !task.completed && task.projectId !== null && categoryProjectIds?.has(task.projectId),
        );
      case 'place':
        return tasks.filter((task) => !task.completed && (task.place ?? '') === (place ?? ''));
      case 'all':
      default:
        return tasks.filter((task) => !task.completed);
    }
  }, [tasks, scope, projectId, categoryId, place, categoryProjectIds]);

  const visible = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    const filtered = scoped.filter((task) => {
      if (scope !== 'completed' && !filters.showCompleted && task.completed) return false;
      if (scope === 'completed' && !task.completed) return false;
      if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
      if (tagFilter && !task.tags.includes(tagFilter)) return false;
      if (!needle) return true;
      const projectName = task.projectId ? projectMap.get(task.projectId)?.name ?? '' : '';
      return `${task.title} ${task.notes} ${task.place ?? ''} ${projectName} ${task.tags.join(' ')} ${task.lane}`
        .toLowerCase()
        .includes(needle);
    });
    return sortTasks(filtered, filters.sort);
  }, [scoped, filters, debouncedSearch, projectMap, scope, tagFilter]);

  // Only render roots; a task whose parent is also visible is nested under it.
  const roots = useMemo(() => {
    const ids = new Set(visible.map((task) => task.id));
    return visible.filter((task) => !task.parentId || !ids.has(task.parentId));
  }, [visible]);

  const groups = useMemo(
    () => groupTasks(roots, filters.groupBy, projectMap),
    [roots, filters.groupBy, projectMap],
  );

  const defaultProjectId = scope === 'project' ? projectId ?? null : null;

  return (
    <section className="view">
      <header className="view__header">
        <div>
          {project && <span className="view__eyebrow" style={{ color: project.color }} />}
          <h1 className="view__title">{title}</h1>
          <p className="view__subtitle">
            {subtitle ??
              `${visible.length} task${visible.length === 1 ? '' : 's'}${
                category ? ` · ${category.name}` : ''
              }`}
          </p>
        </div>
      </header>

      {scope !== 'completed' && (
        <QuickAdd
          projectId={defaultProjectId}
          autoFocus={autoFocusQuickAdd}
          inputRef={quickAddInputRef ?? quickRef}
          placeholder={
            project ? `Add to ${project.name}…` : 'Add a task anywhere — “Review PR @work tomorrow !1 #UNAH”'
          }
        />
      )}

      {project && project.tags.length > 0 && (
        <div className="tag-filter">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const name = window.prompt('New tag name');
              if (name?.trim()) addTag(project.id, name);
            }}
          >
            + tag
          </button>
          {project.tags.map((tag) => {
            const active = tagFilter === tag.name;
            return (
              <button
                key={tag.id}
                type="button"
                className={`chip chip--toggle${active ? ' chip--on' : ''}`}
                onClick={() => setTagFilter(active ? null : tag.name)}
                aria-pressed={active}
              >
                <span className="dot" style={{ background: tag.color }} />
                {tag.name}
              </button>
            );
          })}
        </div>
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
              <TaskTree
                tasks={group.tasks}
                childrenMap={childrenMap}
                onOpenTask={onOpenTask}
                showProject={scope !== 'project'}
              />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** Creates a tag on the current project without leaving the view. */
function groupTasks(
  tasks: Task[],
  groupBy: GroupKey,
  projectMap: Map<string, { name: string; color: string }>,
): TaskGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All tasks', sortKey: '', tasks }];
  }

  const buckets = new Map<string, TaskGroup>();

  const push = (key: string, label: string, sortKey: string, task: Task) => {
    const existing = buckets.get(key) ?? { key, label, sortKey, tasks: [] };
    existing.tasks.push(task);
    buckets.set(key, existing);
  };

  for (const task of tasks) {
    switch (groupBy) {
      case 'day': {
        if (!task.date) push('zz-nodate', 'No date', 'zz-nodate', task);
        else {
          const relative = relativeDayLabel(task.date);
          const label = relative === task.date ? formatDate(task.date) : relative;
          push(task.date, label, task.date, task);
        }
        break;
      }
      case 'project': {
        if (!task.projectId) push('zz-inbox', 'Inbox', 'zz-inbox', task);
        else push(task.projectId, projectMap.get(task.projectId)?.name ?? 'Project', '', task);
        break;
      }
      case 'priority':
        push(`p${task.priority}`, PRIORITY_GROUP_LABEL[task.priority], `p${task.priority}`, task);
        break;
      case 'place':
        push(task.place ?? 'zz-none', task.place ? `@${task.place}` : 'No place', '', task);
        break;
      case 'lane':
        push(task.lane || 'zz-none', task.lane || 'No lane', '', task);
        break;
    }
  }

  const list = [...buckets.values()];
  const isDated = groupBy === 'day';
  return list.sort((a, b) => {
    if (isDated) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    if (groupBy === 'priority') return a.sortKey.localeCompare(b.sortKey);
    return a.label.localeCompare(b.label);
  });
}
