/**
 * Turns parsed CSV rows into transactions, using the same payee defaults and
 * contains-text rules the quick-add composer applies.
 */

import { duplicateKey, existingTransactionKeys, type CsvImportRow } from './csv';
import { matchCategoryRule } from './rules';
import type {
  CategorizationRule,
  Category,
  Payee,
  Transaction,
} from './types';

export interface ImportContext {
  accountId: string;
  payees: readonly Payee[];
  categories: readonly Category[];
  rules: readonly CategorizationRule[];
  transactions: readonly Transaction[];
}

export interface ImportPlanRow extends CsvImportRow {
  payeeId: string | null;
  categoryId: string | null;
  duplicate: boolean;
}

export interface ImportPlan {
  rows: ImportPlanRow[];
  duplicates: number;
}

function categoryByName(categories: readonly Category[], name: string): string | null {
  const needle = name.trim().toLocaleLowerCase();
  if (!needle) return null;
  return categories.find((category) => category.name.toLocaleLowerCase() === needle)?.id ?? null;
}

/**
 * Explicit CSV category wins, then the payee's saved default, then the first
 * matching text rule. Matching is deliberately case-insensitive.
 */
export function resolveImportCategory(
  row: Pick<CsvImportRow, 'category' | 'payee' | 'notes'>,
  context: Pick<ImportContext, 'payees' | 'categories' | 'rules'>,
): string | null {
  const explicit = categoryByName(context.categories, row.category);
  if (explicit) return explicit;

  const payee = context.payees.find(
    (candidate) => candidate.name.toLocaleLowerCase() === row.payee.trim().toLocaleLowerCase(),
  );
  if (payee?.defaultCategoryId) return payee.defaultCategoryId;

  return matchCategoryRule(context.rules, [row.payee, row.notes])?.categoryId ?? null;
}

export function planImport(rows: readonly CsvImportRow[], context: ImportContext): ImportPlan {
  const payeeNames = new Map(context.payees.map((payee) => [payee.id, payee.name]));
  const existing = existingTransactionKeys(context.transactions, payeeNames);
  const planned: ImportPlanRow[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = duplicateKey(context.accountId, row.date, row.amount, row.payee);
    const duplicate = existing.has(key);
    if (duplicate) duplicates += 1;
    else existing.add(key);

    const payee = context.payees.find(
      (candidate) => candidate.name.toLocaleLowerCase() === row.payee.trim().toLocaleLowerCase(),
    );

    planned.push({
      ...row,
      payeeId: payee?.id ?? null,
      categoryId: resolveImportCategory(row, context),
      duplicate,
    });
  }

  return { rows: planned, duplicates };
}
