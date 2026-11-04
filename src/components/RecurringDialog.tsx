/**
 * Editor for an existing recurring rule. Amounts are stored as signed cents;
 * the form works with a positive magnitude like the transaction editor.
 */

import { useId, useState, type FormEvent } from 'react';

import { Dialog } from './Dialog';
import { RecurrenceEditor } from './RecurrenceEditor';
import { useBudget } from '../state/store';
import type { RecurrenceRule, RecurringRule, TransactionType } from '../domain/types';
import { isValidISODate } from '../domain/date';
import { parseAmount } from '../domain/money';

interface RecurringDialogProps {
  rule: RecurringRule;
  onClose: () => void;
}

type RuleType = Extract<TransactionType, 'expense' | 'income'>;

export function RecurringDialog({ rule, onClose }: RecurringDialogProps) {
  const { accounts, categories, payees, settings, updateRecurring, catchUpRecurring } = useBudget();
  const payeeListId = useId();

  const [type, setType] = useState<RuleType>(rule.type === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState((Math.abs(rule.amount) / 100).toFixed(2));
  const [accountId, setAccountId] = useState(rule.accountId);
  const [categoryId, setCategoryId] = useState(rule.categoryId ?? '');
  const [payeeId, setPayeeId] = useState(rule.payeeId ?? '');
  const [notes, setNotes] = useState(rule.notes);
  const [nextDate, setNextDate] = useState(rule.nextDate);
  const [active, setActive] = useState(rule.active);
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(rule.recurrence);
  const [error, setError] = useState('');

  const visibleAccounts = accounts.filter(
    (account) => !account.archived || account.id === rule.accountId,
  );
  const visibleCategories = categories.filter(
    (category) => category.kind === type && (!category.archived || category.id === rule.categoryId),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const magnitude = parseAmount(amount, settings.locale);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!isValidISODate(nextDate)) {
      setError('Pick a valid next date.');
      return;
    }
    if (!accountId) {
      setError('Choose an account.');
      return;
    }

    updateRecurring(rule.id, {
      accountId,
      amount: type === 'income' ? magnitude : -magnitude,
      type,
      categoryId: categoryId || null,
      payeeId: payeeId || null,
      notes,
      recurrence,
      nextDate,
      active,
    });
    if (active) void catchUpRecurring();
    onClose();
  }

  return (
    <Dialog
      title="Edit recurring transaction"
      description="Changes apply to future copies. Rows already recorded are untouched."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" form="recurring-form">
            Save rule
          </button>
        </>
      }
    >
      <form id="recurring-form" className="dialog__form" onSubmit={handleSubmit}>
        <div className="segmented" role="group" aria-label="Recurring type">
          {(['expense', 'income'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__item${type === option ? ' segmented__item--active' : ''}`}
              aria-pressed={type === option}
              onClick={() => {
                setType(option);
                setCategoryId('');
              }}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Amount ({settings.currency})</span>
            <input
              className="input input--amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <label className="field">
            <span className="field__label">Account</span>
            <select
              className="input"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {visibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Category</span>
            <select
              className="input"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Uncategorized</option>
              {visibleCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Payee</span>
            <input
              className="input"
              list={payeeListId}
              value={payees.find((payee) => payee.id === payeeId)?.name ?? ''}
              onChange={(event) => {
                const match = payees.find(
                  (payee) => payee.name.toLowerCase() === event.target.value.toLowerCase(),
                );
                setPayeeId(match?.id ?? '');
              }}
              placeholder="Optional"
              autoComplete="off"
            />
            <datalist id={payeeListId}>
              {payees.map((payee) => (
                <option key={payee.id} value={payee.name} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="field">
          <span className="field__label">Notes</span>
          <textarea
            className="input input--textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Next date</span>
            <input
              className="input"
              type="date"
              value={nextDate}
              onChange={(event) => setNextDate(event.target.value)}
            />
          </label>
          <label className="check-row check-row--inline">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>Active</span>
          </label>
        </div>

        <RecurrenceEditor value={recurrence} startDate={nextDate} onChange={setRecurrence} />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
