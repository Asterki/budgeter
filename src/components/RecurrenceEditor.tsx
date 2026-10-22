/**
 * Recurrence editor: simple cycles plus custom patterns
 * (multi-week intervals, weekday picks, day-of-month, end date, count).
 */

import type { RecurrenceFreq, RecurrenceRule } from '../domain/types';
import { WEEKDAYS_MIN, todayISO } from '../domain/date';
import { createRecurrence, describeRecurrence } from '../domain/recurrence';

interface RecurrenceEditorProps {
  value: RecurrenceRule | null;
  dateISO: string | null;
  onChange: (rule: RecurrenceRule | null) => void;
}

export function RecurrenceEditor({ value, dateISO, onChange }: RecurrenceEditorProps) {
  const anchor = dateISO ?? todayISO();

  function selectFreq(freq: string) {
    if (!freq) {
      onChange(null);
      return;
    }
    const base = createRecurrence(freq as RecurrenceFreq, anchor);
    onChange(value ? { ...value, freq: base.freq, byWeekday: base.byWeekday, byMonthDay: base.byMonthDay } : base);
  }

  function patch(partial: Partial<RecurrenceRule>) {
    if (!value) return;
    onChange({ ...value, ...partial });
  }

  function toggleWeekday(day: number) {
    if (!value) return;
    const has = value.byWeekday.includes(day);
    const byWeekday = has
      ? value.byWeekday.filter((d) => d !== day)
      : [...value.byWeekday, day].sort((a, b) => a - b);
    patch({ byWeekday });
  }

  return (
    <div className="recurrence">
      <label className="field">
        <span className="field__label">Repeat</span>
        <select
          className="input"
          value={value?.freq ?? ''}
          onChange={(event) => selectFreq(event.target.value)}
        >
          <option value="">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>

      {value && (
        <>
          <div className="recurrence__row">
            <label className="field field--inline">
              <span className="field__label">Every</span>
              <input
                className="input input--num"
                type="number"
                min={1}
                max={99}
                value={value.interval}
                onChange={(event) => patch({ interval: Math.max(1, Number(event.target.value) || 1) })}
              />
              <span className="field__suffix">
                {value.freq === 'daily' && 'day(s)'}
                {value.freq === 'weekly' && 'week(s)'}
                {value.freq === 'monthly' && 'month(s)'}
                {value.freq === 'yearly' && 'year(s)'}
              </span>
            </label>
          </div>

          {value.freq === 'weekly' && (
            <div className="field">
              <span className="field__label">On days</span>
              <div className="weekday-picker">
                {WEEKDAYS_MIN.map((label, index) => (
                  <button
                    key={`${label}-${index}`}
                    type="button"
                    className={`weekday${value.byWeekday.includes(index) ? ' weekday--active' : ''}`}
                    onClick={() => toggleWeekday(index)}
                    aria-pressed={value.byWeekday.includes(index)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(value.freq === 'monthly' || value.freq === 'yearly') && (
            <label className="field">
              <span className="field__label">Day of month</span>
              <input
                className="input input--num"
                type="number"
                min={1}
                max={31}
                value={value.byMonthDay[0] ?? ''}
                onChange={(event) => patch({ byMonthDay: [Number(event.target.value) || 1] })}
              />
            </label>
          )}

          <div className="recurrence__row">
            <label className="field">
              <span className="field__label">Until</span>
              <input
                className="input"
                type="date"
                value={value.until ?? ''}
                onChange={(event) => patch({ until: event.target.value || null })}
              />
            </label>
            <label className="field">
              <span className="field__label">Max times</span>
              <input
                className="input input--num"
                type="number"
                min={1}
                placeholder="∞"
                value={value.count ?? ''}
                onChange={(event) =>
                  patch({ count: event.target.value ? Math.max(1, Number(event.target.value)) : null })
                }
              />
            </label>
          </div>

          <p className="recurrence__summary">🔁 {describeRecurrence(value)}</p>
        </>
      )}
    </div>
  );
}
