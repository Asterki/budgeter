/**
 * Task detail editor. Rendered inside the mobile bottom sheet and inside the
 * desktop side panel — the content is identical, only the chrome differs.
 */

import type { Priority, Task } from '../domain/types';
import { formatDate, todayISO } from '../domain/date';
import { RecurrenceEditor } from './RecurrenceEditor';
import { useTasker } from '../state/store';

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 1, label: 'P1 · Urgent' },
  { value: 2, label: 'P2 · High' },
  { value: 3, label: 'P3 · Medium' },
  { value: 4, label: 'P4 · None' },
];

export function TaskDetail({ task, onClose }: TaskDetailProps) {
  const { projects, places, updateTask, deleteTask, duplicateTask, addTag, removeTag } = useTasker();
  const project = projects.find((p) => p.id === task.projectId) ?? null;

  function patch(changes: Partial<Task>) {
    updateTask(task.id, changes);
  }

  function toggleTag(name: string) {
    const has = task.tags.includes(name);
    patch({ tags: has ? task.tags.filter((tag) => tag !== name) : [...task.tags, name] });
  }

  return (
    <div className="detail">
      <input
        className="detail__title"
        value={task.title}
        onChange={(event) => patch({ title: event.target.value })}
        placeholder="Task title"
        aria-label="Task title"
      />

      <textarea
        className="detail__notes input"
        rows={3}
        value={task.notes}
        onChange={(event) => patch({ notes: event.target.value })}
        placeholder="Notes, links, context…"
        aria-label="Task notes"
      />

      <div className="detail__grid">
        <label className="field">
          <span className="field__label">Project</span>
          <select
            className="input"
            value={task.projectId ?? ''}
            onChange={(event) => patch({ projectId: event.target.value || null, tags: [] })}
          >
            <option value="">No project</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Priority</span>
          <select
            className="input"
            value={task.priority}
            onChange={(event) => patch({ priority: Number(event.target.value) as Priority })}
          >
            {PRIORITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Place / context</span>
          <input
            className="input"
            list="tasker-places"
            value={task.place ?? ''}
            onChange={(event) => patch({ place: event.target.value || null })}
            placeholder="@work, @home…"
          />
          <datalist id="tasker-places">
            {places.map((place) => (
              <option key={place.id} value={place.name} />
            ))}
          </datalist>
        </label>

        <label className="field">
          <span className="field__label">Date</span>
          <input
            className="input"
            type="date"
            value={task.date ?? ''}
            onChange={(event) => patch({ date: event.target.value || null })}
          />
        </label>

        <div className="field">
          <span className="field__label">Time</span>
          <div className="field__row">
            <label className="switch">
              <input
                type="checkbox"
                checked={task.allDay}
                onChange={(event) => patch({ allDay: event.target.checked, time: event.target.checked ? null : task.time })}
              />
              <span>All-day</span>
            </label>
            <input
              className="input"
              type="time"
              value={task.time ?? ''}
              disabled={task.allDay}
              onChange={(event) => patch({ time: event.target.value || null, allDay: false })}
            />
          </div>
        </div>

        <label className="field">
          <span className="field__label">Duration (minutes)</span>
          <input
            className="input input--num"
            type="number"
            min={0}
            step={5}
            value={task.duration || ''}
            placeholder="—"
            onChange={(event) => patch({ duration: Math.max(0, Number(event.target.value) || 0) })}
          />
        </label>

        <label className="field">
          <span className="field__label">Roadmap lane</span>
          <input
            className="input"
            list="tasker-lanes"
            value={task.lane}
            placeholder="e.g. Design, Build, Ship"
            onChange={(event) => patch({ lane: event.target.value })}
          />
          <datalist id="tasker-lanes">
            <option value="Backlog" />
            <option value="In progress" />
            <option value="Review" />
            <option value="Done" />
          </datalist>
        </label>
      </div>

      {project && (
        <div className="field">
          <span className="field__label">
            {project.name} tags
            <button
              type="button"
              className="link-button"
              onClick={() => {
                const name = window.prompt('New tag name');
                if (name) addTag(project.id, name);
              }}
            >
              + new tag
            </button>
          </span>
          <div className="tag-picker">
            {project.tags.length === 0 && <span className="muted">No tags in this project yet.</span>}
            {project.tags.map((tag) => {
              const active = task.tags.includes(tag.name);
              return (
                <span key={tag.id} className="tag-pill">
                  <button
                    type="button"
                    className={`chip chip--toggle${active ? ' chip--on' : ''}`}
                    onClick={() => toggleTag(tag.name)}
                    aria-pressed={active}
                  >
                    <span className="dot" style={{ background: tag.color }} />
                    {tag.name}
                  </button>
                  <button
                    type="button"
                    className="tag-pill__remove"
                    onClick={() => removeTag(project.id, tag.id)}
                    aria-label={`Delete tag ${tag.name}`}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <RecurrenceEditor
        value={task.recurrence}
        dateISO={task.date}
        onChange={(rule) => patch({ recurrence: rule })}
      />

      <div className="detail__meta">
        <span>Created {formatDate(new Date(task.createdAt).toISOString().slice(0, 10))}</span>
        {task.completed && <span className="meta--muted">Completed</span>}
      </div>

      <div className="detail__actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            duplicateTask(task.id);
            onClose();
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="button"
          onClick={() => patch({ date: todayISO() })}
        >
          Schedule today
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            deleteTask(task.id);
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
