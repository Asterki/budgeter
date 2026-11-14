/**
 * CSV import: map columns, preview, skip duplicates, then write rows through
 * the same store path used by the rest of the ledger.
 */

import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  detectDateFormat,
  guessMapping,
  parseCsv,
  parseImportRows,
  type CsvDateFormat,
  type CsvMapping,
} from '../domain/csv';
import { planImport } from '../domain/import';
import { formatMoney } from '../domain/money';
import type { NewTransactionInput } from '../state/store';
import { useBudget } from '../state/store';
import { notify } from '../state/toasts';
import { Dialog } from './Dialog';

const NONE = -1;

const MAPPING_FIELDS: Array<{ key: keyof CsvMapping; label: string; optional?: boolean }> = [
  { key: 'date', label: 'Date' },
  { key: 'amount', label: 'Amount', optional: true },
  { key: 'debit', label: 'Debit', optional: true },
  { key: 'credit', label: 'Credit', optional: true },
  { key: 'payee', label: 'Payee', optional: true },
  { key: 'notes', label: 'Notes', optional: true },
  { key: 'category', label: 'Category', optional: true },
];

const DATE_FORMATS: CsvDateFormat[] = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY'];

export function CsvImportDialog({ onClose }: { onClose: () => void }) {
  const {
    accounts,
    categories,
    payees,
    rules,
    transactions,
    settings,
    createPayee,
    importTransactions,
  } = useBudget();

  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [format, setFormat] = useState<CsvDateFormat>('YYYY-MM-DD');
  const [accountId, setAccountId] = useState(
    accounts.find((account) => !account.archived)?.id ?? accounts[0]?.id ?? '',
  );
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const table = useMemo(() => (text ? parseCsv(text) : null), [text]);

  const rows = useMemo(() => {
    if (!table || !mapping) return { rows: [], skipped: 0 };
    return parseImportRows(table, mapping, format, settings.locale);
  }, [table, mapping, format, settings.locale]);

  const plan = useMemo(
    () =>
      planImport(rows.rows, {
        accountId,
        payees,
        categories,
        rules,
        transactions,
      }),
    [rows, accountId, payees, categories, rules, transactions],
  );

  const importable = plan.rows.filter((row) => !skipDuplicates || !row.duplicate);
  const newPayees = useMemo(() => {
    const known = new Set(payees.map((payee) => payee.name.toLocaleLowerCase()));
    return [...new Set(importable.map((row) => row.payee.trim()).filter(Boolean))].filter(
      (name) => !known.has(name.toLocaleLowerCase()),
    );
  }, [importable, payees]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    void file.text().then((content) => {
      setText(content);
      const parsed = parseCsv(content);
      const guessed = guessMapping(parsed.headers);
      setMapping(guessed);
      const dateColumn = guessed.date;
      setFormat(
        detectDateFormat(
          parsed.rows.slice(0, 40).map((row) => row[dateColumn] ?? '').filter(Boolean),
        ),
      );
    });
  }

  function setColumn(key: keyof CsvMapping, value: number) {
    setMapping((current) => (current ? { ...current, [key]: value } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) {
      setError('Choose the account these rows belong to.');
      return;
    }
    if (!mapping || mapping.date < 0 || (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0)) {
      setError('Map a date column and an amount (or debit/credit) column first.');
      return;
    }
    if (importable.length === 0) {
      setError('Nothing left to import.');
      return;
    }

    const payeeIds = new Map<string, string>();
    for (const name of newPayees) {
      const sample = importable.find(
        (row) => row.payee.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      payeeIds.set(name.toLocaleLowerCase(), createPayee(name, sample?.categoryId ?? null).id);
    }

    const inputs: NewTransactionInput[] = importable.map((row) => ({
      accountId,
      date: row.date,
      amount: row.amount,
      type: row.amount >= 0 ? 'income' : 'expense',
      categoryId: row.categoryId,
      payeeId:
        row.payeeId ?? payeeIds.get(row.payee.trim().toLocaleLowerCase()) ?? null,
      notes: row.notes,
    }));

    const written = importTransactions(inputs);
    onClose();
    notify(
      `Imported ${written} transaction${written === 1 ? '' : 's'}.`,
      'success',
    );
  }

  const headers = table?.headers ?? [];

  return (
    <Dialog
      title="Import CSV"
      description="Map a bank export. Amounts are stored in cents; duplicate rows are skipped by default."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="csv-import-form"
            className="button button--primary"
            disabled={!table || importable.length === 0}
          >
            Import {importable.length > 0 ? `${importable.length} rows` : ''}
          </button>
        </>
      }
    >
      <form id="csv-import-form" className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>CSV file</span>
          <input className="input" type="file" accept=".csv,text/csv" onChange={handleFile} />
        </label>
        {fileName && <p className="hint">{fileName}</p>}

        {table && (
          <>
            <label className="field">
              <span>Import into account</span>
              <select
                className="input"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Date format</span>
              <select
                className="input"
                value={format}
                onChange={(event) => setFormat(event.target.value as CsvDateFormat)}
              >
                {DATE_FORMATS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="csv-mapping">
              <legend>Columns</legend>
              {MAPPING_FIELDS.map((field) => (
                <label className="field field--inline" key={field.key}>
                  <span>
                    {field.label}
                    {field.optional ? ' (optional)' : ''}
                  </span>
                  <select
                    className="input"
                    value={mapping?.[field.key] ?? NONE}
                    onChange={(event) => setColumn(field.key, Number(event.target.value))}
                  >
                    <option value={NONE}>Not used</option>
                    {headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>

            <label className="check-row">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(event) => setSkipDuplicates(event.target.checked)}
              />
              Skip {plan.duplicates} duplicate{plan.duplicates === 1 ? '' : 's'} (same account, date,
              amount and payee)
            </label>

            <p className="hint">
              {rows.rows.length} valid rows · {rows.skipped} skipped ·{' '}
              {newPayees.length} new payee{newPayees.length === 1 ? '' : 's'} will be created ·{' '}
              {importable.length} to import
            </p>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importable.slice(0, 8).map((row, index) => (
                    <tr key={`${row.date}-${row.amount}-${index}`}>
                      <td>{row.date}</td>
                      <td>{row.payee || '—'}</td>
                      <td>
                        {categories.find((category) => category.id === row.categoryId)?.name ??
                          'Uncategorized'}
                      </td>
                      <td className="num">
                        {formatMoney(row.amount, settings.currency, settings.locale)}
                      </td>
                      <td>
                        {row.duplicate ? (
                          <span className="badge badge--warning">Duplicate</span>
                        ) : (
                          <span className="badge">New</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importable.length === 0 && (
              <p className="empty-state">No rows are ready. Check the column mapping.</p>
            )}
          </>
        )}

        {error && <p className="form-error">{error}</p>}
        {!table && (
          <p className="hint">Choose a .csv file to preview it, then confirm the column mapping.</p>
        )}
      </form>
    </Dialog>
  );
}
