/** Navigation state shared by the shell, rail and transaction list. */

export type ViewKey =
  | 'transactions'
  | 'budget'
  | 'calendar'
  | 'reports'
  | 'forecast'
  | 'settings';

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
