/**
 * Desktop navigation rail: smart lists, projects, places and the footer.
 */

import { useMemo } from 'react';
import type { NavSelection } from '../state/navigation';
import type { Project } from '../domain/types';
import { todayISO } from '../domain/date';
import { useTasker } from '../state/store';

interface SidebarProps {
  selection: NavSelection;
  onSelect: (selection: NavSelection) => void;
  onCreateProject: () => void;
  onProjectMenu: (project: Project) => void;
  onOpenManual: () => void;
}

export function Sidebar({ selection, onSelect, onCreateProject, onProjectMenu, onOpenManual }: SidebarProps) {
  const { tasks, projects, places, settings } = useTasker();
  const today = todayISO();

  const counts = useMemo(() => {
    const open = tasks.filter((task) => !task.completed);
    return {
      inbox: open.filter((task) => !task.projectId).length,
      today: open.filter((task) => task.date === today).length,
      upcoming: open.filter((task) => task.date !== null && task.date > today).length,
      all: open.length,
      completed: tasks.filter((task) => task.completed).length,
      byProject: new Map(
        projects.map((project) => [project.id, open.filter((task) => task.projectId === project.id).length]),
      ),
      byPlace: new Map(
        places.map((place) => [place.name, open.filter((task) => task.place === place.name).length]),
      ),
    };
  }, [tasks, projects, places, today]);

  const isScope = (scope: NavSelection['scope']) =>
    selection.view === 'tasks' && selection.scope === scope;

  return (
    <aside className="rail" aria-label="Primary navigation">
      <nav className="rail__group">
        <span className="rail__heading">Smart lists</span>
        <button
          type="button"
          className={`rail__item${isScope('today') ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ view: 'tasks', scope: 'today', projectId: null, place: null })}
        >
          <span className="rail__glyph">★</span> Today
          <span className="rail__count">{counts.today}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('upcoming') ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ view: 'tasks', scope: 'upcoming', projectId: null, place: null })}
        >
          <span className="rail__glyph">↗</span> Upcoming
          <span className="rail__count">{counts.upcoming}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('inbox') ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ view: 'tasks', scope: 'inbox', projectId: null, place: null })}
        >
          <span className="rail__glyph">▤</span> Inbox
          <span className="rail__count">{counts.inbox}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('all') ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ view: 'tasks', scope: 'all', projectId: null, place: null })}
        >
          <span className="rail__glyph">≡</span> All tasks
          <span className="rail__count">{counts.all}</span>
        </button>
        <button
          type="button"
          className={`rail__item${isScope('completed') ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ view: 'tasks', scope: 'completed', projectId: null, place: null })}
        >
          <span className="rail__glyph">✓</span> Completed
          <span className="rail__count">{counts.completed}</span>
        </button>
      </nav>

      <nav className="rail__group">
        <span className="rail__heading">
          Projects
          <button type="button" className="rail__add" onClick={onCreateProject} aria-label="New project">
            ＋
          </button>
        </span>
        {projects.length === 0 && <p className="rail__empty">No projects yet.</p>}
        {projects.map((project) => (
          <div className="rail__row" key={project.id}>
            <button
              type="button"
              className={`rail__item${
                selection.view === 'tasks' && selection.scope === 'project' && selection.projectId === project.id
                  ? ' rail__item--active'
                  : ''
              }`}
              onClick={() => onSelect({ view: 'tasks', scope: 'project', projectId: project.id, place: null })}
            >
              <span className="dot" style={{ background: project.color }} />
              <span className="rail__label">{project.name}</span>
              <span className="rail__count">{counts.byProject.get(project.id) ?? 0}</span>
            </button>
            <button
              type="button"
              className="rail__more"
              onClick={() => onProjectMenu(project)}
              aria-label={`Manage project ${project.name}`}
            >
              ⋯
            </button>
          </div>
        ))}
      </nav>

      <nav className="rail__group">
        <span className="rail__heading">Places</span>
        {places.length === 0 && <p className="rail__empty">Add @place in any task.</p>}
        {places.map((place) => (
          <button
            key={place.id}
            type="button"
            className={`rail__item${
              selection.view === 'tasks' && selection.scope === 'place' && selection.place === place.name
                ? ' rail__item--active'
                : ''
            }`}
            onClick={() => onSelect({ view: 'tasks', scope: 'place', projectId: null, place: place.name })}
          >
            <span className="rail__glyph">@</span>
            <span className="rail__label">{place.name}</span>
            <span className="rail__count">{counts.byPlace.get(place.name) ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="rail__footer">
        <button
          type="button"
          className={`rail__item${selection.view === 'settings' ? ' rail__item--active' : ''}`}
          onClick={() => onSelect({ view: 'settings', scope: selection.scope, projectId: null, place: null })}
        >
          <span className="rail__glyph">⚙</span> Settings
        </button>
        <button type="button" className="rail__item" onClick={onOpenManual}>
          <span className="rail__glyph">?</span> User manual
        </button>
        <span className={`rail__status${settings.notificationsEnabled ? ' rail__status--on' : ''}`}>
          {settings.notificationsEnabled ? 'Notifications on' : 'Notifications off'}
        </span>
      </div>
    </aside>
  );
}
