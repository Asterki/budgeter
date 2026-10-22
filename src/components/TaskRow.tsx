/**
 * A single task line. Used by the Tasks view, the calendar day list and the
 * roadmap detail list.
 */

import type { Priority, Task } from '../domain/types';
import { formatTime, relativeDayLabel, todayISO } from '../domain/date';
import { describeRecurrence } from '../domain/recurrence';
import { useProjectMap, useTasker } from '../state/store';

interface TaskRowProps {
  task: Task;
  onOpen: (task: Task) => void;
  showProject?: boolean;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'Priority 1 — urgent',
  2: 'Priority 2 — high',
  3: 'Priority 3 — medium',
  4: 'Priority 4 — none',
};

export function TaskRow({ task, onOpen, showProject = true }: TaskRowProps) {
  const { toggleComplete, updateTask } = useTasker();
  const projectMap = useProjectMap();
  const project = task.projectId ? projectMap.get(task.projectId) : null;

  const overdue = !task.completed && task.date !== null && task.date < todayISO();

  function cyclePriority() {
    const next = (task.priority === 4 ? 1 : task.priority + 1) as Priority;
    updateTask(task.id, { priority: next });
  }

  return (
    <li className={`task-row${task.completed ? ' task-row--done' : ''}`}>
      <button
        type="button"
        className={`checkbox checkbox--p${task.priority}`}
        onClick={() => toggleComplete(task.id)}
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
          {task.date && (
            <span className={`meta meta--date${overdue ? ' meta--overdue' : ''}`}>
              {relativeDayLabel(task.date)}
            </span>
          )}
          {!task.allDay && task.time && <span className="meta">{formatTime(task.time)}</span>}
          {task.allDay && task.date && <span className="meta meta--muted">All day</span>}
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
