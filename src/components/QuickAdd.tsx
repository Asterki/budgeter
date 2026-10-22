/**
 * Inline natural-language quick-add field.
 *
 * Parses the text on every keystroke and renders the detected metadata as
 * chips below the input, so the user always sees what will be saved.
 */

import { useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useTasker, type NewTaskInput } from '../state/store';
import { parseTaskInput } from '../domain/parser';
import { relativeDayLabel } from '../domain/date';
import { describeRecurrence } from '../domain/recurrence';

interface QuickAddProps {
  /** Project applied when the text has no `#project` token. */
  projectId?: string | null;
  /** Date applied when the text has no date token. */
  defaultDate?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  /** Renders a slimmer single-line variant. */
  compact?: boolean;
  /** Exposes the underlying input so the shell can focus it. */
  inputRef?: Ref<HTMLInputElement>;
}

export function QuickAdd({ projectId = null, defaultDate = null, placeholder, autoFocus, compact, inputRef }: QuickAddProps) {
  const { projects, places, createTask } = useTasker();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const localRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localRef;

  const parsed = useMemo(
    () => parseTaskInput(value, { projects, places, fallbackProjectId: projectId }),
    [value, projects, places, projectId],
  );

  const hasContent = value.trim().length > 0;

  async function submit() {
    if (!hasContent || busy) return;
    setBusy(true);
    const payload: NewTaskInput = {
      title: parsed.title,
      projectId: parsed.projectId,
      projectName: parsed.projectName,
      place: parsed.place,
      priority: parsed.priority,
      date: parsed.date ?? defaultDate,
      time: parsed.time,
      duration: parsed.duration,
      allDay: parsed.allDay,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
    };
    setValue('');
    await createTask(payload);
    setBusy(false);
    if (typeof input === 'object') input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
    if (event.key === 'Escape') {
      setValue('');
    }
  }

  const project = parsed.projectId
    ? projects.find((p) => p.id === parsed.projectId)
    : parsed.projectName
      ? { name: parsed.projectName, color: '#6E839A' }
      : null;

  return (
    <div className={`quick-add${compact ? ' quick-add--compact' : ''}`}>
      <div className="quick-add__row">
        <span className="quick-add__plus" aria-hidden="true">
          ＋
        </span>
        <input
          ref={input}
          className="quick-add__input"
          value={value}
          autoFocus={autoFocus}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Add a task…  try “Review PR @work tomorrow !1 #UNAH”'}
          aria-label="Quick add task"
        />
        <button
          type="button"
          className="button button--primary quick-add__submit"
          onClick={() => void submit()}
          disabled={!hasContent}
        >
          Add
        </button>
      </div>

      {hasContent && (
        <div className="quick-add__preview" aria-live="polite">
          <span className="chip chip--ghost">
            {parsed.title ? parsed.title : <em>No title yet</em>}
          </span>
          {project && (
            <span className="chip">
              <span className="dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {parsed.place && <span className="chip">📍 @{parsed.place}</span>}
          {parsed.date && (
            <span className="chip">🗓 {relativeDayLabel(parsed.date)}</span>
          )}
          {parsed.time && <span className="chip">🕒 {parsed.time}</span>}
          {parsed.duration > 0 && <span className="chip">{parsed.duration} min</span>}
          {parsed.priority !== 4 && (
            <span className={`chip chip--p${parsed.priority}`}>!{parsed.priority}</span>
          )}
          {parsed.recurrence && (
            <span className="chip">🔁 {describeRecurrence(parsed.recurrence)}</span>
          )}
          {parsed.tags.map((tag) => (
            <span className="chip" key={tag}>
              +{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
