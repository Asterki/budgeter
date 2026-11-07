/** Dedicated account overview, especially useful on mobile where the rail is hidden. */

import { FiCreditCard, FiEdit2, FiPlus } from 'react-icons/fi';

import { useBudget } from '../state/store';
import { netWorth } from '../domain/ledger';
import {
  accountBalance,
  creditAvailable,
  creditOwed,
  formatMoney,
} from '../domain/money';
import type { Account } from '../domain/types';

const ACCOUNT_TYPE_LABEL: Record<Account['type'], string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  credit: 'Credit card',
  investment: 'Investment',
};

interface AccountsViewProps {
  onAddAccount: () => void;
  onEditAccount: (account: Account) => void;
  onOpenAccount: (account: Account) => void;
}

export function AccountsView({
  onAddAccount,
  onEditAccount,
  onOpenAccount,
}: AccountsViewProps) {
  const { accounts, transactions, settings } = useBudget();
  const masked = settings.hideBalances;
  const active = accounts.filter((account) => !account.archived);
  const archived = accounts.filter((account) => account.archived);
  const worth = netWorth(accounts, transactions);

  function renderAccount(account: Account) {
    const balance = accountBalance(account, transactions);
    const isCredit = account.type === 'credit';
    const owed = isCredit ? creditOwed(account, transactions) : 0;
    const available = isCredit ? creditAvailable(account, transactions) : null;
    const utilization =
      isCredit && account.creditLimit && !masked
        ? Math.min(1, owed / account.creditLimit)
        : 0;

    return (
      <li key={account.id} className="account-card">
        <div className="account-card__head">
          <button
            type="button"
            className="account-card__main"
            onClick={() => onOpenAccount(account)}
          >
            <span className="dot" style={{ background: account.color }} aria-hidden="true" />
            <span className="account-card__name">{account.name}</span>
            <span className="account-card__type">
              {ACCOUNT_TYPE_LABEL[account.type]}
              {account.currency ? ` · ${account.currency}` : ''}
            </span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => onEditAccount(account)}
            aria-label={`Edit ${account.name}`}
          >
            <FiEdit2 />
          </button>
        </div>

        <button
          type="button"
          className="account-card__body"
          onClick={() => onOpenAccount(account)}
        >
          <span className="account-card__balance-label">
            {isCredit ? 'Owed' : 'Balance'}
          </span>
          <span
            className={`account-card__balance${
              isCredit && balance < 0
                ? ' account-card__balance--debt'
                : balance > 0
                  ? ' amount--in'
                  : ''
            }`}
          >
            {formatMoney(balance, settings.currency, settings.locale, masked)}
          </span>

          {isCredit && available !== null && (
            <span className="account-card__credit">
              <span className="account-card__credit-meta">
                <span className="hint">
                  Limit{' '}
                  {formatMoney(
                    account.creditLimit ?? 0,
                    settings.currency,
                    settings.locale,
                    masked,
                  )}
                </span>
                <span className="hint">
                  {formatMoney(available, settings.currency, settings.locale, masked)}{' '}
                  available
                </span>
              </span>
              <span className="account-card__meter" aria-hidden="true">
                <span style={{ width: `${Math.round(utilization * 100)}%` }} />
              </span>
            </span>
          )}
        </button>
      </li>
    );
  }

  return (
    <section className="accounts-view">
      <header className="accounts-view__head">
        <div>
          <h1 className="ledger__title">Accounts</h1>
          <p className="ledger__summary">Balances across every account on this device.</p>
        </div>
        <button type="button" className="button button--primary" onClick={onAddAccount}>
          <FiPlus aria-hidden="true" />
          <span>Add account</span>
        </button>
      </header>

      <div className="accounts-view__worth card">
        <span className="accounts-view__worth-label">Net worth</span>
        <strong className="accounts-view__worth-value">
          {formatMoney(worth, settings.currency, settings.locale, masked)}
        </strong>
      </div>

      {active.length === 0 ? (
        <div className="empty-state">
          <h2>No accounts yet</h2>
          <p>Add an account to start tracking balances and transactions.</p>
          <button type="button" className="button button--primary" onClick={onAddAccount}>
            <FiCreditCard aria-hidden="true" />
            Add account
          </button>
        </div>
      ) : (
        <ul className="account-list">{active.map(renderAccount)}</ul>
      )}

      {archived.length > 0 && (
        <div className="accounts-view__archived">
          <p className="rail__label">Archived</p>
          <ul className="account-list">{archived.map(renderAccount)}</ul>
        </div>
      )}
    </section>
  );
}
