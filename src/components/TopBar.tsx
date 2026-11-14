/** Global header: identity, net worth, account balances and primary actions. */

import { FiEye, FiEyeOff, FiMoon, FiPlus, FiSearch, FiSettings, FiSun } from 'react-icons/fi';

import { accountBalance, formatMoney } from '../domain/money';
import type { Account, Settings, Transaction } from '../domain/types';
import { ProgressHud } from './ProgressHud';

interface TopBarProps {
  accounts: Account[];
  transactions: Transaction[];
  settings: Settings;
  netWorth: number;
  onAdd: () => void;
  onSearch: () => void;
  onToggleTheme: () => void;
  onToggleBalances: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  accounts,
  transactions,
  settings,
  netWorth,
  onAdd,
  onSearch,
  onToggleTheme,
  onToggleBalances,
  onOpenSettings,
}: TopBarProps) {
  const visibleAccounts = accounts.filter((account) => !account.archived);

  return (
    <>
      <div className="topbar__identity">
        <span className="topbar__brand">Budget</span>
        <span className="topbar__meta">Local-first ledger</span>
      </div>

      <div className="topbar__worth">
        <span className="topbar__worth-label">Net worth</span>
        <strong className="topbar__worth-value">
          {formatMoney(netWorth, settings.currency, settings.locale, settings.hideBalances)}
        </strong>
      </div>

      <div className="topbar__accounts" aria-label="Account balances">
        {visibleAccounts.map((account) => (
          <span key={account.id} className="topbar__account">
            <span className="dot" style={{ background: account.color }} aria-hidden="true" />
            <span className="topbar__account-name">{account.name}</span>
            <span
              className={`topbar__account-value${
                account.type === 'credit' &&
                accountBalance(account, transactions) < 0
                  ? ' amount--out'
                  : ''
              }`}
            >
              {formatMoney(
                accountBalance(account, transactions),
                settings.currency,
                settings.locale,
                settings.hideBalances,
              )}
            </span>
          </span>
        ))}
      </div>

      <div className="topbar__actions">
        <ProgressHud progress={settings.progress} />
        <button
          type="button"
          className="icon-button topbar__search"
          onClick={onSearch}
          aria-label="Search transactions"
        >
          <FiSearch />
        </button>
        <kbd className="topbar__kbd">/</kbd>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleBalances}
          aria-label={settings.hideBalances ? 'Show balances' : 'Hide balances'}
        >
          {settings.hideBalances ? <FiEyeOff /> : <FiEye />}
        </button>
        <button
          type="button"
          className="icon-button topbar__theme"
          onClick={onToggleTheme}
          aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {settings.theme === 'dark' ? <FiSun /> : <FiMoon />}
        </button>
        <button
          type="button"
          className="icon-button topbar__settings"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <FiSettings />
        </button>
        <button type="button" className="button button--primary topbar__add" onClick={onAdd}>
          <FiPlus aria-hidden="true" />
          <span>Add transaction</span>
          <kbd>n</kbd>
        </button>
      </div>
    </>
  );
}
