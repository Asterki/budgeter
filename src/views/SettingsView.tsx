/**
 * Settings — appearance, progress, notifications, workspace and data.
 */

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { BackupFile, Category, Settings } from '../domain/types';
import { formatDateShort, todayISO } from '../domain/date';
import { completionsByDay, currentStreak, levelForXp } from '../domain/progress';
import { CATEGORY_COLORS, useTasker } from '../state/store';
import {
  currentSubscription,
  disableNotifications,
  enableNotifications,
  notificationsSupported,
  vapidPublicKey,
} from '../notifications/push';

interface SettingsViewProps {
  onOpenManual: () => void;
}

type Status = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

export function SettingsView({ onOpenManual }: SettingsViewProps) {
  const {
    settings,
    categories,
    projects,
    subscriptions,
    tasks,
    places,
    updateSettings,
    createCategory,
    updateCategory,
    deleteCategory,
    saveSubscription,
    removeSubscription,
    buildBackup,
    restoreBackup,
    resetEverything,
  } = useTasker();

  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = (partial: Partial<Settings>) => updateSettings(partial);

  const progress = settings.progress;
  const level = levelForXp(progress.xp);
  const streak = currentStreak(progress);
  const doneToday = progress.todayDate === todayISO() ? progress.todayCount : 0;
  const history = useMemo(() => completionsByDay(tasks, 14), [tasks]);
  const peak = Math.max(1, ...history.map((day) => day.count));
  const plannedToday = tasks.filter((task) => !task.completed && task.date === todayISO() && task.parentId === null).length;

  async function handleEnable() {
    setBusy(true);
    setStatus(null);
    const result = await enableNotifications();
    if (result.ok) {
      const record = await currentSubscription();
      if (record) saveSubscription(record);
      patch({ notificationsEnabled: true });
    }
    setStatus({ tone: result.ok ? 'ok' : 'warn', text: result.message });
    setBusy(false);
  }

  async function handleDisable() {
    setBusy(true);
    await disableNotifications();
    subscriptions.forEach((sub) => removeSubscription(sub.id));
    patch({ notificationsEnabled: false });
    setStatus({ tone: 'ok', text: 'Notifications disabled on this device.' });
    setBusy(false);
  }

  function handleExport() {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tasker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus({
      tone: 'ok',
      text: `Exported ${backup.tasks.length} tasks, ${backup.projects.length} projects and ${backup.categories.length} categories.`,
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as BackupFile;
      await restoreBackup(parsed);
      setStatus({ tone: 'ok', text: `Restored ${parsed.tasks?.length ?? 0} tasks.` });
    } catch (error) {
      setStatus({ tone: 'error', text: `Import failed: ${(error as Error).message}` });
    }
    setBusy(false);
  }

  async function handleReset() {
    if (!window.confirm('Erase every task, project, category and setting on this device?')) return;
    setBusy(true);
    await resetEverything();
    setStatus({ tone: 'ok', text: 'All local data was erased.' });
    setBusy(false);
  }

  function handleCategoryMenu(category: Category) {
    const choice = window.prompt(
      `“${category.name}”\n\n1 — Rename\n2 — Change colour\n3 — Delete\n\nEnter a number:`,
      '1',
    );
    if (choice === '1') {
      const name = window.prompt('New category name', category.name);
      if (name?.trim()) updateCategory(category.id, { name: name.trim() });
    } else if (choice === '2') {
      const index = CATEGORY_COLORS.indexOf(category.color);
      updateCategory(category.id, { color: CATEGORY_COLORS[(index + 1) % CATEGORY_COLORS.length] });
    } else if (choice === '3') {
      if (window.confirm(`Delete “${category.name}”? Its projects move to Uncategorised.`)) {
        deleteCategory(category.id);
      }
    }
  }

  const pushConfigured = Boolean(vapidPublicKey());

  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Settings</h1>
          <p className="view__subtitle">Appearance, progress, notifications, workspace and data</p>
        </div>
        <button type="button" className="button" onClick={onOpenManual}>
          Open user manual
        </button>
      </header>

      {status && <div className={`notice notice--${status.tone}`}>{status.text}</div>}

      <div className="card">
        <h2 className="card__title">Progress</h2>
        <div className="progress-head">
          <div className="progress-level">
            <span className="progress-level__badge">{level.level}</span>
            <div>
              <strong>Level {level.level}</strong>
              <span className="muted">
                {level.into} / {level.needed} XP to level {level.level + 1}
              </span>
            </div>
          </div>
          <div className="progress-bar" aria-hidden="true">
            <span className="progress-bar__fill" style={{ width: `${Math.round(level.ratio * 100)}%` }} />
          </div>
        </div>

        <div className="stats">
          <span className="stat">
            <strong>{doneToday}</strong> done today
            {plannedToday > 0 && <span className="muted"> / {plannedToday} planned</span>}
          </span>
          <span className="stat">
            <strong>🔥 {streak}</strong> day streak
          </span>
          <span className="stat">
            <strong>{progress.bestStreak}</strong> best streak
          </span>
          <span className="stat">
            <strong>{progress.totalCompleted}</strong> completed all time
          </span>
          <span className="stat">
            <strong>{progress.xp}</strong> XP
          </span>
        </div>

        <div className="settings-chart" aria-label="Completions over the last 14 days">
          {history.map((day) => (
            <span
              key={day.date}
              className={`settings-chart__col${day.count > 0 ? ' settings-chart__col--filled' : ''}`}
              title={`${formatDateShort(day.date)} · ${day.count}`}
            >
              <span style={{ height: `${Math.max(4, (day.count / peak) * 100)}%` }} />
            </span>
          ))}
        </div>

        <div className="card__row">
          <label className="switch switch--boxed">
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(event) => patch({ soundEnabled: event.target.checked })}
            />
            <span>Completion chime</span>
          </label>
          <label className="field">
            <span className="field__label">Theme</span>
            <select
              className="input"
              value={settings.theme}
              onChange={(event) => patch({ theme: event.target.value as Settings['theme'] })}
            >
              <option value="nordic-light">Nordic Light</option>
              <option value="nordic-dark">Nordic Dark</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Notifications</h2>
        <p className="card__hint">
          Reminders are delivered while Tasker is open. If the browser grants push access, they also
          arrive while it is closed.
        </p>
        <div className="card__row">
          <label className="field">
            <span className="field__label">Remind me</span>
            <select
              className="input"
              value={settings.reminderLeadMinutes}
              onChange={(event) => patch({ reminderLeadMinutes: Number(event.target.value) })}
            >
              <option value={0}>At the scheduled time</option>
              <option value={5}>5 minutes before</option>
              <option value={10}>10 minutes before</option>
              <option value={30}>30 minutes before</option>
              <option value={60}>1 hour before</option>
            </select>
          </label>
          <div className="field">
            <span className="field__label">Status</span>
            <div className="status-line">
              <span className={`pill ${settings.notificationsEnabled ? 'pill--on' : 'pill--off'}`}>
                {settings.notificationsEnabled ? 'Enabled' : 'Off'}
              </span>
              <span className="muted">
                {subscriptions.length > 0 ? 'background push ready' : 'in-app only'}
              </span>
            </div>
          </div>
        </div>

        {!notificationsSupported() && (
          <div className="notice notice--warn">This browser does not support notifications.</div>
        )}
        {notificationsSupported() && !pushConfigured && (
          <div className="notice notice--warn">
            No VAPID key configured, so reminders only fire while Tasker is open. Add{' '}
            <code>VITE_VAPID_PUBLIC_KEY</code> and redeploy for background push.
          </div>
        )}

        <div className="card__actions">
          <button type="button" className="button button--primary" onClick={() => void handleEnable()} disabled={busy}>
            Enable notifications
          </button>
          <button type="button" className="button" onClick={() => void handleDisable()} disabled={busy}>
            Disable
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Categories &amp; projects</h2>
        <p className="card__hint">
          Categories group projects; projects group tasks. Every task can nest subtasks to any depth.
        </p>
        {categories.length === 0 && <p className="muted">No categories yet.</p>}
        <ul className="settings-list">
          {categories.map((category) => (
            <li key={category.id} className="settings-list__row">
              <span className="dot" style={{ background: category.color }} />
              <span className="settings-list__label">{category.name}</span>
              <span className="muted">
                {projects.filter((project) => project.categoryId === category.id).length} projects
              </span>
              <button type="button" className="link-button" onClick={() => handleCategoryMenu(category)}>
                manage
              </button>
            </li>
          ))}
        </ul>
        <div className="card__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              const name = window.prompt('Category name — e.g. Work, Personal');
              if (name?.trim()) createCategory(name.trim());
            }}
          >
            New category
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Data</h2>
        <p className="card__hint">
          Everything is stored locally in IndexedDB. Export a JSON snapshot to back up, import it to
          restore. Import replaces the current state.
        </p>
        <div className="stats">
          <span className="stat">
            <strong>{tasks.length}</strong> tasks
          </span>
          <span className="stat">
            <strong>{projects.length}</strong> projects
          </span>
          <span className="stat">
            <strong>{categories.length}</strong> categories
          </span>
          <span className="stat">
            <strong>{places.length}</strong> places
          </span>
        </div>
        <div className="card__actions">
          <button type="button" className="button button--primary" onClick={handleExport}>
            Export JSON
          </button>
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import JSON
          </button>
          <button type="button" className="button button--danger" onClick={() => void handleReset()} disabled={busy}>
            Reset app
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void handleImport(event)}
        />
      </div>

      <div className="card">
        <h2 className="card__title">About</h2>
        <dl className="about">
          <div>
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div>
            <dt>Build mode</dt>
            <dd>{__APP_MODE__}</dd>
          </div>
          <div>
            <dt>Built</dt>
            <dd>{new Date(__BUILD_TIME__).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>IndexedDB (local-first)</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
