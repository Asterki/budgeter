/** Calendar workspace: daily totals, actual rows and planned recurring items. */

import { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

import { QuickAdd } from '../components/QuickAdd';
import { TransactionRow } from '../components/TransactionRow';
import { useBudget } from '../state/store';
import {
  addDays,
  addMonths,
  formatDate,
  formatDateShort,
  monthLabel,
  monthMatrix,
  startOfMonth,
  todayISO,
} from '../domain/date';
import { formatMoney } from '../domain/money';
import { generatedCounts, plannedOccurrences } from '../domain/recurring';
import { rangeTotals } from '../domain/reports';
import type { Transaction } from '../domain/types';

interface CalendarViewProps {
  onOpenTransaction: (transaction: Transaction) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({ onOpenTransaction }: CalendarViewProps) {
  const { accounts, categories, payees, transactions, recurring, settings } = useBudget();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(today);

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const payeesById = useMemo(() => new Map(payees.map((payee) => [payee.id, payee])), [payees]);

  const grid = useMemo(() => monthMatrix(cursor), [cursor]);
  const gridStart = grid[0][0];
  const gridEnd = grid[5][6];

  const byDate = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const transaction of transactions) {
      const bucket = map.get(transaction.date);
      if (bucket) bucket.push(transaction);
      else map.set(transaction.date, [transaction]);
    }
    return map;
  }, [transactions]);

  const plannedByDate = useMemo(() => {
    const counts = generatedCounts(transactions);
    const map = new Map<string, { date: string; rule: (typeof recurring)[number] }[]>();
    for (const rule of recurring) {
      if (!rule.active || rule.type === 'transfer') continue;
      const dates = plannedOccurrences(
        rule,
        gridStart,
        gridEnd,
        counts.get(rule.id) ?? 0,
        62,
      );
      for (const date of dates) {
        if (date <= today) continue;
        const bucket = map.get(date) ?? [];
        bucket.push({ date, rule });
        map.set(date, bucket);
      }
    }
    return map;
  }, [recurring, transactions, gridStart, gridEnd, today]);

  const monthSummary = useMemo(
    () =>
      rangeTotals(transactions, {
        from: cursor,
        to: addDays(addMonths(cursor, 1), -1),
      }),
    [transactions, cursor],
  );

  const monthEnd = useMemo(() => addMonths(cursor, 1), [cursor]);

  const monthRows = useMemo(
    () => transactions.filter((transaction) => transaction.date >= cursor && transaction.date < monthEnd),
    [transactions, cursor, monthEnd],
  );

  const monthNet = monthRows.reduce(
    (total, transaction) => (transaction.type === 'transfer' ? total : total + transaction.amount),
    0,
  );

  function move(offset: number) {
    const next = startOfMonth(addMonths(cursor, offset));
    setCursor(next);
    setSelected(next);
  }

  function netFor(date: string): number {
    const rows = byDate.get(date) ?? [];
    return rows.reduce(
      (total, transaction) => (transaction.type === 'transfer' ? total : total + transaction.amount),
      0,
    );
  }

  const selectedRows = byDate.get(selected) ?? [];
  const selectedPlanned = plannedByDate.get(selected) ?? [];
  const selectedNet = selectedRows.reduce(
    (total, transaction) => (transaction.type === 'transfer' ? total : total + transaction.amount),
    0,
  );

  return (
    <section className="calendar">
      <div className="calendar__head">
        <div>
          <h1 className="calendar__title">Calendar</h1>
          <p className="calendar__summary">
            {monthLabel(cursor)} · in{' '}
            <span className="amount--in">
              {formatMoney(monthSummary.income, settings.currency, settings.locale)}
            </span>{' '}
            · out{' '}
            <span className="amount--out">
              {formatMoney(monthSummary.expense, settings.currency, settings.locale)}
            </span>{' '}
            · net{' '}
            <strong>{formatMoney(monthNet, settings.currency, settings.locale)}</strong>
          </p>
        </div>
        <div className="calendar__nav">
          <button
            type="button"
            className="button button--ghost button--icon"
            onClick={() => move(-1)}
            aria-label="Previous month"
          >
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="button button--ghost" onClick={() => move(0)}>
            {monthLabel(cursor)}
          </button>
          <button
            type="button"
            className="button button--ghost button--icon"
            onClick={() => move(1)}
            aria-label="Next month"
          >
            <FiChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setCursor(startOfMonth(today));
              setSelected(today);
            }}
          >
            Today
          </button>
        </div>
      </div>

      <div className="calendar__grid-wrap">
        <div className="calendar__weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar__grid" role="grid" aria-label={`${monthLabel(cursor)} calendar`}>
          {grid.map((week) =>
            week.map((date) => {
              const actual = byDate.get(date)?.length ?? 0;
              const planned = plannedByDate.get(date)?.length ?? 0;
              const net = netFor(date);
              const inMonth = date.slice(0, 7) === cursor.slice(0, 7);
              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    'calendar__cell',
                    inMonth ? '' : 'calendar__cell--outside',
                    date === today ? 'calendar__cell--today' : '',
                    date === selected ? 'calendar__cell--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelected(date)}
                  aria-pressed={date === selected}
                  aria-label={`${formatDate(date)}: ${actual} transactions, ${planned} planned`}
                >
                  <span className="calendar__day">{Number(date.slice(8, 10))}</span>
                  {net !== 0 && (
                    <span className={`calendar__net ${net > 0 ? 'amount--in' : 'amount--out'}`}>
                      {formatMoney(net, settings.currency, settings.locale)}
                    </span>
                  )}
                  <span className="calendar__dots" aria-hidden="true">
                    {Array.from({ length: Math.min(3, actual) }).map((_, index) => (
                      <span key={`a${index}`} className="calendar__dot" />
                    ))}
                    {Array.from({ length: Math.min(2, planned) }).map((_, index) => (
                      <span key={`p${index}`} className="calendar__dot calendar__dot--planned" />
                    ))}
                    {actual + planned > 5 && <span className="calendar__more">+</span>}
                  </span>
                </button>
              );
            }),
          )}
        </div>
      </div>

      <section className="calendar__day-panel" aria-label={`Transactions on ${formatDate(selected)}`}>
        <header className="calendar__day-head">
          <div>
            <h2 className="calendar__day-title">
              {selected === today ? 'Today' : formatDateShort(selected)}
            </h2>
            <p className="calendar__day-sub">{formatDate(selected)}</p>
          </div>
          <span className={`calendar__day-total ${selectedNet > 0 ? 'amount--in' : selectedNet < 0 ? 'amount--out' : ''}`}>
            {formatMoney(selectedNet, settings.currency, settings.locale)}
          </span>
        </header>

        <QuickAdd defaultDate={selected} />

        {selectedRows.length === 0 && selectedPlanned.length === 0 ? (
          <p className="calendar__empty">No transactions on this day.</p>
        ) : (
          <div className="calendar__rows">
            {selectedRows.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                account={accountsById.get(transaction.accountId)}
                category={
                  transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined
                }
                payee={transaction.payeeId ? payeesById.get(transaction.payeeId) : undefined}
                transferAccount={
                  transaction.transferAccountId
                    ? accountsById.get(transaction.transferAccountId)
                    : undefined
                }
                currency={settings.currency}
                locale={settings.locale}
                showAccount
                onOpen={() => onOpenTransaction(transaction)}
              />
            ))}
            {selectedPlanned.map(({ date, rule }) => {
              const category = rule.categoryId ? categoriesById.get(rule.categoryId) : undefined;
              const payee = rule.payeeId ? payeesById.get(rule.payeeId) : undefined;
              return (
                <div key={`${rule.id}-${date}`} className="tx-row tx-row--planned">
                  <span
                    className="tx-row__marker tx-row__marker--planned"
                    style={{ background: category?.color ?? accountsById.get(rule.accountId)?.color }}
                    aria-hidden="true"
                  />
                  <span className="tx-row__main">
                    <span className="tx-row__title">
                      {payee?.name || rule.notes.trim() || category?.name || 'Scheduled'}
                    </span>
                    <span className="tx-row__meta">
                      <span className="tx-row__chip">Planned</span>
                      <span className="tx-row__chip">Recurring</span>
                      {category && <span className="tx-row__chip">{category.name}</span>}
                    </span>
                  </span>
                  <span className="tx-row__side">
                    <span
                      className={`tx-row__amount ${rule.amount > 0 ? 'tx-row__amount--in' : 'tx-row__amount--out'}`}
                    >
                      {formatMoney(rule.amount, settings.currency, settings.locale)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
