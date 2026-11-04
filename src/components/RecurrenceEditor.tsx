/**
 * Recurrence pattern editor shared by the transaction form and recurring rules.
 * It only edits the rule shape; scheduling lives in `src/domain/recurring.ts`.
 */

import { useId } from 'react';

import { WEEKDAYS_MIN } from '../domain/date';
import { createRecurrence, describeRecurrence } from '../domain/recurrence';
import type { RecurrenceFreq, RecurrenceRule } from '../domain/types';

interface RecurrenceEditorProps {
  value: RecurrenceRule;
  /** Date the pattern is anchored to, used for defaults when the frequency changes. */
  startDate: string;
  onChange: (rule: RecurrenceRule) => void;
}

const FREQUENCIES: { value: RecurrenceFreq; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function RecurrenceEditor({ value, startDate, onChange }: RecurrenceEditorProps) {
  const dayId = useId();
  const intervalId = useId();
  const untilId = useId();
  const countId = useId();

  function changeFrequency(freq: RecurrenceFreq) {
    const base = createRecurrence(freq, startDate);
    onChange({
      ...base,
      interval: Math.max(1, value.interval),
      until: value.until,
      count: value.count,
    });
  }

  function toggleWeekday(day: number) {
    const has = value.byWeekday.includes(day);
    const byWeekday = has
      ? value.byWeekday.filter((item) => item !== day)
      : [...value.byWeekday, day].sort((a, b) => a - b);
    onChange({ ...value, byWeekday });
  }

  return (
    <div className="recurrence">
      <div className="field-row">
        <label className="field">
          <span className="field__label">Repeats</span>
          <select
            className="input"
            value={value.freq}
            onChange={(event) => changeFrequency(event.target.value as RecurrenceFreq)}
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency.value} value={frequency.value}>
                {frequency.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={intervalId}>
          <span className="field__label">Every</span>
          <input
            id={intervalId}
            className="input input--short"
            type="number"
            min={1}
            max={99}
            value={value.interval}
            onChange={(event) =>
              onChange({ ...value, interval: Math.max(1, Number(event.target.value) || 1) })
            }
            aria-label="Interval"
          />
        </label>
      </div>

      {value.freq === 'weekly' && (
        <fieldset className="weekday-picker">
          <legend className="field__label">On days</legend>
          <div className="weekday-picker__grid">
            {WEEKDAYS_MIN.map((day, index) => (
              <button
                key={day}
                type="button"
                className={`weekday-picker__day${
                  value.byWeekday.includes(index) ? ' weekday-picker__day--active' : ''
                }`}
                aria-pressed={value.byWeekday.includes(index)}
                onClick={() => toggleWeekday(index)}
              >
                {day}
              </button>
            ))}
          </div>
          {value.byWeekday.length === 0 && (
            <span className="field__hint">No days selected — the anchor date's weekday is used.</span>
          )}
        </fieldset>
      )}

      {(value.freq === 'monthly' || value.freq === 'yearly') && (
        <label className="field" htmlFor={dayId}>
          <span className="field__label">Day of month</span>
          <input
            id={dayId}
            className="input input--short"
            type="number"
            min={1}
            max={31}
            value={value.byMonthDay[0] ?? ''}
            onChange={(event) => {
              const day = Math.min(31, Math.max(1, Number(event.target.value) || 1));
              onChange({ ...value, byMonthDay: [day] });
            }}
          />
        </label>
      )}

      <div className="field-row">
        <label className="field" htmlFor={untilId}>
          <span className="field__label">Until</span>
          <input
            id={untilId}
            className="input"
            type="date"
            value={value.until ?? ''}
            onChange={(event) => onChange({ ...value, until: event.target.value || null })}
          />
        </label>
        <label className="field" htmlFor={countId}>
          <span className="field__label">Max times</span>
          <input
            id={countId}
            className="input input--short"
            type="number"
            min={1}
            max={999}
            value={value.count ?? ''}
            placeholder="No limit"
            onChange={(event) =>
              onChange({
                ...value,
                count: event.target.value ? Math.max(1, Number(event.target.value)) : null,
              })
            }
          />
        </label>
      </div>

      <p className="recurrence__summary">{describeRecurrence(value)}</p>
    </div>
  );
}
