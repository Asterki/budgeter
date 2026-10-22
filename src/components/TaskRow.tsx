/**
 * A single task line. Used by the Tasks view, the calendar day list and the
 * roadmap backlog.
 *
 * A task that has subtasks gets an expand toggle showing how many are done, so
 * nesting is discoverable without opening the detail panel.
 */

import { useState, type MouseEvent } from 'react';
import type { Priority, Task } from '../domain/types';
import { formatTaskRange, formatTime, todayISO } from '../domain/date';
import { describeRecurrence } from '../domain/recurrence';
import { previewGain } from '../domain/progress';
import { useProjectMap, useTasker } from '../state/store';
import { useCelebration } from './Celebration';

interface TaskRowProps {
  task: Task;
  onOpen: (task: Task) => void;
  showProject?: boolean;
  /** Nesting level, used only for indentation. */
  depth?: number;
  childCount?: number;
  doneChildCount?: number;
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onAddSubtask?: (id: string) => void;
  /** Marks a day inside a multi-day task that is not the first one. */
  continuation?: boolean;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'Priority 1 — urgent',
  2: 'Priority 2 — high',
  3: 'Priority 3 — medium',
  4: 'Priority 4 — none',
};

export function TaskRow({
  task,
  onOpen,
  showProject = true,
  depth = 0,
  childCount = 0,
  doneChildCount = 0,
  expanded = false,
  onToggleExpand,
  onAddSubtask,
  continuation = false,
}: TaskRowProps) {
  const { toggleComplete, updateTask, settings } = useTasker();
  const { celebrate, announce } = useCelebration();
  const [pending, setPending] = useState(false);
  const projectMap = useProjectMap();
  const project = task.projectId ? projectMap.get(task.projectId) : null;

  const multiDay = Boolean(task.endDate && task.date && task.endDate > task.date);
  const overdue = !task.completed && task.date !== null && task.date < todayISO();
  const allChildrenDone = childCount > 0 && doneChildCount === childCount;

  function cyclePriority() {
    const next = (task.priority === 4 ? 1 : task.priority + 1) as Priority;
    updateTask(task.id, { priority: next });
  }

  /**
   * Completion is choreographed: the burst fires on the click while the row
   * plays its strike-through, and the state commits ~220ms later so the reward
   * never feels delayed and the animation is never cut off.
   */
  function handleToggle(event: MouseEvent<HTMLButtonElement>) {
    if (task.completed) {
      toggleComplete(task.id);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    setPending(true);
    celebrate(point, previewGain(settings.progress, task.priority));

    window.setTimeout(() => {
      setPending(false);
      const outcome = toggleComplete(task.id);
      if (outcome) announce(outcome, point);
    }, 220);
  }

  return (
    <li
      className={`task-row${task.completed ? ' task-row--done' : ''}${
        continuation ? ' task-row--continuation' : ''
      }${pending ? ' task-row--clearing' : ''}`}
      data-task-id={task.id}
      style={{ ['--depth' as string]: depth }}
    >
      <span className="task-row__indent" aria-hidden="true" />

      <button
        type="button"
        className={`checkbox checkbox--p${task.priority}${pending ? ' checkbox--pop' : ''}`}
        onClick={handleToggle}
        aria-label={task.completed ? 'Mark as not done' : 'Mark as done'}
        aria-pressed={task.completed}
      >
        <span className="checkbox__mark" aria-hidden="true">
          ✓
        </span>
      </button>

      <button type="button" className="task-row__main" onClick={() => onOpen(task)}>
        <span className="task-row__title">{task.title}</span>

        <span className="task-row__meta">
          {continuation && <span className="meta meta--muted">continues</span>}
          {task.date && (
            <span className={`meta meta--date${overdue ? ' meta--overdue' : ''}`}>
              {formatTaskRange(task.date, task.endDate)}
            </span>
          )}
          {!task.allDay && task.time && (
            <span className="meta">
              {formatTime(task.time)}
              {task.endTime ? ` – ${formatTime(task.endTime)}` : ''}
            </span>
          )}
          {task.allDay && task.date && !multiDay && <span className="meta meta--muted">All day</span>}
          {task.place && <span className="meta">@{task.place}</span>}
          {showProject && project && (
            <span className="meta">
              <span className="dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {task.tags.map((tag) => (
            <span className="meta meta--tag" key={tag}>
              +{tag}
            </span>
          ))}
          {task.recurrence && (
            <span className="meta meta--recur" title={describeRecurrence(task.recurrence)}>
              🔁
            </span>
          )}
          {task.notes && <span className="meta meta--muted">📝</span>}
        </span>
      </button>

      <div className="task-row__actions">
        {onAddSubtask && (
          <button
            type="button"
            className="icon-button icon-button--subtle"
            onClick={() => onAddSubtask(task.id)}
            title="Add subtask"
            aria-label={`Add subtask to ${task.title}`}
          >
            ＋
          </button>
        )}

        {childCount > 0 && onToggleExpand && (
          <button
            type="button"
            className={`subtask-toggle${allChildrenDone ? ' subtask-toggle--done' : ''}`}
            onClick={() => onToggleExpand(task.id)}
            aria-expanded={expanded}
            title={expanded ? 'Hide subtasks' : 'Show subtasks'}
          >
            <span className="subtask-toggle__caret" aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
            {doneChildCount}/{childCount}
          </button>
        )}

        <button
          type="button"
          className={`flag flag--p${task.priority}`}
          onClick={cyclePriority}
          title={PRIORITY_LABEL[task.priority]}
          aria-label={PRIORITY_LABEL[task.priority]}
        >
          {task.priority === 4 ? '⚑' : `!${task.priority}`}
        </button>
      </div>
    </li>
  );
}
