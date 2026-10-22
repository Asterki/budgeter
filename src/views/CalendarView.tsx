/**
 * Calendar view — month and week grids showing how work is distributed
 * across days, with a day panel for inspection and quick capture.
 */

import { useMemo, useState } from 'react';
import type { Task } from '../domain/types';
import {
  addDays,
  addMonths,
  dateRange,
  endOfWeek,
  formatDate,
  isToday,
  monthLabel,
  monthMatrix,
  relativeDayLabel,
  startOfWeek,
  todayISO,
  WEEKDAYS_SHORT,
} from '../domain/date';
import { useTasker } from '../state/store';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../components/TaskRow';

type CalendarMode = 'month' | 'week';

interface CalendarViewProps {
  onOpenTask: (task: Task) => void;
}

export function CalendarView({ onOpenTask }: CalendarViewProps) {
  const { tasks } = useTasker();
  const [cursor, setCursor] = useState(todayISO());
  const [mode, setMode] = useState<CalendarMode>('month');
  const [selected, setSelected] = useState(todayISO());

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.date) continue;
      const bucket = map.get(task.date) ?? [];
      bucket.push(task);
      map.set(task.date, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.time ?? '') < (b.time ?? '') ? -1 : 1;
      });
    }
    return map;
  }, [tasks]);

  const monthWeeks = useMemo(() => monthMatrix(cursor), [cursor]);
  const weekDays = useMemo(
    () => dateRange(startOfWeek(cursor), endOfWeek(cursor)),
    [cursor],
  );

  const weeks = mode === 'month' ? monthWeeks : [weekDays];
  const currentMonth = cursor.slice(0, 7);

  function shift(direction: -1 | 1) {
    const next = mode === 'month' ? addMonths(cursor, direction) : addDays(cursor, direction * 7);
    setCursor(next);
    setSelected(next);
  }

  function goToday() {
    setCursor(todayISO());
    setSelected(todayISO());
  }

  const selectedTasks = byDate.get(selected) ?? [];

  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Calendar</h1>
          <p className="view__subtitle">
            {mode === 'month' ? monthLabel(cursor) : `${relativeDayLabel(startOfWeek(cursor))} – ${relativeDayLabel(endOfWeek(cursor))}`}
          </p>
        </div>
        <div className="calendar__toolbar">
          <button type="button" className="button" onClick={() => shift(-1)} aria-label="Previous period">
            ‹
          </button>
          <button type="button" className="button" onClick={goToday}>
            Today
          </button>
          <button type="button" className="button" onClick={() => shift(1)} aria-label="Next period">
            ›
          </button>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'month' ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => setMode('month')}
            >
              Month
            </button>
            <button
              type="button"
              className={mode === 'week' ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => setMode('week')}
            >
              Week
            </button>
          </div>
        </div>
      </header>

      <div className={`calendar calendar--${mode}`}>
        <div className="calendar__weekdays">
          {WEEKDAYS_SHORT.map((day, index) => (
            <span key={`${day}-${index}`} className="calendar__weekday">
              {mode === 'month' ? day.slice(0, 3) : day}
            </span>
          ))}
        </div>

        <div className="calendar__grid">
          {weeks.flat().map((iso) => {
            const dayTasks = byDate.get(iso) ?? [];
            const outside = mode === 'month' && iso.slice(0, 7) !== currentMonth;
            const openCount = dayTasks.filter((task) => !task.completed).length;
            return (
              <button
                type="button"
                key={iso}
                className={[
                  'calendar__cell',
                  outside ? 'calendar__cell--outside' : '',
                  isToday(iso) ? 'calendar__cell--today' : '',
                  selected === iso ? 'calendar__cell--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setSelected(iso);
                  setCursor(iso);
                }}
              >
                <span className="calendar__date">{Number(iso.slice(8, 10))}</span>
                <span className="calendar__items">
                  {dayTasks.slice(0, mode === 'week' ? 6 : 3).map((task) => (
                    <span
                      key={task.id}
                      className={`calendar__item calendar__item--p${task.priority}${task.completed ? ' calendar__item--done' : ''}`}
                    >
                      {!task.allDay && task.time ? `${task.time} ` : ''}
                      {task.title}
                    </span>
                  ))}
                  {dayTasks.length > (mode === 'week' ? 6 : 3) && (
                    <span className="calendar__more">+{dayTasks.length - (mode === 'week' ? 6 : 3)} more</span>
                  )}
                </span>
                {openCount > 0 && <span className="calendar__badge">{openCount}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="calendar__day">
        <header className="group__header">
          <span className="group__title">{formatDate(selected)}</span>
          <span className="group__count">{selectedTasks.length}</span>
        </header>

        <QuickAdd defaultDate={selected} compact placeholder={`Add a task on ${formatDate(selected)}…`} />

        {selectedTasks.length === 0 ? (
          <p className="muted">No tasks scheduled for this day.</p>
        ) : (
          <ul className="task-list">
            {selectedTasks.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
