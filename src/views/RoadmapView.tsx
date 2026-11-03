/**
 * Roadmap view — a timeline of execution sequences (lanes) and deadlines.
 *
 * Tasks are grouped into lanes and laid out against a week-by-week (or
 * day-by-day) timeline, so a whole delivery plan is readable at a glance.
 * Tasks without a date fall into an "Unscheduled" backlog beneath it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import type { Task } from '../domain/types';
import {
  addDays,
  addMonths,
  daysBetween,
  formatDateShort,
  isToday,
  monthLabel,
  startOfMonth,
  startOfWeek,
  todayISO,
} from '../domain/date';
import { useProjectMap, useTasker } from '../state/store';
import { TaskRow } from '../components/TaskRow';

interface RoadmapViewProps {
  onOpenTask: (task: Task) => void;
}

const UNASSIGNED_LANE = 'Unassigned';
const COLUMN_WIDTH = { week: 104, day: 46 } as const;

export function RoadmapView({ onOpenTask }: RoadmapViewProps) {
  const { tasks } = useTasker();
  const projectMap = useProjectMap();
  const [windowStart, setWindowStart] = useState(() => startOfMonth(todayISO()));
  const [zoom, setZoom] = useState<'week' | 'day'>('week');

  const step = zoom === 'week' ? 7 : 1;

  /** One timeline column per step, starting on a week boundary. */
  const columns = useMemo(() => {
    const first = startOfWeek(windowStart);
    const last = addDays(addMonths(windowStart, 2), step);
    const out: string[] = [];
    for (let cursor = first; cursor <= last; cursor = addDays(cursor, step)) out.push(cursor);
    return out;
  }, [windowStart, step]);

  const timelineStart = columns[0];
  const totalColumns = columns.length;

  // Only top-level work belongs on the timeline; subtasks live with their parent.
  const scheduled = useMemo(
    () => tasks.filter((task) => !task.completed && task.date && task.parentId === null),
    [tasks],
  );
  const unscheduled = useMemo(
    () => tasks.filter((task) => !task.completed && !task.date && task.parentId === null),
    [tasks],
  );

  const lanes = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of scheduled) {
      const lane = task.lane.trim() || UNASSIGNED_LANE;
      const bucket = map.get(lane) ?? [];
      bucket.push(task);
      map.set(lane, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : 1));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scheduled]);

  const monthMarkers = useMemo(() => {
    const markers: { index: number; label: string }[] = [];
    let lastMonth = '';
    columns.forEach((iso, index) => {
      const month = iso.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        markers.push({ index, label: monthLabel(iso).split(' ')[0] });
      }
    });
    return markers;
  }, [columns]);

  const overdue = scheduled.filter((task) => task.date! < todayISO()).length;

  /** Column index (0-based) for a task's date, snapped to its period. */
  function columnIndex(dateISO: string): number {
    const anchor = step === 7 ? startOfWeek(dateISO) : dateISO;
    return Math.max(0, Math.min(totalColumns - 1, Math.floor(daysBetween(timelineStart, anchor) / step)));
  }

  // Centre the timeline on today whenever the window or zoom changes, so the
  // interesting part of the plan is visible without horizontal scrolling.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || totalColumns === 0) return;
    const columnWidth = container.scrollWidth / totalColumns;
    const target = columnIndex(todayISO()) * columnWidth - container.clientWidth / 2 + columnWidth / 2;
    container.scrollLeft = Math.max(0, target);
  }, [windowStart, zoom, totalColumns]);

  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Roadmap</h1>
          <p className="view__subtitle">
            {scheduled.length} scheduled · {lanes.length} lane{lanes.length === 1 ? '' : 's'} · {overdue} overdue
          </p>
        </div>
        <div className="calendar__toolbar">
          <button type="button" className="button" onClick={() => setWindowStart(addMonths(windowStart, -1))} aria-label="Previous month">
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="button" onClick={() => setWindowStart(startOfMonth(todayISO()))}>
            Today
          </button>
          <button type="button" className="button" onClick={() => setWindowStart(addMonths(windowStart, 1))} aria-label="Next month">
            <FiChevronRight aria-hidden="true" />
          </button>
          <div className="segmented">
            <button
              type="button"
              className={zoom === 'week' ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => setZoom('week')}
            >
              Weeks
            </button>
            <button
              type="button"
              className={zoom === 'day' ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => setZoom('day')}
            >
              Days
            </button>
          </div>
        </div>
      </header>

      <div className="roadmap">
        <div className="roadmap__scroll" ref={scrollRef}>
          <div
            className="roadmap__inner"
            style={{
              minWidth: totalColumns * COLUMN_WIDTH[zoom] + 160,
              ['--columns' as string]: totalColumns,
            }}
          >
            <div className="roadmap__months">
              <div className="roadmap__lane-label" />
              <div className="roadmap__month-track" style={gridStyle(totalColumns)}>
                {monthMarkers.map((marker) => (
                  <span
                    key={`${marker.label}-${marker.index}`}
                    className="roadmap__month"
                    style={{ gridColumn: marker.index + 1 }}
                  >
                    {marker.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="roadmap__axis-row">
              <div className="roadmap__lane-label roadmap__lane-label--head">Lane</div>
              <div className="roadmap__axis" style={gridStyle(totalColumns)}>
                {columns.map((iso, index) => (
                  <span
                    key={iso}
                    className={`roadmap__tick${isToday(iso) ? ' roadmap__tick--today' : ''}`}
                    style={{ gridColumn: index + 1 }}
                  >
                    {zoom === 'week' ? formatDateShort(iso) : iso.slice(8, 10)}
                  </span>
                ))}
              </div>
            </div>

            {lanes.length === 0 && (
              <div className="roadmap__empty">No scheduled tasks yet — add dates to see the roadmap.</div>
            )}

            {lanes.map(([lane, laneTasks]) => (
              <div className="roadmap__row" key={lane}>
                <div className="roadmap__lane-label">{lane}</div>
                <div
                  className="roadmap__track"
                  style={{
                    ...gridStyle(totalColumns),
                    gridTemplateRows: `repeat(${laneTasks.length}, auto)`,
                  }}
                >
                  {laneTasks.map((task, rowIndex) => {
                    const index = columnIndex(task.date!);
                    const project = task.projectId ? projectMap.get(task.projectId) : null;
                    const late = task.date! < todayISO();
                    return (
                      <button
                        type="button"
                        key={task.id}
                        className={`roadmap__bar roadmap__bar--p${task.priority}${late ? ' roadmap__bar--late' : ''}`}
                        style={{
                          gridColumn: index + 1,
                          gridRow: rowIndex + 1,
                          borderLeftColor: project?.color ?? undefined,
                        }}
                        onClick={() => onOpenTask(task)}
                        title={`${task.title} · ${task.date}`}
                      >
                        <span className="roadmap__bar-title">{task.title}</span>
                        <span className="roadmap__bar-date">{formatDateShort(task.date!)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="roadmap__backlog">
        <header className="group__header">
          <span className="group__title">Unscheduled</span>
          <span className="group__count">{unscheduled.length}</span>
        </header>
        {unscheduled.length === 0 ? (
          <p className="muted">Every open task has a date.</p>
        ) : (
          <ul className="task-list">
            {unscheduled.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function gridStyle(columns: number) {
  return { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
}
