/**
 * Suggestion engine for the quick-add field.
 *
 * As the user types a trigger character the field turns into a dropdown of what
 * already exists, so nothing has to be remembered or spelled out:
 *
 *   `#`  projects (grouped by category)   `^`  categories
 *   `@`  places                           `!`  priorities 1–4
 *   `+`  tags from the resolved project
 *
 * This is pure logic — the rendering lives in `components/QuickAdd.tsx`.
 */

import type { Category, Place, Project } from './types';

export const TRIGGERS = ['#', '^', '@', '!', '+'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export interface ActiveToken {
  /** Index of the trigger character in the raw input. */
  start: number;
  /** Caret index (exclusive end of the token). */
  end: number;
  trigger: Trigger;
  /** Everything typed after the trigger. */
  query: string;
}

export interface Suggestion {
  /** Text that replaces the whole token when accepted. */
  insert: string;
  label: string;
  /** Secondary line: category name, place count, priority description… */
  hint?: string;
  color?: string;
  /** Group header used to separate projects by category. */
  group?: string;
}

export interface SuggestionContext {
  categories: Category[];
  projects: Project[];
  places: Place[];
  /** Currently resolved project, used to scope the `+tag` list. */
  projectId: string | null;
}

/**
 * Finds the token the caret currently sits in, or null when the user is just
 * writing prose. A token ends at the first whitespace before the caret.
 */
export function findActiveToken(value: string, caret: number): ActiveToken | null {
  const head = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  let start = head.length;
  while (start > 0 && !/\s/.test(head[start - 1])) start -= 1;

  const word = head.slice(start);
  if (word.length === 0) return null;

  const trigger = word[0] as Trigger;
  if (!TRIGGERS.includes(trigger)) return null;

  return { start, end: head.length, trigger, query: word.slice(1) };
}

const PRIORITY_SUGGESTIONS: Suggestion[] = [
  { insert: '!1', label: 'Priority 1', hint: 'Urgent' },
  { insert: '!2', label: 'Priority 2', hint: 'High' },
  { insert: '!3', label: 'Priority 3', hint: 'Medium' },
  { insert: '!4', label: 'Priority 4', hint: 'None' },
];

function matches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Builds the dropdown contents for the active token. Never empty for a valid trigger. */
export function buildSuggestions(token: ActiveToken, context: SuggestionContext): Suggestion[] {
  const { categories, projects, places } = context;
  const query = token.query.trim();

  switch (token.trigger) {
    case '^':
      return categories
        .filter((category) => matches(category.name, query))
        .map((category) => ({
          insert: `^${category.name}`,
          label: category.name,
          color: category.color,
          hint: `${projects.filter((project) => project.categoryId === category.id).length} projects`,
        }));

    case '#': {
      // "UNAH" finds the project; "Work" finds every project inside that category.
      const categoryHit = categories.find((category) => matches(category.name, query));
      const categoryIds = new Set(
        categoryHit ? [categoryHit.id] : categories.filter((c) => matches(c.name, query)).map((c) => c.id),
      );

      const categoryName = (categoryId: string | null) =>
        categoryId ? categories.find((c) => c.id === categoryId)?.name ?? 'Uncategorised' : 'Uncategorised';

      return projects
        .filter((project) => matches(project.name, query) || categoryIds.has(project.categoryId ?? ''))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((project) => ({
          insert: `#${project.name}`,
          label: project.name,
          color: project.color,
          group: categoryName(project.categoryId),
        }));
    }

    case '@':
      return places
        .filter((place) => matches(place.name, query))
        .map((place) => ({ insert: `@${place.name}`, label: place.name }));

    case '!': {
      const digits = query.replace(/^p/i, '');
      return PRIORITY_SUGGESTIONS.filter((item) => !digits || item.insert.includes(digits));
    }

    case '+': {
      const scoped = context.projectId
        ? projects.filter((project) => project.id === context.projectId)
        : projects;
      const seen = new Set<string>();
      const out: Suggestion[] = [];
      for (const project of scoped) {
        for (const tag of project.tags) {
          if (seen.has(tag.name) || !matches(tag.name, query)) continue;
          seen.add(tag.name);
          out.push({ insert: `+${tag.name}`, label: tag.name, color: tag.color, group: project.name });
        }
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    }
  }
}

/** Replaces the active token with a suggestion's text and returns the new value + caret. */
export function applySuggestion(
  value: string,
  token: ActiveToken,
  suggestion: Suggestion,
): { value: string; caret: number } {
  const next = `${value.slice(0, token.start)}${suggestion.insert} ${value.slice(token.end)}`;
  return { value: next.replace(/\s+/g, ' '), caret: token.start + suggestion.insert.length + 1 };
}
