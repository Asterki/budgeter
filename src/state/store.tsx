/**
 * Application state.
 *
 * A single React context owns every domain collection. Every mutation is
 * written through to IndexedDB immediately, so the app is durable by default
 * and can be closed at any moment without losing work.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clearAll, createId, db, loadSnapshot } from '../db/database';
import type {
  BackupFile,
  Place,
  Priority,
  Project,
  PushSubscriptionRecord,
  RecurrenceRule,
  Settings,
  Tag,
  Task,
} from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/types';
import { isExhausted, nextOccurrence } from '../domain/recurrence';
import { syncReminders } from '../notifications/push';

export const PROJECT_COLORS = [
  '#263BAA', '#6E839A', '#4C8C8C', '#8C6E9E', '#B06A4F',
  '#5A7D9A', '#3F7A5E', '#9E7B3F', '#7A6C8C', '#A14F5A',
];

const BACKUP_VERSION = 1;

export interface NewTaskInput {
  title: string;
  projectId?: string | null;
  projectName?: string | null;
  place?: string | null;
  priority?: Priority;
  date?: string | null;
  time?: string | null;
  duration?: number;
  allDay?: boolean;
  notes?: string;
  tags?: string[];
  lane?: string;
  recurrence?: RecurrenceRule | null;
}

interface TaskerContextValue {
  ready: boolean;
  tasks: Task[];
  projects: Project[];
  places: Place[];
  subscriptions: PushSubscriptionRecord[];
  settings: Settings;

  createTask: (input: NewTaskInput) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleComplete: (id: string) => void;
  duplicateTask: (id: string) => void;
  reorderTask: (id: string, direction: -1 | 1) => void;

  createProject: (name: string, color?: string) => Project;
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void;
  deleteProject: (id: string) => void;
  addTag: (projectId: string, name: string, color?: string) => void;
  removeTag: (projectId: string, tagId: string) => void;

  ensurePlace: (name: string) => Promise<Place>;
  deletePlace: (id: string) => void;

  updateSettings: (patch: Partial<Settings>) => void;
  saveSubscription: (record: PushSubscriptionRecord) => void;
  removeSubscription: (id: string) => void;

  buildBackup: () => BackupFile;
  restoreBackup: (backup: BackupFile) => Promise<void>;
  resetEverything: () => Promise<void>;
}

const TaskerContext = createContext<TaskerContextValue | null>(null);

function nextOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), 0) + 1;
}

export function TaskerProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Refs mirror state so callbacks can read the latest values without being
  // re-created (and without stale closures).
  const tasksRef = useRef(tasks);
  const projectsRef = useRef(projects);
  const placesRef = useRef(places);
  const settingsRef = useRef(settings);
  tasksRef.current = tasks;
  projectsRef.current = projects;
  placesRef.current = places;
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    loadSnapshot().then((snapshot) => {
      if (cancelled) return;
      setTasks(snapshot.tasks);
      setProjects(snapshot.projects.sort((a, b) => a.order - b.order));
      setPlaces(snapshot.places);
      setSubscriptions(snapshot.subscriptions);
      setSettings(snapshot.settings);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the serverless reminder mirror up to date (debounced).
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void syncReminders(tasksRef.current, settingsRef.current);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [ready, tasks, settings]);

  const createProject = useCallback((name: string, color?: string): Project => {
    const project: Project = {
      id: createId('prj'),
      name: name.trim(),
      color: color ?? PROJECT_COLORS[projectsRef.current.length % PROJECT_COLORS.length],
      tags: [],
      order: nextOrder(projectsRef.current),
      createdAt: Date.now(),
    };
    setProjects((prev) => [...prev, project]);
    void db.projects.put(project);
    return project;
  }, []);

  const ensureProjectByName = useCallback(
    (name: string): Project | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = projectsRef.current.find(
        (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) return existing;
      return createProject(trimmed);
    },
    [createProject],
  );

  const ensurePlace = useCallback(async (name: string): Promise<Place> => {
    const trimmed = name.trim();
    const existing = placesRef.current.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const place: Place = { id: createId('plc'), name: trimmed, createdAt: Date.now() };
    setPlaces((prev) => [...prev, place]);
    await db.places.put(place);
    return place;
  }, []);

  const createTask = useCallback(
    async (input: NewTaskInput): Promise<Task> => {
      let projectId = input.projectId ?? null;
      if (!projectId && input.projectName) {
        projectId = ensureProjectByName(input.projectName)?.id ?? null;
      }
      if (!projectId) projectId = settingsRef.current.defaultProjectId;

      const allDay = input.allDay ?? !input.time;
      const now = Date.now();
      const task: Task = {
        id: createId('tsk'),
        title: input.title.trim() || 'Untitled task',
        notes: input.notes ?? '',
        projectId,
        place: input.place ?? null,
        priority: input.priority ?? 4,
        date: input.date ?? null,
        time: allDay ? null : input.time ?? null,
        allDay,
        duration: input.duration ?? 0,
        tags: input.tags ?? [],
        lane: input.lane ?? '',
        recurrence: input.recurrence ?? null,
        completed: false,
        completedAt: null,
        reminded: false,
        seriesId: createId('ser'),
        order: nextOrder(tasksRef.current),
        createdAt: now,
        updatedAt: now,
      };

      setTasks((prev) => [...prev, task]);
      await db.tasks.put(task);
      if (task.place) await ensurePlace(task.place);
      return task;
    },
    [ensureProjectByName, ensurePlace],
  );

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => {
      const next = prev.map((task) =>
        task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task,
      );
      const updated = next.find((task) => task.id === id);
      if (updated) void db.tasks.put(updated);
      return next;
    });
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id));
    void db.tasks.remove(id);
  }, []);

  const toggleComplete = useCallback(
    (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;

      if (task.completed) {
        updateTask(id, { completed: false, completedAt: null, reminded: false });
        return;
      }

      if (task.recurrence && task.date) {
        // Recurring task: archive this occurrence and schedule the next one.
        const occurrences = tasksRef.current.filter((t) => t.seriesId === task.seriesId).length;
        const nextDate = nextOccurrence(task.recurrence, task.date);
        updateTask(id, { completed: true, completedAt: Date.now() });

        if (!isExhausted(task.recurrence, nextDate, occurrences)) {
          const next: Task = {
            ...task,
            id: createId('tsk'),
            date: nextDate,
            completed: false,
            completedAt: null,
            reminded: false,
            order: nextOrder(tasksRef.current),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setTasks((prev) => [...prev, next]);
          void db.tasks.put(next);
        }
        return;
      }

      updateTask(id, { completed: true, completedAt: Date.now() });
    },
    [updateTask],
  );

  const duplicateTask = useCallback(
    (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;
      const copy: Task = {
        ...task,
        id: createId('tsk'),
        title: `${task.title} (copy)`,
        completed: false,
        completedAt: null,
        reminded: false,
        seriesId: createId('ser'),
        order: nextOrder(tasksRef.current),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setTasks((prev) => [...prev, copy]);
      void db.tasks.put(copy);
    },
    [],
  );

  const reorderTask = useCallback((id: string, direction: -1 | 1) => {
    setTasks((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((t) => t.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= sorted.length) return prev;
      const a = sorted[index];
      const b = sorted[target];
      const aOrder = a.order;
      const next = prev.map((task) => {
        if (task.id === a.id) return { ...task, order: b.order };
        if (task.id === b.id) return { ...task, order: aOrder };
        return task;
      });
      next.forEach((task) => {
        if (task.id === a.id || task.id === b.id) void db.tasks.put(task);
      });
      return next;
    });
  }, []);

  const updateProject = useCallback((id: string, patch: Partial<Omit<Project, 'id'>>) => {
    setProjects((prev) => {
      const next = prev.map((project) => (project.id === id ? { ...project, ...patch } : project));
      const updated = next.find((project) => project.id === id);
      if (updated) void db.projects.put(updated);
      return next;
    });
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((project) => project.id !== id));
    void db.projects.remove(id);
    setTasks((prev) => {
      const next = prev.map((task) =>
        task.projectId === id ? { ...task, projectId: null, tags: [] } : task,
      );
      next.filter((task) => task.projectId === null).forEach((task) => void db.tasks.put(task));
      return next;
    });
  }, []);

  const addTag = useCallback((projectId: string, name: string, color?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjects((prev) => {
      const next = prev.map((project) => {
        if (project.id !== projectId) return project;
        if (project.tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())) return project;
        const tag: Tag = {
          id: createId('tag'),
          name: trimmed,
          color: color ?? PROJECT_COLORS[project.tags.length % PROJECT_COLORS.length],
        };
        return { ...project, tags: [...project.tags, tag] };
      });
      const updated = next.find((project) => project.id === projectId);
      if (updated) void db.projects.put(updated);
      return next;
    });
  }, []);

  const removeTag = useCallback((projectId: string, tagId: string) => {
    setProjects((prev) => {
      const next = prev.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          tags: project.tags.filter((t) => t.id !== tagId),
        };
      });
      const updated = next.find((project) => project.id === projectId);
      if (updated) void db.projects.put(updated);

      // Detach the tag from any task in this project that used it.
      const removed = prev
        .find((project) => project.id === projectId)
        ?.tags.find((tag) => tag.id === tagId);
      if (removed) {
        setTasks((current) => {
          const affected = current.filter(
            (task) => task.projectId === projectId && task.tags.includes(removed.name),
          );
          if (affected.length === 0) return current;
          const patched = current.map((task) =>
            affected.some((item) => item.id === task.id)
              ? { ...task, tags: task.tags.filter((name) => name !== removed.name), updatedAt: Date.now() }
              : task,
          );
          patched
            .filter((task) => affected.some((item) => item.id === task.id))
            .forEach((task) => void db.tasks.put(task));
          return patched;
        });
      }
      return next;
    });
  }, []);

  const deletePlace = useCallback((id: string) => {
    setPlaces((prev) => prev.filter((place) => place.id !== id));
    void db.places.remove(id);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void db.settings.put(next);
      return next;
    });
  }, []);

  const saveSubscription = useCallback((record: PushSubscriptionRecord) => {
    setSubscriptions((prev) => {
      const next = [...prev.filter((sub) => sub.id !== record.id), record];
      void db.subscriptions.put(record);
      return next;
    });
  }, []);

  const removeSubscription = useCallback((id: string) => {
    setSubscriptions((prev) => prev.filter((sub) => sub.id !== id));
    void db.subscriptions.remove(id);
  }, []);

  const buildBackup = useCallback(
    (): BackupFile => ({
      app: 'tasker',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      projects: projectsRef.current,
      places: placesRef.current,
      tasks: tasksRef.current,
      settings: settingsRef.current,
      subscriptions: [],
    }),
    [],
  );

  const restoreBackup = useCallback(async (backup: BackupFile) => {
    if (!backup || backup.app !== 'tasker' || !Array.isArray(backup.tasks)) {
      throw new Error('This file is not a Tasker backup.');
    }
    await clearAll();

    const restoredProjects = backup.projects ?? [];
    const restoredPlaces = backup.places ?? [];
    const restoredTasks = backup.tasks ?? [];
    const restoredSettings = { ...DEFAULT_SETTINGS, ...(backup.settings ?? {}) };

    await db.projects.putMany(restoredProjects);
    await db.places.putMany(restoredPlaces);
    await db.tasks.putMany(restoredTasks);
    await db.settings.put(restoredSettings);

    setProjects(restoredProjects);
    setPlaces(restoredPlaces);
    setTasks(restoredTasks);
    setSubscriptions([]);
    setSettings(restoredSettings);
  }, []);

  const resetEverything = useCallback(async () => {
    await clearAll();
    setProjects([]);
    setPlaces([]);
    setTasks([]);
    setSubscriptions([]);
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const value = useMemo<TaskerContextValue>(
    () => ({
      ready,
      tasks,
      projects,
      places,
      subscriptions,
      settings,
      createTask,
      updateTask,
      deleteTask,
      toggleComplete,
      duplicateTask,
      reorderTask,
      createProject,
      updateProject,
      deleteProject,
      addTag,
      removeTag,
      ensurePlace,
      deletePlace,
      updateSettings,
      saveSubscription,
      removeSubscription,
      buildBackup,
      restoreBackup,
      resetEverything,
    }),
    [
      ready,
      tasks,
      projects,
      places,
      subscriptions,
      settings,
      createTask,
      updateTask,
      deleteTask,
      toggleComplete,
      duplicateTask,
      reorderTask,
      createProject,
      updateProject,
      deleteProject,
      addTag,
      removeTag,
      ensurePlace,
      deletePlace,
      updateSettings,
      saveSubscription,
      removeSubscription,
      buildBackup,
      restoreBackup,
      resetEverything,
    ],
  );

  return <TaskerContext.Provider value={value}>{children}</TaskerContext.Provider>;
}

export function useTasker(): TaskerContextValue {
  const context = useContext(TaskerContext);
  if (!context) throw new Error('useTasker must be used inside <TaskerProvider>.');
  return context;
}

/** Convenience selectors shared by the views. */
export function useProjectMap(): Map<string, Project> {
  const { projects } = useTasker();
  return useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
}
