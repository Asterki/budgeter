/**
 * Desktop navigation rail.
 *
 * Smart lists on top, then the category -> project tree, then places. The tree
 * collapses per category so a large workspace stays scannable.
 */

import { useMemo, useState } from 'react';
import type { Category, Project } from '../domain/types';
import type { NavSelection } from '../state/navigation';
import { todayISO } from '../domain/date';
import { useTasker } from '../state/store';

interface SidebarProps {
  selection: NavSelection;
  onSelect: (selection: NavSelection) => void;
  onCreateCategory: () => void;
  onCreateProject: (categoryId: string | null) => void;
  onCategoryMenu: (category: Category) => void;
  onProjectMenu: (project: Project) => void;
  onOpenManual: () => void;
}

export function Sidebar({
  selection,
  onSelect,
  onCreateCategory,
  onCreateProject,
  onCategoryMenu,
  onProjectMenu,
  onOpenManual,
}: SidebarProps) {
  const { tasks, categories, projects, places } = useTasker();
  const today = todayISO();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const open = tasks.filter((task) => !task.completed);
    const byProject = new Map<string, number>();
    const byCategory = new Map<string, number>();
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const byPlace = new Map<string, number>();
    const progressByProject = new Map<string, { done: number; total: number }>();

    for (const task of tasks) {
      if (!task.projectId) continue;
      const bucket = progressByProject.get(task.projectId) ?? { done: 0, total: 0 };
      bucket.total += 1;
      if (task.completed) bucket.done += 1;
      progressByProject.set(task.projectId, bucket);
    }

    for (const task of open) {
      if (task.projectId) {
        byProject.set(task.projectId, (byProject.get(task.projectId) ?? 0) + 1);
        const categoryId = projectById.get(task.projectId)?.categoryId;
        if (categoryId) byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + 1);
      }
      if (task.place) byPlace.set(task.place, (byPlace.get(task.place) ?? 0) + 1);
    }

    return {
      scheduled: open.filter((task) => task.date).length,
      today: open.filter((task) => task.date === today).length,
      inbox: open.filter((task) => !task.projectId).length,
      all: open.length,
      completed: tasks.filter((task) => task.completed).length,
      byProject,
      byCategory,
      byPlace,
      progressByProject,
    };
  }, [tasks, projects, today]);

  const isScope = (scope: NavSelection['scope']) =>
    selection.view === 'tasks' && selection.scope === scope;

  const select = (scope: NavSelection['scope'], extra: Partial<NavSelection> = {}) =>
    onSelect({ view: 'tasks', scope, projectId: null, categoryId: null, place: null, ...extra });

  function toggleCategory(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const uncategorised = projects.filter((project) => !project.categoryId);

  function renderProject(project: Project) {
    const active = isScope('project') && selection.projectId === project.id;
    const ratio = stats.progressByProject.get(project.id);
    const percent = ratio && ratio.total > 0 ? Math.round((ratio.done / ratio.total) * 100) : 0;
    return (
      <div className="rail__row" key={project.id}>
        <button
          type="button"
          className={`rail__item rail__item--nested${active ? ' rail__item--active' : ''}`}
          onClick={() => select('project', { projectId: project.id })}
        >
          <span className="dot" style={{ background: project.color }} />
          <span className="rail__label">{project.name}</span>
          <span className="rail__count">{stats.byProject.get(project.id) ?? 0}</span>
        </button>
        {ratio && ratio.total > 0 && (
          <span
            className="rail__progress"
            title={`${ratio.done} of ${ratio.total} done`}
            aria-hidden="true"
          >
            <span style={{ width: `${percent}%` }} />
          </span>
        )}
        <button
          type="button"
          className="rail__more"
          onClick={() => onProjectMenu(project)}
          aria-label={`Manage project ${project.name}`}
        >
          ⋯
        </button>
      </div>
    );
  }

  return (
    <aside className="rail" aria-label="Primary navigation">
      <nav className="rail__group">
        <span className="rail__heading">Smart lists</span>
        <button
          type="button"
          className={`rail__item${isScope('scheduled') ? ' rail__item--active' : ''}`}
          onClick={() => select('scheduled')}
        >
          <span className="rail__glyph">▦</span> Scheduled
          <span className="rail__count">{stats.scheduled}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('today') ? ' rail__item--active' : ''}`}
          onClick={() => select('today')}
        >
          <span className="rail__glyph">★</span> Today
          <span className="rail__count">{stats.today}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('inbox') ? ' rail__item--active' : ''}`}
          onClick={() => select('inbox')}
        >
          <span className="rail__glyph">▤</span> Inbox
          <span className="rail__count">{stats.inbox}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('all') ? ' rail__item--active' : ''}`}
          onClick={() => select('all')}
        >
          <span className="rail__glyph">≡</span> All tasks
          <span className="rail__count">{stats.all}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('completed') ? ' rail__item--active' : ''}`}
          onClick={() => select('completed')}
        >
          <span className="rail__glyph">✓</span> Completed
          <span className="rail__count">{stats.completed}</span>
        </button>
      </nav>

      <nav className="rail__group">
        <span className="rail__heading">
          Categories
          <button
            type="button"
            className="rail__add"
            onClick={onCreateCategory}
            aria-label="New category"
            title="New category"
          >
            ＋
          </button>
        </span>

        {categories.length === 0 && uncategorised.length === 0 && (
          <p className="rail__empty">Group projects into categories like “Work”.</p>
        )}

        {categories.map((category) => {
          const owned = projects.filter((project) => project.categoryId === category.id);
          const isCollapsed = collapsed.has(category.id);
          const active = isScope('category') && selection.categoryId === category.id;

          return (
            <div className="rail__category" key={category.id}>
              <div className="rail__row">
                <button
                  type="button"
                  className={`rail__item rail__item--category${active ? ' rail__item--active' : ''}`}
                  onClick={() => select('category', { categoryId: category.id })}
                >
                  <span
                    className="rail__caret"
                    role="presentation"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCategory(category.id);
                    }}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="dot" style={{ background: category.color }} />
                  <span className="rail__label">{category.name}</span>
                  <span className="rail__count">{stats.byCategory.get(category.id) ?? 0}</span>
                </button>
                <button
                  type="button"
                  className="rail__more"
                  onClick={() => onCategoryMenu(category)}
                  aria-label={`Manage category ${category.name}`}
                >
                  ⋯
                </button>
              </div>

              {!isCollapsed && (
                <>
                  {owned.map(renderProject)}
                  <button
                    type="button"
                    className="rail__item rail__item--nested rail__item--ghost"
                    onClick={() => onCreateProject(category.id)}
                  >
                    <span className="rail__glyph">＋</span>
                    <span className="rail__label">New project</span>
                  </button>
                </>
              )}
            </div>
          );
        })}

        {uncategorised.length > 0 && (
          <div className="rail__category">
            <div className="rail__row">
              <button
                type="button"
                className={`rail__item rail__item--category${
                  isScope('category') && selection.categoryId === null ? ' rail__item--active' : ''
                }`}
                onClick={() => select('category', { categoryId: null })}
              >
                <span
                  className="rail__caret"
                  role="presentation"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleCategory('__none__');
                  }}
                >
                  {collapsed.has('__none__') ? '▸' : '▾'}
                </span>
                <span className="rail__label">Uncategorised</span>
                <span className="rail__count">{uncategorised.length}</span>
              </button>
            </div>
            {!collapsed.has('__none__') && (
              <>
                {uncategorised.map(renderProject)}
                <button
                  type="button"
                  className="rail__item rail__item--nested rail__item--ghost"
                  onClick={() => onCreateProject(null)}
                >
                  <span className="rail__glyph">＋</span>
                  <span className="rail__label">New project</span>
                </button>
              </>
            )}
          </div>
        )}

        {(categories.length > 0 || uncategorised.length === 0) && (
          <button type="button" className="rail__item rail__item--ghost" onClick={() => onCreateProject(null)}>
            <span className="rail__glyph">＋</span>
            <span className="rail__label">New project</span>
          </button>
        )}
      </nav>

      {places.length > 0 && (
        <nav className="rail__group">
          <span className="rail__heading">Places</span>
          {places.map((place) => (
            <button
              key={place.id}
              type="button"
              className={`rail__item${
                isScope('place') && selection.place === place.name ? ' rail__item--active' : ''
              }`}
              onClick={() => select('place', { place: place.name })}
            >
              <span className="rail__glyph">@</span>
              <span className="rail__label">{place.name}</span>
              <span className="rail__count">{stats.byPlace.get(place.name) ?? 0}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="rail__footer">
        <button
          type="button"
          className={`rail__item${selection.view === 'settings' ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ ...selection, view: 'settings', projectId: null, categoryId: null, place: null })}
        >
          <span className="rail__glyph">⚙</span> Settings
        </button>
        <button type="button" className="rail__item" onClick={onOpenManual}>
          <span className="rail__glyph">?</span> User manual
        </button>
        <span className="rail__status rail__status--on">Local-first · Offline ready</span>
      </div>
    </aside>
  );
}
