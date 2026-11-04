/** Forecast workspace: projected balances from real money plus planned rules. */

import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiTrendingDown, FiTrendingUp } from 'react-icons/fi';

import { useBudget } from '../state/store';
import { addDays, formatDate, formatDateShort, todayISO } from '../domain/date';
import { formatMoney } from '../domain/money';
import {
  DEFAULT_FORECAST_DAYS,
  forecastAccounts,
  forecastTotal,
  negativeDays,
} from '../domain/forecast';

const WIDTH = 820;
const HEIGHT = 260;
const PAD = { top: 18, right: 16, bottom: 26, left: 82 };

export function ForecastView() {
  const { accounts, transactions, recurring, settings } = useBudget();
  const today = todayISO();
  const [days, setDays] = useState(DEFAULT_FORECAST_DAYS);

  const forecasts = useMemo(
    () => forecastAccounts(accounts, transactions, recurring, today, days),
    [accounts, transactions, recurring, today, days],
  );
  const points = useMemo(() => forecastTotal(forecasts), [forecasts]);
  const warnings = useMemo(() => negativeDays(forecasts), [forecasts]);

  const values = points.map((point) => point.balance);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (points.length > 1 ? (index / (points.length - 1)) * innerW : innerW / 2);
  const y = (value: number) => PAD.top + ((max - value) / span) * innerH;

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.balance).toFixed(1)}`)
    .join(' ');

  const zeroY = y(0);
  const ticks = [0, 1, 2, 3].map((step) => max - (span * step) / 3);
  const labelIndexes = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((ratio) => Math.round(ratio * Math.max(0, points.length - 1)))
    .filter((value, index, list) => list.indexOf(value) === index);

  const startTotal = points[0]?.balance ?? 0;
  const endTotal = points[points.length - 1]?.balance ?? 0;
  const lowest = points.reduce(
    (low, point) => (point.balance < low.balance ? point : low),
    points[0] ?? { date: today, balance: 0, change: 0 },
  );

  if (accounts.filter((account) => !account.archived).length === 0) {
    return (
      <section className="forecast">
        <div className="empty-state">
          <h1>Nothing to forecast</h1>
          <p>Add an account and a starting balance to project the next few months.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="forecast">
      <div className="forecast__head">
        <div>
          <h1 className="forecast__title">Forecast</h1>
          <p className="forecast__summary">
            {formatMoney(startTotal, settings.currency, settings.locale)} today →{' '}
            <strong>{formatMoney(endTotal, settings.currency, settings.locale)}</strong> in {days} days
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Forecast horizon">
          {[60, 90].map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__item${days === value ? ' segmented__item--active' : ''}`}
              onClick={() => setDays(value)}
              aria-pressed={days === value}
            >
              {value} days
            </button>
          ))}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="forecast__warning" role="status">
          <FiAlertTriangle aria-hidden="true" />
          <div>
            <strong>
              {warnings.length} day{warnings.length === 1 ? '' : 's'} below zero
            </strong>
            <p>
              {warnings
                .slice(0, 5)
                .map((day) => `${formatDateShort(day.date)} (${day.accounts.join(', ')})`)
                .join(' · ')}
              {warnings.length > 5 ? ` · +${warnings.length - 5} more` : ''}
            </p>
          </div>
        </div>
      ) : (
        <div className="forecast__note" role="status">
          <FiTrendingUp aria-hidden="true" />
          Every active account stays above zero for the next {days} days.
        </div>
      )}

      <div className="chart-card">
        <div className="chart-card__head">
          <h2>Projected net worth</h2>
          <p>
            Lowest point {formatMoney(lowest.balance, settings.currency, settings.locale)} on{' '}
            {formatDate(lowest.date)}
          </p>
        </div>
        <svg
          className="chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Projected net worth for the next ${days} days, from ${formatMoney(startTotal, settings.currency, settings.locale)} to ${formatMoney(endTotal, settings.currency, settings.locale)}.`}
        >
          <title>Projected net worth</title>
          <desc>
            A line from {formatMoney(startTotal, settings.currency, settings.locale)} today to{' '}
            {formatMoney(endTotal, settings.currency, settings.locale)} in {days} days. The lowest
            projected point is {formatMoney(lowest.balance, settings.currency, settings.locale)} on{' '}
            {formatDate(lowest.date)}.
          </desc>
          {ticks.map((tick, index) => (
            <g key={index}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                className="chart__grid"
              />
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="chart__axis">
                {formatMoney(Math.round(tick), settings.currency, settings.locale)}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={zeroY}
            y2={zeroY}
            className="chart__zero"
          />
          <path d={line} className="chart__line chart__line--primary" />
          {lowest.balance < 0 && (
            <circle
              cx={x(points.indexOf(lowest))}
              cy={y(lowest.balance)}
              r={4}
              className="chart__point chart__point--danger"
            />
          )}
          {labelIndexes.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="chart__axis"
            >
              {formatDateShort(points[index].date)}
            </text>
          ))}
        </svg>

        <details className="chart-table">
          <summary>View as table</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Projected balance</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {points
                .filter((_, index) => index % 7 === 0 || index === points.length - 1)
                .map((point) => (
                  <tr key={point.date}>
                    <td>{formatDate(point.date)}</td>
                    <td>{formatMoney(point.balance, settings.currency, settings.locale)}</td>
                    <td>{formatMoney(point.change, settings.currency, settings.locale)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </div>

      <div className="forecast__accounts">
        {forecasts.map((forecast) => (
          <article key={forecast.accountId} className="forecast-card">
            <header className="forecast-card__head">
              <span className="forecast-card__dot" style={{ background: forecast.color }} aria-hidden="true" />
              <h2>{forecast.name}</h2>
              <span
                className={`forecast-card__delta ${forecast.end >= forecast.start ? 'amount--in' : 'amount--out'}`}
              >
                {forecast.end >= forecast.start ? <FiTrendingUp aria-hidden="true" /> : <FiTrendingDown aria-hidden="true" />}
                {formatMoney(forecast.end - forecast.start, settings.currency, settings.locale)}
              </span>
            </header>
            <dl className="forecast-card__stats">
              <div>
                <dt>Today</dt>
                <dd>{formatMoney(forecast.start, settings.currency, settings.locale)}</dd>
              </div>
              <div>
                <dt>In {days} days</dt>
                <dd>{formatMoney(forecast.end, settings.currency, settings.locale)}</dd>
              </div>
              <div>
                <dt>Low point</dt>
                <dd>
                  {formatMoney(forecast.low, settings.currency, settings.locale)}
                  <small> {formatDateShort(forecast.lowDate)}</small>
                </dd>
              </div>
            </dl>
            {forecast.negativeDates.length > 0 && (
              <p className="forecast-card__warning">
                <FiAlertTriangle aria-hidden="true" />
                Goes negative on {formatDateShort(forecast.negativeDates[0])} and{' '}
                {forecast.negativeDates.length - 1} more day
                {forecast.negativeDates.length - 1 === 1 ? '' : 's'}.
              </p>
            )}
            <p className="forecast-card__hint">
              Projection starts {formatDate(addDays(today, 1))} and uses active recurring rules only.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
