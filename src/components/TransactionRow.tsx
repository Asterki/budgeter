/** One ledger row. Presentation only; editing is owned by TransactionDetail. */

import { FiCheckCircle, FiRepeat } from 'react-icons/fi';

import type { Account, Category, Payee, Transaction } from '../domain/types';
import { formatMoney } from '../domain/money';

interface TransactionRowProps {
  transaction: Transaction;
  account: Account | undefined;
  category: Category | undefined;
  payee: Payee | undefined;
  transferAccount: Account | undefined;
  currency: string;
  locale: string;
  runningBalance?: number;
  showAccount: boolean;
  masked?: boolean;
  onOpen: () => void;
}

export function TransactionRow({
  transaction,
  account,
  category,
  payee,
  transferAccount,
  currency,
  locale,
  runningBalance,
  showAccount,
  masked = false,
  onOpen,
}: TransactionRowProps) {
  const isTransfer = transaction.type === 'transfer';
  const title =
    (isTransfer ? transferAccount?.name : payee?.name) ||
    transaction.notes.trim() ||
    category?.name ||
    (isTransfer ? 'Transfer' : 'Untitled transaction');

  const meta = [
    isTransfer ? 'Transfer' : category?.name,
    showAccount ? account?.name : null,
    ...transaction.tags,
  ].filter(Boolean);

  return (
    <button type="button" className="tx-row" onClick={onOpen}>
      <span
        className={`tx-row__marker${isTransfer ? ' tx-row__marker--transfer' : ''}`}
        style={isTransfer ? undefined : { background: category?.color ?? account?.color }}
        aria-hidden="true"
      >
        {isTransfer ? <FiRepeat /> : null}
      </span>

      <span className="tx-row__main">
        <span className="tx-row__title">{title}</span>
        <span className="tx-row__meta">
          {meta.map((item, index) => (
            <span key={`${item}-${index}`} className="tx-row__chip">
              {item}
            </span>
          ))}
          {transaction.notes && title !== transaction.notes && (
            <span className="tx-row__notes">{transaction.notes}</span>
          )}
        </span>
      </span>

      <span className="tx-row__side">
        <span
          className={`tx-row__amount ${
            transaction.amount > 0 ? 'tx-row__amount--in' : 'tx-row__amount--out'
          }`}
        >
          {formatMoney(transaction.amount, currency, locale, masked)}
        </span>
        {runningBalance !== undefined && (
          <span className="tx-row__balance">
            {formatMoney(runningBalance, currency, locale, masked)}
          </span>
        )}
      </span>

      {transaction.cleared && (
        <span className="tx-row__cleared" title="Cleared">
          <FiCheckCircle aria-label="Cleared" />
        </span>
      )}
    </button>
  );
}
