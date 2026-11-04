/**
 * Autocomplete for the transaction composer.
 *
 * Finds the token under the caret (`@payee`, `#category`, `^account`, `+tag`,
 * `!cleared`) and proposes matching entities. The composer, not this module,
 * decides whether an unknown name becomes a new record.
 */

import type { Account, Category, Payee } from './types';

export type SuggestionKind = 'payee' | 'category' | 'account' | 'tag' | 'cleared';

export interface Suggestion {
  kind: SuggestionKind;
  /** Text inserted for the token, without the trigger character. */
  value: string;
  label: string;
  detail?: string;
}

export interface SuggestionContext {
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  tags: string[];
}

export interface ActiveToken {
  /** Index of the trigger character. */
  start: number;
  /** Index just past the token being completed. */
  end: number;
  trigger: string;
  query: string;
}

export const TRIGGERS = ['@', '#', '^', '+', '!'] as const;

/** The whitespace-delimited trigger token containing the caret, if any. */
export function findActiveToken(value: string, caret: number): ActiveToken | null {
  const clamped = Math.max(0, Math.min(caret, value.length));
  let start = clamped;
  while (start > 0 && !/\s/.test(value[start - 1])) start -= 1;

  let end = clamped;
  while (end < value.length && !/\s/.test(value[end])) end += 1;

  const token = value.slice(start, end);
  const trigger = token[0];
  if (!trigger || !TRIGGERS.includes(trigger as (typeof TRIGGERS)[number])) return null;

  return { start, end, trigger, query: token.slice(1) };
}

export function buildSuggestions(token: ActiveToken, context: SuggestionContext): Suggestion[] {
  const query = token.query.toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(query);

  switch (token.trigger) {
    case '@':
      return context.payees
        .filter((payee) => matches(payee.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 8)
        .map((payee) => ({ kind: 'payee', value: payee.name, label: payee.name }));

    case '#':
      return context.categories
        .filter((category) => !category.archived && matches(category.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 8)
        .map((category) => ({
          kind: 'category',
          value: category.name,
          label: category.name,
          detail: category.kind,
        }));

    case '^':
      return context.accounts
        .filter((account) => !account.archived && matches(account.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 8)
        .map((account) => ({ kind: 'account', value: account.name, label: account.name }));

    case '+':
      return context.tags
        .filter(matches)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 8)
        .map((tag) => ({ kind: 'tag', value: tag, label: `+${tag}` }));

    case '!':
      return 'cleared'.includes(query)
        ? [{ kind: 'cleared', value: 'cleared', label: 'Cleared' }]
        : [];

    default:
      return [];
  }
}

/** Replaces the active token and keeps the caret after the inserted space. */
export function applySuggestion(
  value: string,
  token: ActiveToken,
  suggestion: Suggestion,
): { value: string; caret: number } {
  const next = `${value.slice(0, token.start)}${token.trigger}${suggestion.value} ${value.slice(token.end)}`;
  return { value: next, caret: token.start + suggestion.value.length + 2 };
}

/** Every tag already used, for `+` autocomplete. */
export function collectTags(tagsPerTransaction: readonly (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const tags of tagsPerTransaction) {
    for (const tag of tags) set.add(tag);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
