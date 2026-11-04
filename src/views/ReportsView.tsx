/** Reports workspace: range presets, SVG charts and table fallbacks. */

import { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

import { useBudget } from '../state/store';
import {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  formatDateShort,
  startOfMonth,
  todayISO,
} from '../domain/date';
import { formatMoney } from '../domain/money';
import {
  bucketFor,
  categoryTrends,
  netWorthSeries,
  periodSeries,
  previousRange,
  rangeTotals,
  resolveRange,
  spendingByCategory,
  topPayees,
  type ReportRange,
  type ReportRangeKind,
} from '../domain/reports';

const WIDTH = 820;
const HEIGHT = 230;
const PAD = { top: 18, right: 16, bottom: 30, left: 82 };

const KINDS: { kind: ReportRangeKind; label: string }[] = [
  { kind: 'month', label: 'Month' },
  { kind: 'quarter', label: 'Quarter' },
  { kind: 'year', label: 'Year' },
  { kind: 'custom', label: 'Custom' },
];

export function ReportsView() {
  const { accounts, categories, payees, transactions, settings } = useBudget();
  const today = todayISO();
  const [kind, setKind] = useState<ReportRangeKind>('month');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState<ReportRange>(() => ({
    from: startOfMonth(today),
    to: today,
  }));

  const range = useMemo(
    () => resolveRange(kind, anchor, custom),
    [kind, anchor, custom],
  );
  const before = useMemo(() => previousRange(range), [range]);
  const bucket = useMemo(() => bucketFor(range), [range]);

  const totals = useMemo(() => rangeTotals(transactions, range), [transactions, range]);
  const periodCount = useMemo(
    () =>
      transactions.filter(
        (transaction) => transaction.type !== 'transfer' && transaction.date >= range.from && transaction.date <= range.to,
      ).length,
    [transactions, range],
  );
  const previousTotals = useMemo(
    () => rangeTotals(transactions, before),
    [transactions, before],
  );
  const slices = useMemo(
    () => spendingByCategory(transactions, categories, range),
    [transactions, categories, range],
  );
  const series = useMemo(
    () => periodSeries(transactions, range, bucket),
    [transactions, range, bucket],
  );
  const worth = useMemo(
    () => netWorthSeries(accounts, transactions, range, bucket),
    [accounts, transactions, range, bucket],
  );
  const largestPayees = useMemo(
    () => topPayees(transactions, payees, range, 6),
    [transactions, payees, range],
  );
  const trends = useMemo(
    () => categoryTrends(transactions, categories, range),
    [transactions, categories, range],
  );

  const money = (cents: number) => formatMoney(cents, settings.currency, settings.locale);
  const percent = (ratio: number) => {
    try {
      return new Intl.NumberFormat(settings.locale, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(ratio);
    } catch {
      return `${(ratio * 100).toFixed(1)}%`;
    }
  };
  const signedPercent = (value: number | null) =>
    value === null ? 'New' : `${value > 0 ? '+' : ''}${percent(value / 100)}`;

  function shift(offset: number) {
    if (kind === 'month') setAnchor(addMonths(anchor, offset));
    else if (kind === 'quarter') setAnchor(addMonths(anchor, offset * 3));
    else if (kind === 'year') setAnchor(addMonths(anchor, offset * 12));
    else {
      const span = Math.max(1, daysBetween(range.from, range.to) + 1);
      setCustom({
        from: addDays(range.from, offset * span),
        to: addDays(range.to, offset * span),
      });
    }
  }

  const spendTotal = slices.reduce((sum, slice) => sum + slice.total, 0);
  const maxSpend = Math.max(1, ...series.map((point) => point.expense));
  const maxFlow = Math.max(1, ...series.map((point) => Math.max(point.income, point.expense)));
  const maxPayee = Math.max(1, ...largestPayees.map((payee) => payee.total));

  return (
    <section className="reports">
      <div className="reports__head">
        <div>
          <h1 className="reports__title">Reports</h1>
          <p className="reports__summary">
            {formatDate(range.from)} – {formatDate(range.to)} · compared with{' '}
            {formatDateShort(before.from)} – {formatDateShort(before.to)}
          </p>
        </div>
        <div className="reports__controls">
          <div className="segmented" role="group" aria-label="Report range">
            {KINDS.map((item) => (
              <button
                key={item.kind}
                type="button"
                className={`segmented__item${kind === item.kind ? ' segmented__item--active' : ''}`}
                onClick={() => setKind(item.kind)}
                aria-pressed={kind === item.kind}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="reports__period">
            <button
              type="button"
              className="button button--ghost button--icon"
              onClick={() => shift(-1)}
              aria-label="Previous period"
            >
              <FiChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setAnchor(today);
                setCustom({ from: startOfMonth(today), to: today });
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="button button--ghost button--icon"
              onClick={() => shift(1)}
              aria-label="Next period"
            >
              <FiChevronRight aria-hidden="true" />
            </button>
          </div>
          {kind === 'custom' && (
            <div className="reports__dates">
              <label className="field">
                <span>From</span>
                <input
                  className="input"
                  type="date"
                  value={custom.from}
                  max={custom.to}
                  onChange={(event) => setCustom((prev) => ({ ...prev, from: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>To</span>
                <input
                  className="input"
                  type="date"
                  value={custom.to}
                  min={custom.from}
                  onChange={(event) => setCustom((prev) => ({ ...prev, to: event.target.value }))}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="reports__cards">
        <article className="report-card">
          <span>Income</span>
          <strong className="amount--in">{money(totals.income)}</strong>
          <small>
            {signedPercent(
              previousTotals.income > 0
                ? ((totals.income - previousTotals.income) / previousTotals.income) * 100
                : null,
            )}{' '}
            vs previous
          </small>
        </article>
        <article className="report-card">
          <span>Spending</span>
          <strong className="amount--out">{money(totals.expense)}</strong>
          <small>
            {signedPercent(
              previousTotals.expense > 0
                ? ((totals.expense - previousTotals.expense) / previousTotals.expense) * 100
                : null,
            )}{' '}
            vs previous
          </small>
        </article>
        <article className="report-card">
          <span>Net</span>
          <strong className={totals.net >= 0 ? 'amount--in' : 'amount--out'}>{money(totals.net)}</strong>
          <small>{totals.income > 0 ? `${percent(totals.savingsRate)} saved` : 'No income recorded'}</small>
        </article>
        <article className="report-card">
          <span>Transactions</span>
          <strong>{periodCount}</strong>
          <small>in this period</small>
        </article>
      </div>

      <div className="reports__grid">
        <article className="chart-card">
          <div className="chart-card__head">
            <h2>Spending by category</h2>
            <p>{money(spendTotal)} across {slices.length} categories</p>
          </div>
          {slices.length === 0 ? (
            <p className="chart-empty">No spending in this period.</p>
          ) : (
            <div className="donut">
              <svg
                className="donut__svg"
                viewBox="0 0 180 180"
                role="img"
                aria-label={`Spending by category: ${slices
                  .map((slice) => `${slice.name} ${percent(slice.total / spendTotal)}`)
                  .join(', ')}`}
              >
                <title>Spending by category</title>
                <circle cx="90" cy="90" r="62" fill="none" stroke="var(--surface-variant)" strokeWidth="20" />
                {slices.map((slice, index) => {
                  const share = slice.total / spendTotal;
                  const circumference = 2 * Math.PI * 62;
                  const length = share * circumference;
                  const offset = slices
                    .slice(0, index)
                    .reduce((sum, item) => sum + (item.total / spendTotal) * circumference, 0);
                  return (
                    <circle
                      key={slice.categoryId ?? 'uncategorized'}
                      cx="90"
                      cy="90"
                      r="62"
                      fill="none"
                      stroke={slice.color}
                      strokeWidth="20"
                      strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 90 90)"
                    >
                      <title>{`${slice.name}: ${money(slice.total)} (${percent(share)})`}</title>
                    </circle>
                  );
                })}
                <text x="90" y="86" textAnchor="middle" className="donut__total">
                  {money(spendTotal)}
                </text>
                <text x="90" y="104" textAnchor="middle" className="donut__label">
                  spent
                </text>
              </svg>
              <ul className="donut__legend">
                {slices.map((slice) => (
                  <li key={slice.categoryId ?? 'uncategorized'}>
                    <span className="donut__dot" style={{ background: slice.color }} aria-hidden="true" />
                    <span className="donut__name">{slice.name}</span>
                    <span className="donut__amount">{money(slice.total)}</span>
                    <span className="donut__share">{percent(slice.total / spendTotal)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {slices.length > 0 && (
            <details className="chart-table">
              <summary>View as table</summary>
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Spent</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {slices.map((slice) => (
                    <tr key={slice.categoryId ?? 'uncategorized'}>
                      <td>{slice.name}</td>
                      <td>{money(slice.total)}</td>
                      <td>{percent(slice.total / spendTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h2>Spending over time</h2>
            <p>Bars show money out, grouped by {bucket}</p>
          </div>
          {series.length === 0 ? (
            <p className="chart-empty">No spending in this period.</p>
          ) : (
            <svg
              className="chart"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={`Spending over time from ${formatDate(range.from)} to ${formatDate(range.to)}, highest bucket ${money(maxSpend)}.`}
            >
              <title>Spending over time</title>
              {[0, 1, 2, 3].map((step) => {
                const value = maxSpend - (maxSpend * step) / 3;
                const y = PAD.top + (step / 3) * (HEIGHT - PAD.top - PAD.bottom);
                return (
                  <g key={step}>
                    <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart__grid" />
                    <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="chart__axis">
                      {money(Math.round(value))}
                    </text>
                  </g>
                );
              })}
              {series.map((point, index) => {
                const innerW = WIDTH - PAD.left - PAD.right;
                const slot = innerW / series.length;
                const barW = Math.max(2, slot * 0.56);
                const height = ((point.expense / maxSpend) * (HEIGHT - PAD.top - PAD.bottom)) || 0;
                return (
                  <rect
                    key={point.key}
                    x={PAD.left + slot * index + (slot - barW) / 2}
                    y={HEIGHT - PAD.bottom - height}
                    width={barW}
                    height={height}
                    rx="2"
                    className="chart__bar chart__bar--expense"
                  >
                    <title>{`${point.label}: ${money(point.expense)}`}</title>
                  </rect>
                );
              })}
              {series.map((point, index) =>
                index % Math.ceil(series.length / 6) === 0 ? (
                  <text
                    key={`label-${point.key}`}
                    x={PAD.left + ((WIDTH - PAD.left - PAD.right) / series.length) * (index + 0.5)}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    className="chart__axis"
                  >
                    {point.label}
                  </text>
                ) : null,
              )}
            </svg>
          )}
          {series.length > 0 && (
            <details className="chart-table">
              <summary>View as table</summary>
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Spending</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((point) => (
                    <tr key={point.key}>
                      <td>{point.label}</td>
                      <td>{money(point.expense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h2>Income vs expense</h2>
            <p>Green is money in, red is money out</p>
          </div>
          <svg
            className="chart"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`Income versus expense for ${formatDate(range.from)} to ${formatDate(range.to)}. Income ${money(totals.income)}, spending ${money(totals.expense)}.`}
          >
            <title>Income versus expense</title>
            {[0, 1, 2, 3].map((step) => {
              const value = maxFlow - (maxFlow * step) / 3;
              const y = PAD.top + (step / 3) * (HEIGHT - PAD.top - PAD.bottom);
              return (
                <g key={step}>
                  <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart__grid" />
                  <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="chart__axis">
                    {money(Math.round(value))}
                  </text>
                </g>
              );
            })}
            {series.map((point, index) => {
              const innerW = WIDTH - PAD.left - PAD.right;
              const slot = innerW / series.length;
              const barW = Math.max(1.5, slot * 0.3);
              const scale = HEIGHT - PAD.top - PAD.bottom;
              const incomeHeight = (point.income / maxFlow) * scale;
              const expenseHeight = (point.expense / maxFlow) * scale;
              return (
                <g key={point.key}>
                  <rect
                    x={PAD.left + slot * index + slot * 0.14}
                    y={HEIGHT - PAD.bottom - incomeHeight}
                    width={barW}
                    height={incomeHeight}
                    rx="2"
                    className="chart__bar chart__bar--income"
                  >
                    <title>{`${point.label} income: ${money(point.income)}`}</title>
                  </rect>
                  <rect
                    x={PAD.left + slot * index + slot * 0.14 + barW}
                    y={HEIGHT - PAD.bottom - expenseHeight}
                    width={barW}
                    height={expenseHeight}
                    rx="2"
                    className="chart__bar chart__bar--expense"
                  >
                    <title>{`${point.label} spending: ${money(point.expense)}`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
          <ul className="chart-legend">
            <li>
              <span className="chart-legend__swatch chart-legend__swatch--income" aria-hidden="true" />
              Income
            </li>
            <li>
              <span className="chart-legend__swatch chart-legend__swatch--expense" aria-hidden="true" />
              Spending
            </li>
          </ul>
          <details className="chart-table">
            <summary>View as table</summary>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Income</th>
                  <th>Spending</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.key}>
                    <td>{point.label}</td>
                    <td>{money(point.income)}</td>
                    <td>{money(point.expense)}</td>
                    <td>{money(point.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h2>Net worth over time</h2>
            <p>{money(totals.net)} net change this period</p>
          </div>
          {worth.length === 0 ? (
            <p className="chart-empty">No accounts yet.</p>
          ) : (
            <NetWorthChart points={worth} currency={settings.currency} locale={settings.locale} />
          )}
          {worth.length > 0 && (
            <details className="chart-table">
              <summary>View as table</summary>
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Net worth</th>
                  </tr>
                </thead>
                <tbody>
                  {worth.map((point) => (
                    <tr key={point.key}>
                      <td>{point.label}</td>
                      <td>{money(point.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h2>Top payees</h2>
            <p>Largest recipients in this period</p>
          </div>
          {largestPayees.length === 0 ? (
            <p className="chart-empty">No payee spending in this period.</p>
          ) : (
            <ul className="payee-bars">
              {largestPayees.map((payee) => (
                <li key={payee.payeeId}>
                  <span className="payee-bars__name">{payee.name}</span>
                  <span className="payee-bars__track" aria-hidden="true">
                    <span
                      className="payee-bars__fill"
                      style={{ width: `${(payee.total / maxPayee) * 100}%` }}
                    />
                  </span>
                  <span className="payee-bars__amount">{money(payee.total)}</span>
                  <span className="payee-bars__count">{payee.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="chart-card chart-card--wide">
          <div className="chart-card__head">
            <h2>Category trend</h2>
            <p>Change against the previous {kind === 'custom' ? 'period' : kind}</p>
          </div>
          {trends.length === 0 ? (
            <p className="chart-empty">No category spending to compare.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Current</th>
                    <th>Previous</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((row) => (
                    <tr key={row.categoryId ?? 'uncategorized'}>
                      <td>
                        <span className="table-dot" style={{ background: row.color }} aria-hidden="true" />
                        {row.name}
                      </td>
                      <td>{money(row.current)}</td>
                      <td>{money(row.previous)}</td>
                      <td className={row.delta > 0 ? 'amount--out' : row.delta < 0 ? 'amount--in' : ''}>
                        {row.changePct === null ? 'New' : `${row.delta > 0 ? '+' : ''}${percent(row.changePct / 100)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

interface NetWorthChartProps {
  points: { key: string; label: string; value: number }[];
  currency: string;
  locale: string;
}

function NetWorthChart({ points, currency, locale }: NetWorthChartProps) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (points.length > 1 ? (index / (points.length - 1)) * innerW : innerW / 2);
  const y = (value: number) => PAD.top + ((max - value) / span) * innerH;
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Net worth from ${formatMoney(points[0].value, currency, locale)} to ${formatMoney(points[points.length - 1].value, currency, locale)}.`}
    >
      <title>Net worth over time</title>
      {[0, 1, 2, 3].map((step) => {
        const value = max - (span * step) / 3;
        const tickY = PAD.top + (step / 3) * innerH;
        return (
          <g key={step}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={tickY} y2={tickY} className="chart__grid" />
            <text x={PAD.left - 8} y={tickY + 4} textAnchor="end" className="chart__axis">
              {formatMoney(Math.round(value), currency, locale)}
            </text>
          </g>
        );
      })}
      <path d={line} className="chart__line chart__line--accent" />
      {points.map((point, index) =>
        index % Math.ceil(points.length / 6) === 0 ? (
          <text
            key={point.key}
            x={x(index)}
            y={HEIGHT - 8}
            textAnchor="middle"
            className="chart__axis"
          >
            {point.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
