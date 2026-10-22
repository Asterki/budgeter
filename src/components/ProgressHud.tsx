/**
 * Progress HUD: level ring, streak and today's tally, with a detail panel.
 *
 * Everything shown here is derived from `settings.progress` plus each task's
 * `completedAt`, so it survives reloads without any extra bookkeeping.
 */

import { useMemo, useState } from 'react';
import { formatDateShort, todayISO } from '../domain/date';
import { completionsByDay, currentStreak, levelForXp } from '../domain/progress';
import { useTasker } from '../state/store';

export function ProgressHud() {
  const { settings, tasks, updateSettings } = useTasker();
  const [open, setOpen] = useState(false);

  const progress = settings.progress;
  const level = levelForXp(progress.xp);
  const streak = currentStreak(progress);
  const today = todayISO();
  const doneToday = progress.todayDate === today ? progress.todayCount : 0;

  const plannedToday = useMemo(
    () => tasks.filter((task) => !task.completed && task.date === today && task.parentId === null).length,
    [tasks, today],
  );

  const history = useMemo(() => (open ? completionsByDay(tasks, 14) : []), [open, tasks]);
  const peak = Math.max(1, ...history.map((day) => day.count));
  const goalRatio = plannedToday === 0 ? (doneToday > 0 ? 1 : 0) : Math.min(1, doneToday / plannedToday);

  const radius = 15;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="hud">
      <button
        type="button"
        className="hud__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={`Level ${level.level} · ${progress.xp} XP`}
      >
        <span className="hud__badge">
          <svg className="hud__ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="hud__ring-track" cx="18" cy="18" r={radius} />
            <circle
              className="hud__ring-fill"
              cx="18"
              cy="18"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - level.ratio)}
            />
          </svg>
          <span className="hud__level">{level.level}</span>
        </span>
        {streak > 0 && (
          <span className="hud__streak" title={`${streak} day streak`}>
            🔥{streak}
          </span>
        )}
        {doneToday > 0 && (
          <span className="hud__today" title={`${doneToday} completed today`}>
            ✓{doneToday}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="hud__backdrop" onClick={() => setOpen(false)} role="presentation" />
          <div className="hud__panel" role="dialog" aria-label="Progress">
            <header className="hud__panel-head">
              <div>
                <span className="hud__panel-level">Level {level.level}</span>
                <span className="hud__panel-xp">
                  {level.into} / {level.needed} XP
                </span>
              </div>
              <button
                type="button"
                className={`icon-button${settings.soundEnabled ? ' icon-button--on' : ''}`}
                onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
                title={settings.soundEnabled ? 'Mute completion sound' : 'Play a sound on completion'}
                aria-pressed={settings.soundEnabled}
              >
                {settings.soundEnabled ? '🔈' : '🔇'}
              </button>
            </header>

            <div className="hud__bar" aria-hidden="true">
              <span className="hud__bar-fill" style={{ width: `${Math.round(level.ratio * 100)}%` }} />
            </div>

            <dl className="hud__stats">
              <div>
                <dt>Today</dt>
                <dd>
                  {doneToday}
                  {plannedToday > 0 && <span className="hud__muted"> / {plannedToday} planned</span>}
                </dd>
              </div>
              <div>
                <dt>Streak</dt>
                <dd>
                  {streak} day{streak === 1 ? '' : 's'}
                  <span className="hud__muted"> · best {progress.bestStreak}</span>
                </dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{progress.totalCompleted} all time</dd>
              </div>
              <div>
                <dt>XP</dt>
                <dd>{progress.xp} total</dd>
              </div>
            </dl>

            <div className="hud__goal">
              <span className="hud__goal-label">
                {plannedToday === 0
                  ? 'Nothing scheduled today'
                  : goalRatio >= 1
                    ? 'Today is cleared 🎉'
                    : `${plannedToday - doneToday} left today`}
              </span>
              <span className="hud__goal-track" aria-hidden="true">
                <span className="hud__goal-fill" style={{ width: `${Math.round(goalRatio * 100)}%` }} />
              </span>
            </div>

            {history.length > 0 && (
              <div className="hud__chart" aria-label="Completions over the last 14 days">
                {history.map((day) => (
                  <span
                    key={day.date}
                    className={`hud__bar-col${day.count > 0 ? ' hud__bar-col--filled' : ''}`}
                    title={`${formatDateShort(day.date)} · ${day.count}`}
                  >
                    <span style={{ height: `${Math.max(6, (day.count / peak) * 100)}%` }} />
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
