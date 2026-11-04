/**
 * CSV parsing and writing for bank exports.
 *
 * Pure functions only: the import dialog reads a file, maps columns, previews
 * rows and duplicate matches, then hands plain values to the store. Amounts
 * enter and leave as integer cents; the decimal point is display syntax.
 */

import { toISODate } from './date';
import { parseAmount } from './money';

export type CsvDateFormat = 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'DD.MM.YYYY';

export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export interface CsvMapping {
  /** Column indexes; -1 means the file does not use that column. */
  date: number;
  amount: number;
  debit: number;
  credit: number;
  payee: number;
  notes: number;
  category: number;
}

export interface CsvImportRow {
  date: string;
  /** Signed cents. */
  amount: number;
  payee: string;
  notes: string;
  category: string;
}

export interface CsvParseResult {
  rows: CsvImportRow[];
  skipped: number;
}

/** Counts separators outside quoted values to pick the most likely delimiter. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0) ?? '';
  const counts = [',', ';', '\t'].map((delimiter) => {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count += 1;
    }
    return { delimiter, count };
  });
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : ',';
}

/** RFC 4180 style parser with quote escaping, CRLF support and a BOM strip. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvTable {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);

  const [headers = [], ...body] = rows;
  return {
    headers: headers.map((header) => header.trim()),
    rows: body,
    delimiter,
  };
}

function headerIndex(headers: string[], names: string[]): number {
  const lower = headers.map((header) => header.toLocaleLowerCase().trim());
  return lower.findIndex((header) => names.some((name) => header === name));
}

/** Suggests column positions from common bank header names. */
export function guessMapping(headers: string[]): CsvMapping {
  const date = headerIndex(headers, ['date', 'transaction date', 'posted date', 'booking date']);
  const amount =
    headerIndex(headers, ['amount', 'value', 'betrag', 'transaction amount']) >= 0
      ? headerIndex(headers, ['amount', 'value', 'betrag', 'transaction amount'])
      : headerIndex(headers, ['amount (net)', 'net amount']);
  const debit = headerIndex(headers, ['debit', 'withdrawal', 'money out', 'soll']);
  const credit = headerIndex(headers, ['credit', 'deposit', 'money in', 'haben']);
  const payee = headerIndex(headers, ['payee', 'description', 'merchant', 'name', 'counterparty']);
  const notes = headerIndex(headers, ['notes', 'memo', 'details', 'reference', 'purpose']);
  const category = headerIndex(headers, ['category', 'categories', 'type']);

  return {
    date,
    amount: debit >= 0 || credit >= 0 ? (amount >= 0 ? amount : -1) : amount,
    debit,
    credit,
    payee,
    notes: notes === payee ? -1 : notes,
    category,
  };
}

/** Infers a date order from the first values, preferring unambiguous rows. */
export function detectDateFormat(values: readonly string[]): CsvDateFormat {
  const samples = values.map((value) => value.trim()).filter(Boolean).slice(0, 60);
  if (samples.some((value) => /^\d{4}-\d{1,2}-\d{1,2}/.test(value))) return 'YYYY-MM-DD';
  if (samples.some((value) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(value))) return 'DD.MM.YYYY';

  let dayFirst = false;
  let monthFirst = false;
  for (const sample of samples) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(sample);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12) dayFirst = true;
    if (second > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return 'DD/MM/YYYY';
  return 'MM/DD/YYYY';
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return toISODate(date);
}

/** Parses a date cell in the selected order; returns null when it is not a date. */
export function parseCsvDate(value: string, format: CsvDateFormat): string | null {
  const text = value.trim();
  if (!text) return null;

  if (format === 'YYYY-MM-DD') {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    return match ? isoFromParts(Number(match[1]), Number(match[2]), Number(match[3])) : null;
  }

  const pattern =
    format === 'DD.MM.YYYY'
      ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
      : /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const match = pattern.exec(text);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return format === 'DD/MM/YYYY' || format === 'DD.MM.YYYY'
    ? isoFromParts(year, Number(match[2]), Number(match[1]))
    : isoFromParts(year, Number(match[1]), Number(match[2]));
}

function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : '';
}

/** Converts raw rows to signed cents using an amount, debit or credit column. */
export function parseImportRows(
  table: CsvTable,
  mapping: CsvMapping,
  format: CsvDateFormat,
  locale: string,
): CsvParseResult {
  const rows: CsvImportRow[] = [];
  let skipped = 0;

  for (const row of table.rows) {
    const date = parseCsvDate(cell(row, mapping.date), format);
    const amountText = cell(row, mapping.amount);
    const debitText = cell(row, mapping.debit);
    const creditText = cell(row, mapping.credit);

    let amount: number;
    if (debitText || creditText) {
      const debit = debitText ? parseAmount(debitText, locale) : 0;
      const credit = creditText ? parseAmount(creditText, locale) : 0;
      amount = (Number.isFinite(credit) ? Math.abs(credit) : 0) -
        (Number.isFinite(debit) ? Math.abs(debit) : 0);
    } else {
      amount = parseAmount(amountText, locale);
    }

    if (!date || !Number.isFinite(amount) || amount === 0) {
      skipped += 1;
      continue;
    }

    rows.push({
      date,
      amount: Math.round(amount),
      payee: cell(row, mapping.payee),
      notes: cell(row, mapping.notes),
      category: cell(row, mapping.category),
    });
  }

  return { rows, skipped };
}

/** Same account, calendar day, amount and payee name. */
export function duplicateKey(
  accountId: string,
  date: string,
  amount: number,
  payeeName: string,
): string {
  return [accountId, date, amount, payeeName.trim().toLocaleLowerCase()].join('|');
}

export function existingTransactionKeys(
  transactions: readonly { accountId: string; date: string; amount: number; payeeId: string | null }[],
  payeeNames: ReadonlyMap<string, string>,
): Set<string> {
  const keys = new Set<string>();
  for (const transaction of transactions) {
    const payee = transaction.payeeId ? (payeeNames.get(transaction.payeeId) ?? '') : '';
    keys.add(duplicateKey(transaction.accountId, transaction.date, transaction.amount, payee));
  }
  return keys;
}

function plainCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function quote(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvExportRow {
  date: string;
  account: string;
  amount: number;
  type: string;
  category: string;
  payee: string;
  notes: string;
  tags: string[];
  cleared: boolean;
}

export function transactionsToCsv(rows: readonly CsvExportRow[]): string {
  const header = ['Date', 'Account', 'Amount', 'Type', 'Category', 'Payee', 'Notes', 'Tags', 'Cleared'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.account,
        plainCents(row.amount),
        row.type,
        row.category,
        row.payee,
        row.notes,
        row.tags.join(' '),
        row.cleared ? 'yes' : 'no',
      ]
        .map((value) => quote(value))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
