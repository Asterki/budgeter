/**
 * Transaction editor. Works for new rows and existing ones, including both
 * halves of a transfer.
 */

import { useId, useState, type FormEvent } from 'react';

import { ConfirmDialog, Dialog } from './Dialog';
import { RecurrenceEditor } from './RecurrenceEditor';
import { useBudget } from '../state/store';
import type { RecurrenceRule, Transaction, TransactionType } from '../domain/types';
import { isValidISODate, todayISO } from '../domain/date';
import { createRecurrence, nextOccurrence } from '../domain/recurrence';
import { parseAmount } from '../domain/money';

type EditorType = TransactionType;

interface TransactionDetailProps {
  transaction: Transaction | null;
  defaultAccountId?: string;
  onClose: () => void;
}

export function TransactionDetail({ transaction, defaultAccountId, onClose }: TransactionDetailProps) {
  const {
    accounts,
    categories,
    payees,
    recurring,
    settings,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    createTransfer,
    deleteTransfer,
    createPayee,
    createRecurring,
    updateRecurring,
    deleteRecurring,
    catchUpRecurring,
  } = useBudget();

  const activeAccounts = accounts.filter(
    (account) =>
      !account.archived ||
      account.id === transaction?.accountId ||
      account.id === transaction?.transferAccountId,
  );
  const payeeListId = useId();

  const initialType: EditorType = transaction?.type ?? 'expense';
  const isTransferTransaction = transaction?.type === 'transfer';
  const initialAccountId = isTransferTransaction
    ? transaction.amount < 0
      ? transaction.accountId
      : (transaction.transferAccountId ?? transaction.accountId)
    : (transaction?.accountId ?? defaultAccountId ?? activeAccounts[0]?.id ?? '');
  const initialTransferAccountId = isTransferTransaction
    ? transaction.amount < 0
      ? (transaction.transferAccountId ?? '')
      : transaction.accountId
    : (transaction?.transferAccountId ?? '');

  const [type, setType] = useState<EditorType>(initialType);
  const [amount, setAmount] = useState(
    transaction ? (Math.abs(transaction.amount) / 100).toFixed(2) : '',
  );
  const [accountId, setAccountId] = useState(initialAccountId);
  const [transferAccountId, setTransferAccountId] = useState(initialTransferAccountId);
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [payeeName, setPayeeName] = useState(
    transaction?.payeeId
      ? (payees.find((payee) => payee.id === transaction.payeeId)?.name ?? '')
      : '',
  );
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [notes, setNotes] = useState(transaction?.notes ?? '');
  const [tags, setTags] = useState(transaction?.tags.join(', ') ?? '');
  const [cleared, setCleared] = useState(transaction?.cleared ?? false);
  const existingRule = transaction?.recurringId
    ? recurring.find((rule) => rule.id === transaction.recurringId)
    : undefined;
  const [repeat, setRepeat] = useState(!!existingRule);
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(
    existingRule?.recurrence ?? createRecurrence('monthly', transaction?.date ?? todayISO()),
  );
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const visibleCategories = categories.filter(
    (category) =>
      category.kind === type && (!category.archived || category.id === transaction?.categoryId),
  );

  function resolvePayee(): string | null {
    const name = payeeName.trim();
    if (!name) return null;
    const existing = payees.find((payee) => payee.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    return createPayee(name).id;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const magnitude = parseAmount(amount);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!isValidISODate(date)) {
      setError('Pick a valid date.');
      return;
    }
    if (!accountId) {
      setError('Choose an account.');
      return;
    }
    if (type === 'transfer' && (!transferAccountId || transferAccountId === accountId)) {
      setError('Choose two different accounts for a transfer.');
      return;
    }

    const tagList = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const payeeId = type === 'transfer' ? null : resolvePayee();
    const signed = type === 'income' ? magnitude : -magnitude;
    const wasTransfer = transaction?.type === 'transfer';
    let recurringId = transaction?.recurringId ?? null;

    if (type === 'transfer') {
      if (recurringId) {
        deleteRecurring(recurringId);
        recurringId = null;
      }
      if (transaction) {
        if (wasTransfer && transaction.transferPairId) deleteTransfer(transaction.transferPairId);
        else deleteTransaction(transaction.id);
      }
      createTransfer({
        fromAccountId: accountId,
        toAccountId: transferAccountId,
        amount: magnitude,
        date,
        notes,
        tags: tagList,
        cleared,
      });
      onClose();
      return;
    }

    if (repeat) {
      if (recurringId) {
        updateRecurring(recurringId, {
          accountId,
          amount: signed,
          type,
          categoryId: categoryId || null,
          payeeId,
          notes,
          tags: tagList,
          cleared,
          recurrence,
          nextDate: nextOccurrence(recurrence, date),
          lastGeneratedDate: date,
          active: true,
        });
      } else {
        const rule = createRecurring({
          accountId,
          amount: signed,
          type,
          categoryId: categoryId || null,
          payeeId,
          notes,
          tags: tagList,
          cleared,
          recurrence,
          nextDate: nextOccurrence(recurrence, date),
          lastGeneratedDate: date,
        });
        recurringId = rule.id;
      }
    } else if (recurringId) {
      deleteRecurring(recurringId);
      recurringId = null;
    }

    if (wasTransfer && transaction?.transferPairId) {
      deleteTransfer(transaction.transferPairId);
      createTransaction({
        accountId,
        date,
        amount: signed,
        type,
        categoryId: categoryId || null,
        payeeId,
        notes,
        tags: tagList,
        cleared,
        recurringId,
      });
    } else if (transaction) {
      updateTransaction(transaction.id, {
        accountId,
        date,
        amount: signed,
        type,
        categoryId: categoryId || null,
        payeeId,
        notes,
        tags: tagList,
        cleared,
        recurringId,
      });
      if (repeat) void catchUpRecurring();
    } else {
      createTransaction({
        accountId,
        date,
        amount: signed,
        type,
        categoryId: categoryId || null,
        payeeId,
        notes,
        tags: tagList,
        cleared,
        recurringId,
      });
    }
    onClose();
  }

  function handleDelete() {
    if (!transaction) return;
    if (transaction.transferPairId) deleteTransfer(transaction.transferPairId);
    else deleteTransaction(transaction.id);
    onClose();
  }

  if (confirmingDelete && transaction) {
    return (
      <ConfirmDialog
        title="Delete transaction?"
        message={
          transaction.type === 'transfer'
            ? 'Both sides of this transfer will be removed.'
            : 'This entry will be removed from the ledger.'
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onClose={() => setConfirmingDelete(false)}
      />
    );
  }

  return (
    <Dialog
      title={transaction ? 'Edit transaction' : 'New transaction'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            form="transaction-form"
            disabled={activeAccounts.length === 0}
          >
            {transaction ? 'Save changes' : 'Add transaction'}
          </button>
        </>
      }
    >
      <form id="transaction-form" className="dialog__form" onSubmit={handleSubmit}>
        {activeAccounts.length === 0 && (
          <p className="form-error" role="alert">
            Add an account in Settings before recording a transaction.
          </p>
        )}
        <div className="segmented" role="group" aria-label="Transaction type">
          {(['expense', 'income', 'transfer'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__item${type === option ? ' segmented__item--active' : ''}`}
              aria-pressed={type === option}
              onClick={() => {
                setType(option);
                setCategoryId('');
                setError('');
              }}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field__label">Amount ({settings.currency})</span>
          <input
            className="input input--amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="0.00"
            autoFocus
          />
        </label>

        {type === 'transfer' ? (
          <div className="field-row">
            <label className="field">
              <span className="field__label">From</span>
              <select
                className="input"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">To</span>
              <select
                className="input"
                value={transferAccountId}
                onChange={(event) => setTransferAccountId(event.target.value)}
              >
                <option value="">Choose account…</option>
                {activeAccounts
                  .filter((account) => account.id !== accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="field-row">
            <label className="field">
              <span className="field__label">Account</span>
              <select
                className="input"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
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
          </div>
        )}

        {type !== 'transfer' && (
          <label className="field">
            <span className="field__label">Payee</span>
            <input
              className="input"
              value={payeeName}
              onChange={(event) => setPayeeName(event.target.value)}
              placeholder="Start typing…"
              list={payeeListId}
              autoComplete="off"
            />
            <datalist id={payeeListId}>
              {payees.map((payee) => (
                <option key={payee.id} value={payee.name} />
              ))}
            </datalist>
          </label>
        )}

        <div className="field-row">
          <label className="field">
            <span className="field__label">Date</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Tags</span>
            <input
              className="input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="work, reimbursable"
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Notes</span>
          <textarea
            className="input input--textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Optional details"
          />
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={cleared}
            onChange={(event) => setCleared(event.target.checked)}
          />
          <span>Cleared</span>
        </label>

        {type !== 'transfer' && (
          <div className="repeat-box">
            <label className="check-row">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(event) => setRepeat(event.target.checked)}
              />
              <span>Repeat this transaction</span>
            </label>
            {repeat && (
              <>
                <RecurrenceEditor value={recurrence} startDate={date} onChange={setRecurrence} />
                <p className="field__hint">
                  Upcoming copies are planned, not stored. Due dates are added when the app opens.
                </p>
              </>
            )}
          </div>
        )}

        {type === 'transfer' && (
          <p className="dialog__description">
            Transfers create two linked entries, one in each account.
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {transaction && (
          <div className="dialog__danger">
            <button
              type="button"
              className="button button--danger"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete transaction
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
