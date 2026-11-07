import { useEffect, useMemo, useState } from 'react';
import {
  FiBarChart2,
  FiCalendar,
  FiCreditCard,
  FiList,
  FiMoreHorizontal,
  FiPieChart,
  FiPlus,
  FiSettings,
  FiTrendingUp,
} from 'react-icons/fi';

import { AccountDialog } from './components/AccountDialog';
import { Dialog } from './components/Dialog';
import { Rewards } from './components/Rewards';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { TransactionDetail } from './components/TransactionDetail';
import { monthRange } from './domain/budget';
import { netWorth } from './domain/ledger';
import { useBudget } from './state/store';
import { INITIAL_SELECTION, type NavSelection, type TransactionScope, type ViewKey } from './state/navigation';
import { AccountsView } from './views/AccountsView';
import { BudgetView } from './views/BudgetView';
import { CalendarView } from './views/CalendarView';
import { ForecastView } from './views/ForecastView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { TransactionsView } from './views/TransactionsView';
import type { Account } from './domain/types';

const TABS: { view: ViewKey; label: string; icon: typeof FiList }[] = [
  { view: 'transactions', label: 'Ledger', icon: FiList },
  { view: 'accounts', label: 'Accounts', icon: FiCreditCard },
  { view: 'budget', label: 'Budget', icon: FiPieChart },
  { view: 'calendar', label: 'Calendar', icon: FiCalendar },
  { view: 'reports', label: 'Reports', icon: FiBarChart2 },
  { view: 'forecast', label: 'Forecast', icon: FiTrendingUp },
  { view: 'settings', label: 'Settings', icon: FiSettings },
];

const MOBILE_TABS = TABS.slice(0, 4);
const MORE_TABS = TABS.slice(4);

export function App() {
  const { ready, accounts, transactions, settings, updateSettings } = useBudget();
  const [selection, setSelection] = useState<NavSelection>(INITIAL_SELECTION);
  const [detail, setDetail] = useState<{ transactionId: string | null } | null>(null);
  const [accountDialog, setAccountDialog] = useState<Account | null | undefined>(undefined);
  const [searchSignal, setSearchSignal] = useState(0);
  const [composeSignal, setComposeSignal] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [budgetJump, setBudgetJump] = useState<{
    categoryId: string;
    from: string;
    to: string;
    signal: number;
  } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'add') return;
    setDetail({ transactionId: null });
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [ready]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (event.key === 'Escape' && detail) {
        setDetail(null);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'n') {
        event.preventDefault();
        setSelection((prev) => ({ ...prev, view: 'transactions' }));
        setComposeSignal((value) => value + 1);
      } else if (event.key === '/') {
        event.preventDefault();
        setSelection((prev) => ({ ...prev, view: 'transactions' }));
        setSearchSignal((value) => value + 1);
      } else if (/^[1-7]$/.test(event.key)) {
        event.preventDefault();
        const view = TABS[Number(event.key) - 1]?.view;
        if (view) setSelection((prev) => ({ ...prev, view }));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail]);

  const worth = useMemo(() => netWorth(accounts, transactions), [accounts, transactions]);

  if (!ready) {
    return <div className="boot-screen">Loading your budget…</div>;
  }

  const activeTransaction = detail?.transactionId
    ? transactions.find((transaction) => transaction.id === detail.transactionId)
    : undefined;
  const defaultAccountId =
    selection.scope.kind === 'account' ? selection.scope.accountId : undefined;

  function selectScope(scope: TransactionScope) {
    setSelection((prev) => ({ ...prev, view: 'transactions', scope }));
  }

  function openBudgetCategory(categoryId: string, month: string) {
    const range = monthRange(month);
    setBudgetJump((prev) => ({ ...range, categoryId, signal: (prev?.signal ?? 0) + 1 }));
    setSelection({ view: 'transactions', scope: { kind: 'all' } });
  }

  return (
    <div className="app-shell">
      <TopBar
        accounts={accounts}
        transactions={transactions}
        settings={settings}
        netWorth={worth}
        onAdd={() => setDetail({ transactionId: null })}
        onSearch={() => {
          setSelection((prev) => ({ ...prev, view: 'transactions' }));
          setSearchSignal((value) => value + 1);
        }}
        onToggleTheme={() =>
          updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
        }
        onToggleBalances={() =>
          updateSettings({ hideBalances: !settings.hideBalances })
        }
        onOpenSettings={() => setSelection((prev) => ({ ...prev, view: 'settings' }))}
      />

      <div className="shell-body">
        <Sidebar
          selection={selection}
          onSelect={setSelection}
          onAddAccount={() => setAccountDialog(null)}
          onEditAccount={(account) => setAccountDialog(account)}
        />

        <main className="workspace">
          {selection.view === 'transactions' && (
            <TransactionsView
              selection={selection}
              onSelectScope={selectScope}
              onOpenTransaction={(transaction) =>
                setDetail({ transactionId: transaction.id })
              }
              onNewTransaction={() => setDetail({ transactionId: null })}
              searchSignal={searchSignal}
              composeSignal={composeSignal}
              categoryJump={budgetJump}
            />
          )}
          {selection.view === 'accounts' && (
            <AccountsView
              onAddAccount={() => setAccountDialog(null)}
              onEditAccount={(account) => setAccountDialog(account)}
              onOpenAccount={(account) =>
                selectScope({ kind: 'account', accountId: account.id })
              }
            />
          )}
          {selection.view === 'budget' && <BudgetView onOpenCategory={openBudgetCategory} />}
          {selection.view === 'calendar' && (
            <CalendarView onOpenTransaction={(transaction) => setDetail({ transactionId: transaction.id })} />
          )}
          {selection.view === 'reports' && <ReportsView />}
          {selection.view === 'forecast' && <ForecastView />}
          {selection.view === 'settings' && <SettingsView />}
        </main>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.view}
              type="button"
              className={`tabbar__item${selection.view === tab.view ? ' tabbar__item--active' : ''}`}
              onClick={() => setSelection((prev) => ({ ...prev, view: tab.view }))}
            >
              <Icon aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`tabbar__item${
            MORE_TABS.some((tab) => tab.view === selection.view) ? ' tabbar__item--active' : ''
          }`}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
        >
          <FiMoreHorizontal aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <Dialog title="More" onClose={() => setMoreOpen(false)}>
          <div className="more-list">
            <button
              type="button"
              className="more-list__item"
              onClick={() => {
                setMoreOpen(false);
                setDetail({ transactionId: null });
              }}
            >
              <FiPlus aria-hidden="true" />
              <span>Add transaction</span>
            </button>
            {MORE_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.view}
                  type="button"
                  className={`more-list__item${
                    selection.view === tab.view ? ' more-list__item--active' : ''
                  }`}
                  onClick={() => {
                    setMoreOpen(false);
                    setSelection((prev) => ({ ...prev, view: tab.view }));
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </Dialog>
      )}

      {detail && (detail.transactionId === null || activeTransaction) && (
        <TransactionDetail
          transaction={activeTransaction ?? null}
          defaultAccountId={defaultAccountId}
          onClose={() => setDetail(null)}
        />
      )}

      {accountDialog !== undefined && (
        <AccountDialog
          account={accountDialog}
          onClose={() => setAccountDialog(undefined)}
        />
      )}

      <Rewards settings={settings} />
    </div>
  );
}
