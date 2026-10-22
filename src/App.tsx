/**
 * Tasker application shell.
 *
 * Owns navigation, keyboard shortcuts, the responsive layout (desktop rail +
 * side panel vs. mobile tab bar + bottom sheets) and the in-app user manual.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { BottomSheet } from './components/BottomSheet';
import { QuickAdd } from './components/QuickAdd';
import { TaskDetail } from './components/TaskDetail';
import { TasksView } from './views/TasksView';
import { CalendarView } from './views/CalendarView';
import { RoadmapView } from './views/RoadmapView';
import { SettingsView } from './views/SettingsView';
import { UserManual } from './docs/UserManual';
import { INITIAL_SELECTION, type NavSelection, type ViewKey } from './state/navigation';
import { useTasker, PROJECT_COLORS } from './state/store';
import { useInterval, useMediaQuery } from './state/hooks';
import { buildReminders } from './notifications/push';
import { relativeDayLabel, todayISO } from './domain/date';
import type { Task } from './domain/types';

type FocusTarget = 'quickadd' | 'search' | null;

const TAB_LABELS: Record<ViewKey, string> = {
  tasks: 'Tasks',
  calendar: 'Calendar',
  roadmap: 'Roadmap',
  settings: 'More',
};

const TAB_ICONS: Record<ViewKey, string> = {
  tasks: '☰',
  calendar: '▦',
  roadmap: '⌁',
  settings: '⚙',
};

export function App() {
  const { ready, tasks, projects, settings, updateSettings, updateTask, createProject, updateProject, deleteProject } =
    useTasker();
  const isMobile = useMediaQuery('(max-width: 860px)');

  const [selection, setSelection] = useState<NavSelection>(INITIAL_SELECTION);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const [mobileCreateOpen, setMobileCreateOpen] = useState(false);

  const openTask = useMemo(
    () => (openTaskId ? tasks.find((task) => task.id === openTaskId) ?? null : null),
    [openTaskId, tasks],
  );

  // Theme is a data attribute on <html>; all colours come from CSS variables.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Close the detail panel if the underlying task disappears.
  useEffect(() => {
    if (openTaskId && ready && !tasks.some((task) => task.id === openTaskId)) setOpenTaskId(null);
  }, [openTaskId, ready, tasks]);

  const requestFocus = useCallback((target: Exclude<FocusTarget, null>) => {
    setSelection((prev) =>
      prev.view === 'tasks' && (target !== 'quickadd' || prev.scope !== 'completed')
        ? prev
        : { ...prev, view: 'tasks', scope: 'all', projectId: null, place: null },
    );
    setFocusTarget(target);
  }, []);

  const navigate = useCallback((next: NavSelection) => {
    setSelection(next);
    setOpenTaskId(null);
  }, []);

  const onOpenTask = useCallback((task: Task) => setOpenTaskId(task.id), []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'k') {
          event.preventDefault();
          requestFocus('search');
        }
        return;
      }

      if (event.key === 'Escape') {
        setManualOpen(false);
        setOpenTaskId(null);
        setMobileCreateOpen(false);
        return;
      }

      if (isTyping(event.target)) return;
      if (event.altKey) return;

      switch (event.key) {
        case 'n':
          event.preventDefault();
          requestFocus('quickadd');
          break;
        case '/':
          event.preventDefault();
          requestFocus('search');
          break;
        case '1':
          setSelection({ view: 'tasks', scope: 'all', projectId: null, place: null });
          break;
        case '2':
          setSelection((prev) => ({ ...prev, view: 'calendar' }));
          break;
        case '3':
          setSelection((prev) => ({ ...prev, view: 'roadmap' }));
          break;
        case '4':
          setSelection((prev) => ({ ...prev, view: 'settings' }));
          break;
        case 't':
          setSelection({ view: 'tasks', scope: 'today', projectId: null, place: null });
          break;
        case '?':
          setManualOpen((open) => !open);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestFocus]);

  // ── Foreground reminder watcher ───────────────────────────────────────────
  // The Vercel cron covers the closed-app case; this covers the open-tab case
  // so reminders are never late while the user is looking at the app.
  useInterval(
    () => {
      if (!settings.notificationsEnabled || !('serviceWorker' in navigator)) return;
      const now = Date.now();
      const due = buildReminders(tasks, settings).filter(
        (reminder) => reminder.timestamp <= now && now - reminder.timestamp < 120_000,
      );
      if (due.length === 0) return;

      void navigator.serviceWorker.ready.then((registration) => {
        for (const reminder of due) {
          void registration.showNotification(reminder.title, {
            body: reminder.body,
            tag: reminder.taskId,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
          });
          updateTask(reminder.taskId, { reminded: true });
        }
      });
    },
    ready && settings.notificationsEnabled ? 30_000 : null,
  );

  function handleCreateProject() {
    const name = window.prompt('Project name');
    if (!name?.trim()) return;
    const project = createProject(name.trim());
    setSelection({ view: 'tasks', scope: 'project', projectId: project.id, place: null });
  }

  /** Rename / recolour / delete a project — prompt-driven and dependency-free. */
  function handleProjectMenu(project: (typeof projects)[number]) {
    const choice = window.prompt(
      `“${project.name}”\n\n1 — Rename\n2 — Change colour\n3 — Delete project\n\nEnter a number:`,
      '1',
    );
    if (choice === '1') {
      const name = window.prompt('New project name', project.name);
      if (name?.trim()) updateProject(project.id, { name: name.trim() });
    } else if (choice === '2') {
      const index = PROJECT_COLORS.indexOf(project.color);
      updateProject(project.id, { color: PROJECT_COLORS[(index + 1) % PROJECT_COLORS.length] });
    } else if (choice === '3') {
      if (window.confirm(`Delete “${project.name}”? Its tasks move to the Inbox.`)) {
        deleteProject(project.id);
        setSelection({ view: 'tasks', scope: 'all', projectId: null, place: null });
      }
    }
  }

  const viewTitle = useMemo(() => {
    switch (selection.scope) {
      case 'today':
        return 'Today';
      case 'upcoming':
        return 'Upcoming';
      case 'inbox':
        return 'Inbox';
      case 'completed':
        return 'Completed';
      case 'project':
        return projects.find((project) => project.id === selection.projectId)?.name ?? 'Project';
      case 'place':
        return `@${selection.place}`;
      case 'all':
      default:
        return 'All tasks';
    }
  }, [selection, projects]);

  const detailBody = openTask ? <TaskDetail task={openTask} onClose={() => setOpenTaskId(null)} /> : null;

  if (!ready) {
    return (
      <div className="boot">
        <span className="brand__mark brand__mark--lg">T</span>
        <p>Loading your tasks…</p>
      </div>
    );
  }

  return (
    <div className={`app${isMobile ? ' app--mobile' : ' app--desktop'}`}>
      <TopBar
        theme={settings.theme}
        onToggleTheme={() =>
          updateSettings({ theme: settings.theme === 'nordic-light' ? 'nordic-dark' : 'nordic-light' })
        }
        onFocusSearch={() => requestFocus('search')}
        onFocusQuickAdd={() => requestFocus('quickadd')}
        onOpenManual={() => setManualOpen(true)}
      />

      <div className="app__body">
        {!isMobile && (
          <Sidebar
            selection={selection}
            onSelect={navigate}
            onCreateProject={handleCreateProject}
            onProjectMenu={handleProjectMenu}
            onOpenManual={() => setManualOpen(true)}
          />
        )}

        <main className="workspace">
          {selection.view === 'tasks' && (
            <TasksView
              title={viewTitle}
              subtitle={selection.scope === 'today' ? `Due ${relativeDayLabel(todayISO()).toLowerCase()}` : undefined}
              scope={selection.scope}
              projectId={selection.projectId}
              place={selection.place}
              onOpenTask={onOpenTask}
              focusTarget={focusTarget}
              onFocusHandled={() => setFocusTarget(null)}
            />
          )}
          {selection.view === 'calendar' && <CalendarView onOpenTask={onOpenTask} />}
          {selection.view === 'roadmap' && <RoadmapView onOpenTask={onOpenTask} />}
          {selection.view === 'settings' && <SettingsView onOpenManual={() => setManualOpen(true)} />}
        </main>

        {!isMobile && detailBody && (
          <aside className="panel" aria-label="Task details">
            <div className="panel__header">
              <span className="panel__title">Task details</span>
              <button type="button" className="icon-button" onClick={() => setOpenTaskId(null)} aria-label="Close panel">
                ✕
              </button>
            </div>
            <div className="panel__body">{detailBody}</div>
          </aside>
        )}
      </div>

      {isMobile && (
        <>
          <button type="button" className="fab" onClick={() => setMobileCreateOpen(true)} aria-label="Add task">
            ＋
          </button>

          <nav className="tabbar" aria-label="Views">
            {(['tasks', 'calendar', 'roadmap', 'settings'] as ViewKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`tabbar__item${selection.view === key ? ' tabbar__item--active' : ''}`}
                onClick={() => setSelection((prev) => ({ ...prev, view: key }))}
              >
                <span className="tabbar__icon" aria-hidden="true">
                  {TAB_ICONS[key]}
                </span>
                {TAB_LABELS[key]}
              </button>
            ))}
          </nav>
        </>
      )}

      {isMobile && (
        <BottomSheet
          open={mobileCreateOpen}
          title="New task"
          onClose={() => setMobileCreateOpen(false)}
          accent={settings.theme === 'nordic-dark' ? '#8FA8BE' : '#263BAA'}
        >
          <div className="sheet-create">
            <QuickAddCapture onCreated={() => setMobileCreateOpen(false)} />
            <p className="muted">
              Tip: type <code>@place</code>, <code>!1</code> and <code>#Project</code> to set metadata
              as you write.
            </p>
          </div>
        </BottomSheet>
      )}

      {isMobile ? (
        <BottomSheet open={!!detailBody} title="Task details" onClose={() => setOpenTaskId(null)}>
          {detailBody}
        </BottomSheet>
      ) : null}

      {isMobile ? (
        <BottomSheet open={manualOpen} title="User manual" onClose={() => setManualOpen(false)}>
          <UserManual />
        </BottomSheet>
      ) : (
        manualOpen && (
          <div className="modal-backdrop" onClick={() => setManualOpen(false)} role="presentation">
            <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="User manual">
              <header className="modal__header">
                <span className="modal__title">User manual</span>
                <button type="button" className="icon-button" onClick={() => setManualOpen(false)} aria-label="Close manual">
                  ✕
                </button>
              </header>
              <div className="modal__body">
                <UserManual />
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/**
 * The mobile create sheet needs the quick-add field mounted inside the sheet
 * and focused straight away, so it gets its own tiny wrapper.
 */
function QuickAddCapture({ onCreated }: { onCreated: () => void }) {
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCreated();
      }}
    >
      <QuickAdd autoFocus />
    </div>
  );
}
