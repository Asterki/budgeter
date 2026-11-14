import { useEffect, useState } from 'react';
import {
  FiCreditCard,
  FiList,
  FiMoreHorizontal,
  FiPieChart,
  FiPlus,
  FiSettings,
} from 'react-icons/fi';

import { AccountDialog } from './components/AccountDialog';
import { AppShell, useIsMobile } from './components/AppShell';
import { Rewards } from './components/Rewards';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { TransactionDetail } from './components/TransactionDetail';
import { monthRange } from './domain/budget';
import { useBudget } from './state/store';
import {
  INITIAL_SELECTION,
  PLANNING_GROUP,
  VIEW_GROUP,
  type NavItem,
  type NavSelection,
  type TransactionScope,
  type ViewKey,
} from './state/navigation';
import { AccountsView } from './views/AccountsView';
import { BudgetView } from './views/BudgetView';
import { CalendarView } from './views/CalendarView';
import { ForecastView } from './views/ForecastView';
import { MoreView } from './views/MoreView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { TransactionsView } from './views/TransactionsView';
import type { Account } from './domain/types';

const MOBILE_TABS: { view: ViewKey; label: string; icon: typeof FiList }[] = [
  { view: 'transactions', label: 'Transactions', icon: FiList },
  { view: 'accounts', label: 'Accounts', icon: FiCreditCard },
  { view: 'budget', label: 'Budget', icon: FiPieChart },
  { view: 'more', label: 'More', icon: FiMoreHorizontal },
];

/** 1–7 follow the rail, not a separate list. */
const SHORTCUTS: NavItem[] = [
  ...VIEW_GROUP,
  ...PLANNING_GROUP,
  { view: 'settings', label: 'Settings', icon: FiSettings },
];

export function App() {
  const { ready, transactions, settings } = useBudget();
  const isMobile = useIsMobile();
  const [selection, setSelection] = useState<NavSelection>(INITIAL_SELECTION);
  const [detail, setDetail] = useState<{ transactionId: string | null } | null>(null);
  const [accountDialog, setAccountDialog] = useState<Account | null | undefined>(undefined);
  const [searchSignal, setSearchSignal] = useState(0);
  const [composeSignal, setComposeSignal] = useState(0);
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
        const item = SHORTCUTS[Number(event.key) - 1];
        if (!item) return;
        setSelection((prev) => ({
          ...prev,
          view: item.view,
          scope: item.scope ?? prev.scope,
        }));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail]);

  if (!ready) {
    return <div className="boot-screen">Loading your budget…</div>;
  }

  const activeTransaction = detail?.transactionId
    ? transactions.find((transaction) => transaction.id === detail.transactionId)
    : undefined;
  const defaultAccountId =
    selection.scope.kind === 'account' ? selection.scope.accountId : undefined;
  const detailOpen = !!detail && (detail.transactionId === null || !!activeTransaction);

  function selectScope(scope: TransactionScope) {
    setSelection((prev) => ({ ...prev, view: 'transactions', scope }));
  }

  function openBudgetCategory(categoryId: string, month: string) {
    const range = monthRange(month);
    setBudgetJump((prev) => ({ ...range, categoryId, signal: (prev?.signal ?? 0) + 1 }));
    setSelection({ view: 'transactions', scope: { kind: 'all' } });
  }

  return (
    <AppShell
      topbar={
        <TopBar
          onAdd={() => setDetail({ transactionId: null })}
          onSearch={() => {
            setSelection((prev) => ({ ...prev, view: 'transactions' }));
            setSearchSignal((value) => value + 1);
          }}
        />
      }
      rail={
        <Sidebar
          selection={selection}
          onSelect={setSelection}
          onAddAccount={() => setAccountDialog(null)}
          onEditAccount={(account) => setAccountDialog(account)}
        />
      }
      panel={
        !isMobile && detailOpen ? (
          <TransactionDetail
            transaction={activeTransaction ?? null}
            defaultAccountId={defaultAccountId}
            onClose={() => setDetail(null)}
            inline
          />
        ) : undefined
      }
      tabbar={
        <nav className="tabbar" aria-label="Primary">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active =
              tab.view === 'more'
                ? selection.view === 'more' ||
                  selection.view === 'settings' ||
                  PLANNING_GROUP.some((item) => item.view === selection.view)
                : selection.view === tab.view;
            return (
              <button
                key={tab.view}
                type="button"
                className={`tabbar__item${active ? ' tabbar__item--active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setSelection((prev) => ({ ...prev, view: tab.view }))}
              >
                <Icon aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      }
      fab={
        <button
          type="button"
          className="fab"
          onClick={() => setDetail({ transactionId: null })}
          aria-label="Add transaction"
        >
          <FiPlus aria-hidden="true" />
        </button>
      }
    >
      {selection.view === 'transactions' && (
        <TransactionsView
          selection={selection}
          onSelectScope={selectScope}
          onOpenTransaction={(transaction) => setDetail({ transactionId: transaction.id })}
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
          onOpenAccount={(account) => selectScope({ kind: 'account', accountId: account.id })}
        />
      )}
      {selection.view === 'budget' && <BudgetView onOpenCategory={openBudgetCategory} />}
      {selection.view === 'calendar' && (
        <CalendarView
          onOpenTransaction={(transaction) => setDetail({ transactionId: transaction.id })}
        />
      )}
      {selection.view === 'reports' && <ReportsView />}
      {selection.view === 'forecast' && <ForecastView />}
      {selection.view === 'settings' && <SettingsView />}
      {selection.view === 'more' && (
        <MoreView
          active={selection.view}
          onSelect={(view) => setSelection((prev) => ({ ...prev, view }))}
        />
      )}

      {isMobile && detailOpen && (
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
    </AppShell>
  );
}
