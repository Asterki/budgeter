/** A contains-text rule that fills in a category when the entry has none. */
import type { CategorizationRule } from './types';

export type { CategorizationRule };

/** Returns the first rule whose pattern appears in any of the provided texts. */
export function matchCategoryRule(
  rules: readonly CategorizationRule[],
  texts: readonly (string | null | undefined)[],
): CategorizationRule | undefined {
  const haystack = texts
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join(' ')
    .toLocaleLowerCase();
  if (!haystack) return undefined;
  return rules.find((rule) => {
    const needle = rule.pattern.trim().toLocaleLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}
