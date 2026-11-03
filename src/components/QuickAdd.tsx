/**
 * Inline natural-language quick-add field.
 *
 * Parses the text on every keystroke and renders the detected metadata as chips
 * below the input. Typing a trigger character opens a dropdown of everything
 * that already exists, so nothing has to be remembered:
 *
 *   `#` projects (grouped by category) · `^` categories · `@` places
 *   `!` priorities · `+` project tags
 *
 * Enter always sends the task. Arrow keys + Enter (or Tab) accept a suggestion.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type Ref } from 'react';
import { FiCalendar, FiClock, FiMapPin, FiPlus, FiRepeat } from 'react-icons/fi';
import { useTasker, type NewTaskInput } from '../state/store';
import { parseTaskInput } from '../domain/parser';
import { applySuggestion, buildSuggestions, findActiveToken } from '../domain/suggestions';
import { formatTaskRange, formatTime } from '../domain/date';
import { describeRecurrence } from '../domain/recurrence';

interface QuickAddProps {
  /** Project applied when the text has no `#project` token. */
  projectId?: string | null;
  /** Task to nest the new task under. */
  parentId?: string | null;
  /** Date applied when the text has no date token. */
  defaultDate?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  /** Renders a slimmer single-line variant. */
  compact?: boolean;
  /** Exposes the underlying input so the shell can focus it. */
  inputRef?: Ref<HTMLInputElement>;
  /** Called after a task was created (used to close the mobile sheet). */
  onSubmitted?: () => void;
}

export function QuickAdd({
  projectId = null,
  parentId = null,
  defaultDate = null,
  placeholder,
  autoFocus,
  compact,
  inputRef,
  onSubmitted,
}: QuickAddProps) {
  const { categories, projects, places, createTask } = useTasker();
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const innerRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  /** Keeps both the local ref and any forwarded ref in sync. */
  const attachRef = (element: HTMLInputElement | null) => {
    innerRef.current = element;
    if (typeof inputRef === 'function') inputRef(element);
    else if (inputRef) (inputRef as MutableRefObject<HTMLInputElement | null>).current = element;
  };

  const parsed = useMemo(
    () => parseTaskInput(value, { categories, projects, places, fallbackProjectId: projectId }),
    [value, categories, projects, places, projectId],
  );

  const token = useMemo(() => (dismissed ? null : findActiveToken(value, caret)), [value, caret, dismissed]);

  const suggestions = useMemo(() => {
    if (!token) return [];
    return buildSuggestions(token, {
      categories,
      projects,
      places,
      projectId: parsed.projectId,
    });
  }, [token, categories, projects, places, parsed.projectId]);

  const open = suggestions.length > 0 && token !== null;
  const hasContent = value.trim().length > 0;

  // Keep the highlighted row inside the scrollable dropdown.
  useEffect(() => {
    if (activeIndex < 0) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function update(next: string, nextCaret: number) {
    setValue(next);
    setCaret(nextCaret);
    setActiveIndex(-1);
    setDismissed(false);
  }

  function accept(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion || !token) return;
    const applied = applySuggestion(value, token, suggestion);
    update(applied.value, applied.caret);
    requestAnimationFrame(() => {
      const element = innerRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(applied.caret, applied.caret);
    });
  }

  async function submit() {
    if (!hasContent || busy) return;
    setBusy(true);
    const payload: NewTaskInput = {
      title: parsed.title,
      projectId: parsed.projectId,
      projectName: parsed.projectName,
      categoryName: parsed.categoryName,
      parentId,
      place: parsed.place,
      priority: parsed.priority,
      date: parsed.date ?? defaultDate,
      time: parsed.time,
      endDate: parsed.endDate ?? parsed.date ?? defaultDate,
      endTime: parsed.endTime,
      allDay: parsed.allDay,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
    };
    update('', 0);
    await createTask(payload);
    setBusy(false);
    innerRef.current?.focus();
    onSubmitted?.();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
      return;
    }

    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        accept(activeIndex >= 0 ? activeIndex : 0);
        return;
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      // The user arrowed into the list, so Enter picks that row instead.
      if (open && activeIndex >= 0) accept(activeIndex);
      else void submit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (open) setDismissed(true);
      else update('', 0);
    }
  }

  const project = parsed.projectId ? projects.find((item) => item.id === parsed.projectId) : null;
  const category = parsed.categoryId ? categories.find((item) => item.id === parsed.categoryId) : null;

  return (
    <div className={`quick-add${compact ? ' quick-add--compact' : ''}`}>
      <div className="quick-add__row">
        <span className="quick-add__plus" aria-hidden="true">
          <FiPlus />
        </span>
        <input
          ref={attachRef}
          className="quick-add__input"
          value={value}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="quick-add-suggestions"
          onChange={(event) => update(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onBlur={() => setDismissed(true)}
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

      {open && (
        <ul className="suggest" id="quick-add-suggestions" role="listbox" ref={listRef}>
          {suggestions.map((suggestion, index) => {
            const showGroup = suggestion.group && suggestion.group !== suggestions[index - 1]?.group;
            return (
              <li key={`${suggestion.insert}-${index}`} role="none">
                {showGroup && <span className="suggest__group">{suggestion.group}</span>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  className={`suggest__item${index === activeIndex ? ' suggest__item--active' : ''}`}
                  // onMouseDown beats the input's blur, so the click registers.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    accept(index);
                  }}
                >
                  <span className="suggest__label">
                    {suggestion.color && <span className="dot" style={{ background: suggestion.color }} />}
                    {suggestion.label}
                  </span>
                  {suggestion.hint && <span className="suggest__hint">{suggestion.hint}</span>}
                  <span className="suggest__insert">{suggestion.insert}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hasContent && (
        <div className="quick-add__preview" aria-live="polite">
          <span className="chip chip--ghost">{parsed.title || <em>No title yet</em>}</span>
          {category && (
            <span className="chip">
              <span className="dot" style={{ background: category.color }} />
              {category.name}
            </span>
          )}
          {project && (
            <span className="chip">
              <span className="dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {parsed.place && (
            <span className="chip">
              <FiMapPin aria-hidden="true" /> @{parsed.place}
            </span>
          )}
          {parsed.date && (
            <span className="chip">
              <FiCalendar aria-hidden="true" /> {formatTaskRange(parsed.date, parsed.endDate)}
            </span>
          )}
          {parsed.time && (
            <span className="chip">
              <FiClock aria-hidden="true" /> {formatTime(parsed.time)}
              {parsed.endTime ? ` – ${formatTime(parsed.endTime)}` : ''}
            </span>
          )}
          {parsed.priority !== 4 && <span className={`chip chip--p${parsed.priority}`}>!{parsed.priority}</span>}
          {parsed.recurrence && (
            <span className="chip">
              <FiRepeat aria-hidden="true" /> {describeRecurrence(parsed.recurrence)}
            </span>
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
