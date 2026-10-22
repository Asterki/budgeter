/**
 * Settings — appearance, notification opt-in, data portability and app info.
 */

import { useRef, useState, type ChangeEvent } from 'react';
import type { BackupFile, Settings } from '../domain/types';
import { useTasker } from '../state/store';
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
    projects,
    subscriptions,
    tasks,
    places,
    updateSettings,
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
    setStatus({ tone: 'ok', text: `Exported ${backup.tasks.length} tasks and ${backup.projects.length} projects.` });
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
    if (!window.confirm('Erase every task, project and setting on this device?')) return;
    setBusy(true);
    await resetEverything();
    setStatus({ tone: 'ok', text: 'All local data was erased.' });
    setBusy(false);
  }

  const pushConfigured = Boolean(vapidPublicKey());

  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Settings</h1>
          <p className="view__subtitle">Appearance, notifications, data and help</p>
        </div>
        <button type="button" className="button" onClick={onOpenManual}>
          Open user manual
        </button>
      </header>

      {status && <div className={`notice notice--${status.tone}`}>{status.text}</div>}

      <div className="card">
        <h2 className="card__title">Appearance</h2>
        <div className="card__row">
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
          <label className="field">
            <span className="field__label">Default project</span>
            <select
              className="input"
              value={settings.defaultProjectId ?? ''}
              onChange={(event) => patch({ defaultProjectId: event.target.value || null })}
            >
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Notifications</h2>
        <p className="card__hint">
          Reminders are delivered by a Vercel cron job every minute and by web push, so they arrive
          even when Tasker is closed.
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
                {subscriptions.length} device subscription{subscriptions.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        {!pushConfigured && (
          <div className="notice notice--warn">
            No VAPID public key configured. Set <code>VITE_VAPID_PUBLIC_KEY</code> (and the matching
            server keys) before enabling notifications.
          </div>
        )}
        {!notificationsSupported() && (
          <div className="notice notice--warn">This browser does not support web push.</div>
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
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImport(event)} />
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
