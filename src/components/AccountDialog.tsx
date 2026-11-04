/** Create or edit an account. Shared by Settings and the navigation rail. */

import { useState, type FormEvent } from 'react';

import { ColorPicker, Dialog } from './Dialog';
import { ACCOUNT_COLORS, useBudget } from '../state/store';
import type { Account, AccountType } from '../domain/types';
import { parseAmount } from '../domain/money';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit card' },
  { value: 'investment', label: 'Investment' },
];

interface AccountDialogProps {
  account: Account | null;
  onClose: () => void;
}

export function AccountDialog({ account, onClose }: AccountDialogProps) {
  const { createAccount, updateAccount } = useBudget();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [opening, setOpening] = useState(
    account ? (account.openingBalance / 100).toFixed(2) : '0.00',
  );
  const [color, setColor] = useState(account?.color ?? ACCOUNT_COLORS[0]);
  const [archived, setArchived] = useState(account?.archived ?? false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const parsed = parseAmount(opening);
    const openingBalance = Number.isFinite(parsed) ? parsed : 0;

    if (account) {
      updateAccount(account.id, { name: name.trim(), type, openingBalance, color, archived });
    } else {
      createAccount({ name: name.trim(), type, openingBalance, color });
    }
    onClose();
  }

  return (
    <Dialog
      title={account ? 'Edit account' : 'New account'}
      description={
        account
          ? 'Archiving keeps the history but removes the account from the net-worth total.'
          : 'Opening balance is the amount already in the account before any transactions.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" form="account-form">
            {account ? 'Save account' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="account-form" className="dialog__form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Everyday checking"
            maxLength={80}
            autoFocus
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Type</span>
            <select
              className="input"
              value={type}
              onChange={(event) => setType(event.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Opening balance</span>
            <input
              className="input input--money"
              inputMode="decimal"
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="0.00"
            />
          </label>
        </div>

        <ColorPicker colors={ACCOUNT_COLORS} value={color} onChange={setColor} />

        {account && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => setArchived(event.target.checked)}
            />
            <span>Archived (hidden from net worth)</span>
          </label>
        )}
      </form>
    </Dialog>
  );
}
