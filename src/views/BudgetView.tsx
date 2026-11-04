/** Budget workspace: monthly limits per category, grouped by envelope. */

import { useEffect, useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiCopy, FiTrendingUp } from 'react-icons/fi';

import { useBudget } from '../state/store';
import {
  averageSpending,
  budgetStatus,
  currentMonth,
  monthSummary,
  nextMonth,
  previousMonth,
} from '../domain/budget';
import { formatMoney, parseAmount } from '../domain/money';
import { monthLabel, todayISO } from '../domain/date';
import type { Budget, Category } from '../domain/types';

interface BudgetViewProps {
  onOpenCategory: (categoryId: string, month: string) => void;
}

interface BudgetRowProps {
  category: Category;
  month: string;
  budget: Budget | undefined;
  status: ReturnType<typeof budgetStatus>;
  currency: string;
  locale: string;
  onSetLimit: (categoryId: string, month: string, limit: number) => void;
  onSetRollover: (categoryId: string, month: string, rollover: boolean) => void;
  onOpen: () => void;
}

function BudgetRow({
  category,
  month,
  budget,
  status,
  currency,
  locale,
  onSetLimit,
  onSetRollover,
  onOpen,
}: BudgetRowProps) {
  const [draft, setDraft] = useState(budget ? (budget.limit / 100).toFixed(2) : '');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(budget ? (budget.limit / 100).toFixed(2) : '');
  }, [budget, editing]);

  function commit() {
    setEditing(false);
    const parsed = parseAmount(draft, locale);
    const limit = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setDraft(limit === 0 ? '' : (limit / 100).toFixed(2));
    if (!budget || limit !== budget.limit) onSetLimit(category.id, month, limit);
  }

  const width = Math.min(100, Math.max(0, status.pct));
  const tone = status.overspent ? 'over' : status.pct >= 80 ? 'warn' : 'ok';

  return (
    <div className="budget-row">
      <div className="budget-row__main">
        <div className="budget-row__title">
          <button
            type="button"
            className="budget-row__link"
            onClick={onOpen}
            title={`Show ${category.name} transactions for this month`}
          >
            <span className="budget-row__dot" style={{ background: category.color }} aria-hidden="true" />
            {category.name}
          </button>
          {status.rolloverIn !== 0 && (
            <span className={`chip chip--${status.rolloverIn < 0 ? 'error' : 'default'}`}>
              {status.rolloverIn > 0 ? 'Rollover in ' : 'Overspend carried '}
              {formatMoney(Math.abs(status.rolloverIn), currency, locale)}
            </span>
          )}
        </div>

        <div className="budget-row__bar" aria-hidden="true">
          <span className={`budget-row__fill budget-row__fill--${tone}`} style={{ width: `${width}%` }} />
        </div>

        <p className="budget-row__meta">
          <span>{formatMoney(status.spent, currency, locale)} spent</span>
          <span className={status.remaining < 0 ? 'amount--out' : 'amount--in'}>
            {status.remaining < 0 ? 'over by ' : 'left '}
            {formatMoney(Math.abs(status.remaining), currency, locale)}
          </span>
        </p>
      </div>

      <div className="budget-row__controls">
        <label className="field budget-row__limit">
          <span className="field__label">Limit</span>
          <input
            className="input input--amount"
            inputMode="decimal"
            value={draft}
            placeholder="0.00"
            aria-label={`${category.name} monthly limit`}
            onFocus={() => setEditing(true)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                setEditing(false);
                setDraft(budget ? (budget.limit / 100).toFixed(2) : '');
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label className="budget-row__rollover" title="Carry the remaining amount into next month">
          <input
            type="checkbox"
            checked={budget?.rollover ?? false}
            onChange={(event) => onSetRollover(category.id, month, event.target.checked)}
          />
          <span>Roll over</span>
        </label>
      </div>
    </div>
  );
}

export function BudgetView({ onOpenCategory }: BudgetViewProps) {
  const { categories, categoryGroups, budgets, transactions, settings, setBudget, copyBudgets } = useBudget();
  const [month, setMonth] = useState(() => currentMonth(todayISO()));
  const [notice, setNotice] = useState('');

  const summary = useMemo(
    () => monthSummary(month, transactions, budgets, categories),
    [month, transactions, budgets, categories],
  );

  const expenseCategories = useMemo(
    () =>
      categories
        .filter((category) => category.kind === 'expense' && !category.archived)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [categories],
  );

  const grouped = useMemo(() => {
    const groups: { id: string; name: string; categories: Category[] }[] = [];
    for (const group of [...categoryGroups].sort((a, b) => a.order - b.order)) {
      const items = expenseCategories.filter((category) => category.groupId === group.id);
      if (items.length > 0) groups.push({ id: group.id, name: group.name, categories: items });
    }
    const loose = expenseCategories.filter(
      (category) => !category.groupId || !categoryGroups.some((group) => group.id === category.groupId),
    );
    if (loose.length > 0) groups.push({ id: 'none', name: 'No group', categories: loose });
    return groups;
  }, [expenseCategories, categoryGroups]);

  const budgetFor = (categoryId: string): Budget | undefined =>
    budgets.find((budget) => budget.categoryId === categoryId && budget.month === month);

  function handleCopy() {
    const from = previousMonth(month);
    const count = copyBudgets(from, month);
    setNotice(
      count > 0
        ? `Copied ${count} ${count === 1 ? 'budget' : 'budgets'} from ${monthLabel(`${from}-01`)}.`
        : `No budgets found in ${monthLabel(`${from}-01`)}.`,
    );
  }

  function handleAverage() {
    let count = 0;
    for (const category of expenseCategories) {
      const average = averageSpending(category.id, month, transactions);
      const existing = budgetFor(category.id);
      if (average > 0 || existing) {
        setBudget(category.id, month, average, existing?.rollover ?? false);
        count += 1;
      }
    }
    setNotice(
      count > 0
        ? `Set ${count} ${count === 1 ? 'limit' : 'limits'} from the previous 3 months.`
        : 'No spending history to average yet.',
    );
  }

  function handleSetLimit(categoryId: string, target: string, limit: number) {
    setBudget(categoryId, target, limit);
    setNotice('');
  }

  function handleSetRollover(categoryId: string, target: string, rollover: boolean) {
    const budget = budgets.find(
      (item) => item.categoryId === categoryId && item.month === target,
    );
    setBudget(categoryId, target, budget?.limit ?? 0, rollover);
  }

  const totalSpent = summary.spent;
  const totalLimit = summary.budgeted;
  const totalPct = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0;

  return (
    <section className="budget">
      <div className="budget__head">
        <div>
          <h1 className="budget__title">Budget</h1>
          <p className="budget__summary">
            {formatMoney(summary.income, settings.currency, settings.locale)} in
            {' · '}
            {formatMoney(summary.spent, settings.currency, settings.locale)} out
            {' · '}
            {summary.savingsRate >= 0 ? 'saved ' : 'overspent '}
            {Intl.NumberFormat(settings.locale, { style: 'percent', maximumFractionDigits: 0 }).format(
              Math.abs(summary.savingsRate),
            )}
          </p>
        </div>
        <div className="budget__month">
          <button
            type="button"
            className="button button--ghost button--icon"
            onClick={() => setMonth(previousMonth(month))}
            aria-label="Previous month"
          >
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="budget__month-label"
            onClick={() => setMonth(currentMonth(todayISO()))}
            title="Jump to this month"
          >
            {monthLabel(`${month}-01`)}
          </button>
          <button
            type="button"
            className="button button--ghost button--icon"
            onClick={() => setMonth(nextMonth(month))}
            aria-label="Next month"
          >
            <FiChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="budget__cards">
        <div className="budget-card">
          <span className="budget-card__label">Budgeted</span>
          <strong>{formatMoney(summary.budgeted, settings.currency, settings.locale)}</strong>
        </div>
        <div className="budget-card">
          <span className="budget-card__label">Spent</span>
          <strong>{formatMoney(summary.spent, settings.currency, settings.locale)}</strong>
          <span className="budget-card__meter" aria-hidden="true">
            <span
              className={`budget-card__meter-fill${totalPct >= 100 ? ' is-over' : ''}`}
              style={{ width: `${Math.min(100, totalPct)}%` }}
            />
          </span>
        </div>
        <div className="budget-card">
          <span className="budget-card__label">Left to spend</span>
          <strong className={summary.remaining < 0 ? 'amount--out' : ''}>
            {formatMoney(summary.remaining, settings.currency, settings.locale)}
          </strong>
        </div>
        <div className="budget-card">
          <span className="budget-card__label">Unbudgeted</span>
          <strong>{formatMoney(summary.unbudgeted, settings.currency, settings.locale)}</strong>
        </div>
      </div>

      <div className="budget__actions">
        <button type="button" className="button" onClick={handleCopy}>
          <FiCopy aria-hidden="true" />
          Copy last month's budgets
        </button>
        <button type="button" className="button" onClick={handleAverage}>
          <FiTrendingUp aria-hidden="true" />
          Set all from 3-month average
        </button>
        {notice && <span className="budget__notice">{notice}</span>}
      </div>

      {grouped.length === 0 ? (
        <div className="empty-state">
          <h2>No expense categories yet</h2>
          <p>Create expense categories in Settings, then set a monthly limit here.</p>
        </div>
      ) : (
        <div className="budget__groups">
          {grouped.map((group) => (
            <section key={group.id} className="budget-group">
              <header className="budget-group__head">
                <h2>{group.name}</h2>
                <span>
                  {formatMoney(
                    group.categories.reduce((sum, category) => {
                      const budget = budgetFor(category.id);
                      return sum + (budget?.limit ?? 0);
                    }, 0),
                    settings.currency,
                    settings.locale,
                  )}
                </span>
              </header>
              {group.categories.map((category) => {
                const budget = budgetFor(category.id);
                const status = budgetStatus(category, month, transactions, budget, budgets);
                return (
                  <BudgetRow
                    key={category.id}
                    category={category}
                    month={month}
                    budget={budget}
                    status={status}
                    currency={settings.currency}
                    locale={settings.locale}
                    onSetLimit={handleSetLimit}
                    onSetRollover={handleSetRollover}
                    onOpen={() => onOpenCategory(category.id, month)}
                  />
                );
              })}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
