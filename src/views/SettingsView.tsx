/**
 * Settings — appearance, progress, workspace and data.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { BackupFile, Category, Settings } from '../domain/types';
import { formatDateShort, todayISO } from '../domain/date';
import { completionsByDay, currentStreak, levelForXp, ACHIEVEMENTS } from '../domain/progress';
import { CATEGORY_COLORS, useTasker } from '../state/store';
import {
  connectSync,
  disconnectSync,
  getSyncInfo,
  getSyncStatus,
  subscribeSync,
  syncNow,
} from '../sync/engine';
import { NewSyncSpaceError, type SyncInfo, type SyncStatus } from '../sync/types';

interface SettingsViewProps {
  onOpenManual: () => void;
}

type Status = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

export function SettingsView({ onOpenManual }: SettingsViewProps) {
  const {
    settings,
    categories,
    projects,
    tasks,
    places,
    updateSettings,
    createCategory,
    updateCategory,
    deleteCategory,
    buildBackup,
    restoreBackup,
    resetEverything,
  } = useTasker();

  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [serverUrl, setServerUrl] = useState(
    import.meta.env.VITE_SYNC_URL ?? 'https://tasker-api.asterki.xyz',
  );
  const [passphrase, setPassphrase] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeSync(setSyncStatus);
    void getSyncInfo().then(setSyncInfo);
    return unsubscribe;
  }, []);

  const handleConnect = async (allowCreate: boolean) => {
    setSyncBusy(true);
    try {
      const result = await connectSync(serverUrl, passphrase, allowCreate);
      setSyncInfo(await getSyncInfo());
      setPassphrase('');
      setConfirmCreate(false);
      setStatus({
        tone: 'ok',
        text: result.created ? 'New sync space created and linked.' : 'Connected. Your tasks are syncing.',
      });
    } catch (error) {
      if (error instanceof NewSyncSpaceError) {
        setConfirmCreate(true);
        setStatus({
          tone: 'warn',
          text: 'This passphrase has no data on the relay yet. Create a space to start syncing with it.',
        });
      } else {
        setStatus({
          tone: 'error',
          text: error instanceof Error ? error.message : 'Could not connect.',
        });
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setSyncBusy(true);
    try {
      await disconnectSync();
      setSyncInfo(null);
      setConfirmCreate(false);
      setStatus({ tone: 'ok', text: 'Sync disconnected. Local data is untouched.' });
    } finally {
      setSyncBusy(false);
    }
  };

  const patch = (partial: Partial<Settings>) => updateSettings(partial);

  const progress = settings.progress;
  const level = levelForXp(progress.xp);
  const streak = currentStreak(progress);
  const doneToday = progress.todayDate === todayISO() ? progress.todayCount : 0;
  const history = useMemo(() => completionsByDay(tasks, 14), [tasks]);
  const peak = Math.max(1, ...history.map((day) => day.count));
  const plannedToday = tasks.filter((task) => !task.completed && task.date === todayISO() && task.parentId === null).length;

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

  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Settings</h1>
          <p className="view__subtitle">Appearance, progress, workspace and data</p>
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
          <label className="switch switch--boxed">
            <input
              type="checkbox"
              checked={settings.hapticsEnabled}
              onChange={(event) => patch({ hapticsEnabled: event.target.checked })}
            />
            <span>Haptic feedback</span>
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

        <div className="hud__achievements">
          <span className="hud__section-title">
            Achievements
            <span className="hud__muted">
              {progress.unlocked.length}/{ACHIEVEMENTS.length}
            </span>
          </span>
          <div className="badge-grid">
            {ACHIEVEMENTS.map((achievement) => {
              const owned = progress.unlocked.includes(achievement.id);
              return (
                <span
                  key={achievement.id}
                  className={`badge${owned ? ' badge--owned' : ''}`}
                  title={achievement.description}
                >
                  <span aria-hidden="true">{owned ? achievement.icon : '🔒'}</span>
                  {achievement.title}
                </span>
              );
            })}
          </div>
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
        <h2 className="card__title">Sync</h2>
        <p className="card__hint">
          Optional end-to-end encrypted sync through your own relay. Your passphrase never leaves
          this device; only ciphertext is stored on the server. Lose the passphrase and the sync
          space cannot be recovered.
        </p>

        {syncInfo ? (
          <>
            <dl className="about">
              <div>
                <dt>Relay</dt>
                <dd>{syncInfo.serverUrl}</dd>
              </div>
              <div>
                <dt>Space</dt>
                <dd className="sync-fingerprint">{syncInfo.fingerprint}</dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{syncInfo.lastSyncAt ? new Date(syncInfo.lastSyncAt).toLocaleString() : 'Not yet'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {syncStatus.state === 'syncing'
                    ? 'Syncing…'
                    : syncStatus.state === 'error'
                      ? 'Needs attention'
                      : 'Up to date'}
                  {syncStatus.pending > 0 ? ` · ${syncStatus.pending} queued` : ''}
                </dd>
              </div>
            </dl>
            {syncStatus.error && <p className="card__hint">{syncStatus.error}</p>}
            <div className="card__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void syncNow()}
                disabled={syncStatus.state === 'syncing'}
              >
                Sync now
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void handleDisconnect()}
                disabled={syncBusy}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <div className="sync-form">
            <label className="field">
              <span className="field__label">Relay URL</span>
              <input
                className="input"
                type="url"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://tasker-api.example.com"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span className="field__label">Passphrase</span>
              <input
                className="input"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>
            <div className="card__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void handleConnect(false)}
                disabled={syncBusy || passphrase.trim().length < 8}
              >
                Connect
              </button>
              {confirmCreate && (
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => void handleConnect(true)}
                  disabled={syncBusy}
                >
                  Create new space
                </button>
              )}
            </div>
          </div>
        )}
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
