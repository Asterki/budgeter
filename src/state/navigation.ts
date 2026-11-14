/** Navigation state shared by the shell, rail and transaction list. */

import {
  FiBarChart2,
  FiCalendar,
  FiInbox,
  FiList,
  FiPieChart,
  FiTrendingUp,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';

export type ViewKey =
  | 'transactions'
  | 'accounts'
  | 'budget'
  | 'calendar'
  | 'reports'
  | 'forecast'
  | 'settings'
  | 'more';

/** The ledger slice currently shown in the transactions view. */
export type TransactionScope =
  | { kind: 'all' }
  | { kind: 'account'; accountId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'uncategorized' }
  | { kind: 'payee'; payeeId: string };

export interface NavSelection {
  view: ViewKey;
  scope: TransactionScope;
}

export const INITIAL_SELECTION: NavSelection = {
  view: 'transactions',
  scope: { kind: 'all' },
};

export interface NavItem {
  view: ViewKey;
  label: string;
  icon: IconType;
  /** Present when the row selects a ledger slice rather than a whole view. */
  scope?: TransactionScope;
}

/** The ledger slices. Two rows, both landing in the transactions view. */
export const VIEW_GROUP: NavItem[] = [
  { view: 'transactions', label: 'All transactions', icon: FiList, scope: { kind: 'all' } },
  {
    view: 'transactions',
    label: 'Uncategorized',
    icon: FiInbox,
    scope: { kind: 'uncategorized' },
  },
];

/** The slower work: budgets, forecasting, reports, the calendar. */
export const PLANNING_GROUP: NavItem[] = [
  { view: 'budget', label: 'Budget', icon: FiPieChart },
  { view: 'forecast', label: 'Forecast', icon: FiTrendingUp },
  { view: 'reports', label: 'Reports', icon: FiBarChart2 },
  { view: 'calendar', label: 'Calendar', icon: FiCalendar },
];

/** The mobile More list is the rail's Planning group, minus what already has a tab. */
export const MORE_VIEWS = PLANNING_GROUP.filter((item) => item.view !== 'budget');
