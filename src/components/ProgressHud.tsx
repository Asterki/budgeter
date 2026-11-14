/** Compact level badge with a budget-habit popover. */

import { useEffect, useState } from 'react';
import { FiAward, FiX, FiZap } from 'react-icons/fi';

import { ACHIEVEMENTS } from '../domain/achievements';
import { levelProgress, COMBO_CAP } from '../domain/progress';
import type { Progress } from '../domain/types';
import { useSyncStatus } from '../state/hooks';
import type { SyncStatus } from '../sync/types';

interface ProgressHudProps {
  progress: Progress;
}

/** Six-pixel dot: the only always-visible sync signal in the shell. */
function syncDot(status: SyncStatus): { tone: string; title: string } | null {
  if (!status.configured) return null;
  switch (status.state) {
    case 'syncing':
      return { tone: 'active', title: 'Syncing…' };
    case 'degraded':
      return {
        tone: 'warn',
        title: `${status.quarantined} change(s) need attention — open Settings`,
      };
    case 'error':
      return { tone: 'error', title: status.error ?? 'Sync failed' };
    case 'offline':
      return { tone: 'offline', title: 'Offline — changes are queued' };
    default:
      return null;
  }
}

export function ProgressHud({ progress }: ProgressHudProps) {
  const [open, setOpen] = useState(false);
  const sync = useSyncStatus();
  const dot = syncDot(sync);
  const { level, floor, next } = levelProgress(progress.xp);
  const ratio = next > floor ? Math.min(1, (progress.xp - floor) / (next - floor)) : 0;
  const unlocked = new Set(progress.unlocked);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="hud">
      <button
        type="button"
        className="hud__button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Level ${level}, ${progress.streak} day streak. Open progress.`}
      >
        <span className="hud__ring" aria-hidden="true">
          <svg viewBox="0 0 36 36">
            <circle className="hud__ring-track" cx="18" cy="18" r="15.5" />
            <circle
              className="hud__ring-fill"
              cx="18"
              cy="18"
              r="15.5"
              strokeDasharray={`${ratio * 97.4} 97.4`}
            />
          </svg>
          <span className="hud__level">{level}</span>
        </span>
        {dot && <span className={`hud__sync hud__sync--${dot.tone}`} title={dot.title} aria-hidden="true" />}
        <span className="hud__meta">
          <span className="hud__streak">
            <FiZap aria-hidden="true" /> {progress.streak}
          </span>
          <span className="hud__label">streak</span>
        </span>
      </button>

      {open && (
        <>
          <div className="hud__backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="hud__popover" role="dialog" aria-label="Progress">
            <header className="hud__head">
              <div>
                <strong>Level {level}</strong>
                <span className="hud__sub">
                  {progress.xp} XP · {Math.max(0, next - progress.xp)} to next
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close progress"
              >
                <FiX />
              </button>
            </header>

            <div className="hud__meter" aria-hidden="true">
              <span style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>

            <div className="hud__stats">
              <div>
                <strong>{progress.streak}</strong>
                <span>day streak</span>
              </div>
              <div>
                <strong>{progress.bestStreak}</strong>
                <span>best streak</span>
              </div>
              <div>
                <strong>{progress.totalLogged}</strong>
                <span>logged</span>
              </div>
              <div>
                <strong>{progress.underBudgetMonths}</strong>
                <span>months under</span>
              </div>
            </div>

            <div className="hud__combo">
              <FiZap aria-hidden="true" />
              {progress.combo > 1
                ? `${Math.min(progress.combo, COMBO_CAP)}× combo active — log again soon`
                : 'Log transactions back to back for a combo'}
            </div>

            <div className="hud__achievements">
              <div className="hud__section">
                <FiAward aria-hidden="true" />
                <strong>
                  {progress.unlocked.length}/{ACHIEVEMENTS.length} achievements
                </strong>
              </div>
              <div className="hud__badges">
                {ACHIEVEMENTS.map((achievement) => (
                  <span
                    key={achievement.id}
                    className={`achievement-dot${unlocked.has(achievement.id) ? ' achievement-dot--on' : ''}`}
                    title={`${achievement.title} — ${achievement.description}`}
                  >
                    {achievement.title.slice(0, 1)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
