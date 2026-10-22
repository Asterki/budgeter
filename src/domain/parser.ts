/**
 * Inline natural-language parser (Todoist style).
 *
 * Runs on every keystroke over the quick-add field and extracts structured
 * metadata from free text, leaving a clean title behind.
 *
 *   "Create a new feature in the app @work tomorrow !1 #UNAH"
 *     -> title  "Create a new feature in the app"
 *        place  "work"
 *        date   2026-10-23 (the next calendar day)
 *        priority 1
 *        project "UNAH"
 *
 * Recognised tokens
 *   @place        contextual / physical place
 *   !1 … !4       priority (1 highest, 4 default)
 *   #Project      project (created on save when it does not exist yet)
 *   +tag          tag from the target project
 *   dates         today, tomorrow, tonight, fri, next monday, in 3 days,
 *                 25/10, 2026-10-25, Oct 25, 25 Oct
 *   times         3pm, 3:30pm, 15:00, at 7, noon, evening
 *   ranges        9-11am, from 9 to 11am  (sets a duration)
 *   recurrence    every day, every 2 weeks, every monday, every month,
 *                 every 1st, daily / weekly / monthly / yearly
 */

import type { Place, Priority, Project, RecurrenceFreq, RecurrenceRule } from './types';
import { nextOccurrence } from './recurrence';
import {
  addDays,
  addMonths,
  fromISODate,
  isValidISODate,
  MONTHS,
  parseTimeToken,
  timeToMinutes,
  todayISO,
  WEEKDAYS_SHORT,
} from './date';

export type ParsedTokenKind =
  | 'project'
  | 'place'
  | 'priority'
  | 'date'
  | 'time'
  | 'duration'
  | 'recurrence'
  | 'tag';

export interface ParsedToken {
  kind: ParsedTokenKind;
  raw: string;
  label: string;
}

export interface ParsedInput {
  title: string;
  projectId: string | null;
  projectName: string | null;
  place: string | null;
  priority: Priority;
  date: string | null;
  time: string | null;
  duration: number;
  allDay: boolean;
  recurrence: RecurrenceRule | null;
  tags: string[];
  tokens: ParsedToken[];
}

export interface ParseContext {
  projects: Project[];
  places: Place[];
  /** Used when the text contains no `#project` token. */
  fallbackProjectId?: string | null;
}

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Full names plus the common 3-letter abbreviations. */
const WEEKDAY_PATTERN =
  '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)';

function weekdayIndex(name: string): number {
  const lower = name.toLowerCase();
  const exact = WEEKDAY_NAMES.indexOf(lower);
  if (exact >= 0) return exact;
  if (lower.length < 3) return -1;
  // Abbreviations resolve by prefix: "fri" -> friday, "tue" -> tuesday.
  return WEEKDAY_NAMES.findIndex((day) => day.startsWith(lower));
}

/** Next calendar date whose weekday matches `name` (strictly after today). */
function upcomingWeekday(name: string): string | null {
  const target = weekdayIndex(name);
  if (target < 0) return null;
  const today = todayISO();
  for (let i = 1; i <= 7; i += 1) {
    const candidate = addDays(today, i);
    if (fromISODate(candidate).getDay() === target) return candidate;
  }
  return null;
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.toLowerCase().slice(0, 3) === lower);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses raw quick-add text into structured task metadata.
 * Pure function — safe to call on every keystroke.
 */
export function parseTaskInput(input: string, context: ParseContext): ParsedInput {
  let working = ` ${input.replace(/\s+/g, ' ')} `;
  const tokens: ParsedToken[] = [];

  const result: ParsedInput = {
    title: '',
    projectId: null,
    projectName: null,
    place: null,
    priority: 4,
    date: null,
    time: null,
    duration: 0,
    allDay: true,
    recurrence: null,
    tags: [],
    tokens,
  };

  /** Remove the first match of `re` from the working string. */
  function consume(re: RegExp): RegExpMatchArray | null {
    const match = working.match(re);
    if (!match || match.index === undefined) return null;
    const before = working.slice(0, match.index);
    const after = working.slice(match.index + match[0].length);
    working = `${before} ${after}`.replace(/\s+/g, ' ');
    return match;
  }

  // ── 1. Project ────────────────────────────────────────────────────────────
  // Prefer the longest known project name so "#Deep Work" beats "#Deep".
  const knownProjects = [...context.projects].sort((a, b) => b.name.length - a.name.length);
  let projectRaw: string | null = null;
  for (const project of knownProjects) {
    const pattern = new RegExp(`(?:^|\\s)#${escapeRegExp(project.name)}(?=\\s|$)`, 'iu');
    if (pattern.test(working)) {
      consume(pattern);
      result.projectId = project.id;
      result.projectName = project.name;
      projectRaw = `#${project.name}`;
      break;
    }
  }
  if (!projectRaw) {
    const projectMatch = consume(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
    if (projectMatch) {
      // Unknown name: remember it so saving the task can create the project.
      result.projectName = projectMatch[1];
      projectRaw = projectMatch[0].trim();
    }
  }
  if (projectRaw) {
    tokens.push({ kind: 'project', raw: projectRaw, label: result.projectName ?? projectRaw });
  }

  // ── 2. Place ──────────────────────────────────────────────────────────────
  const placeMatch = consume(/(?:^|\s)@([\p{L}\p{N}_-]+)/u);
  if (placeMatch) {
    result.place = placeMatch[1];
    tokens.push({ kind: 'place', raw: placeMatch[0].trim(), label: `@${placeMatch[1]}` });
  }

  // ── 3. Priority ───────────────────────────────────────────────────────────
  const priorityMatch = consume(/(?:^|\s)!(?:p)?([1-4])(?=\s|$)/i);
  if (priorityMatch) {
    result.priority = Number(priorityMatch[1]) as Priority;
    tokens.push({ kind: 'priority', raw: priorityMatch[0].trim(), label: `Priority ${priorityMatch[1]}` });
  }

  // ── 4. Recurrence (before dates, so "every monday" is not read as a date) ──
  const recurrence = parseRecurrence(working, consume);
  if (recurrence) {
    result.recurrence = recurrence.rule;
    tokens.push({ kind: 'recurrence', raw: recurrence.raw, label: recurrence.label });
  }

  // ── 5. Duration range ─────────────────────────────────────────────────────
  const rangeMatch =
    consume(/\bfrom\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ??
    consume(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (rangeMatch) {
    const startMeridiem = rangeMatch[3] || rangeMatch[6];
    const endMeridiem = rangeMatch[6] || rangeMatch[3];
    const start = parseTimeToken(`${rangeMatch[1]}${rangeMatch[2] ? `:${rangeMatch[2]}` : ''}${startMeridiem ?? ''}`);
    const end = parseTimeToken(`${rangeMatch[4]}${rangeMatch[5] ? `:${rangeMatch[5]}` : ''}${endMeridiem ?? ''}`);
    if (start && end) {
      const minutes = timeToMinutes(end) - timeToMinutes(start);
      result.time = start;
      result.duration = minutes > 0 ? minutes : 0;
      result.allDay = false;
      tokens.push({ kind: 'time', raw: rangeMatch[0].trim(), label: start });
      if (result.duration > 0) {
        tokens.push({ kind: 'duration', raw: rangeMatch[0].trim(), label: `${result.duration} min` });
      }
    }
  }

  // ── 6. Date ───────────────────────────────────────────────────────────────
  const date = parseDate(working, consume);
  if (date) {
    result.date = date.iso;
    tokens.push({ kind: 'date', raw: date.raw, label: date.label });
    if (date.night) {
      result.allDay = false;
      if (!result.time) result.time = '20:00';
    }
  }

  // ── 7. Time ───────────────────────────────────────────────────────────────
  if (!result.time) {
    const time = parseTime(working, consume);
    if (time) {
      result.time = time.value;
      result.allDay = false;
      tokens.push({ kind: 'time', raw: time.raw, label: time.value });
    }
  }

  // ── 8. Tags ───────────────────────────────────────────────────────────────
  let tagMatch = consume(/(?:^|\s)\+([\p{L}\p{N}_-]+)/u);
  while (tagMatch) {
    result.tags.push(tagMatch[1]);
    tokens.push({ kind: 'tag', raw: tagMatch[0].trim(), label: `+${tagMatch[1]}` });
    tagMatch = consume(/(?:^|\s)\+([\p{L}\p{N}_-]+)/u);
  }

  // ── 9. Title + final defaults ─────────────────────────────────────────────
  result.title = working.replace(/\s+/g, ' ').trim();

  // Drop a preposition that was left behind by a consumed date/time token
  // ("Ship v2 on" -> "Ship v2").
  if ((result.date || result.time) && result.title) {
    result.title = result.title.replace(/\s*\b(on|at|by|due|from)\b\s*$/i, '').trim();
  }

  // A recurring task with no explicit date starts at its first occurrence.
  if (result.recurrence && !result.date) {
    result.date = firstOccurrence(result.recurrence);
  }

  if (result.time && !result.date) result.date = todayISO();
  if (result.date && !result.time) result.allDay = true;
  if (!result.projectId && context.fallbackProjectId !== undefined) {
    result.projectId = context.fallbackProjectId;
  }
  if (result.projectId && !result.projectName) {
    result.projectName = context.projects.find((p) => p.id === result.projectId)?.name ?? null;
  }

  return result;
}

/** First date a recurrence rule can land on, starting from today. */
function firstOccurrence(rule: RecurrenceRule): string {
  const today = todayISO();
  // Plain interval rules (and yearly ones) simply start today; weekday and
  // day-of-month rules snap forward to their next matching calendar day.
  if (rule.freq === 'daily' || rule.freq === 'yearly') return today;
  return nextOccurrence(rule, addDays(today, -1));
}

// ── Recurrence parsing ───────────────────────────────────────────────────────

function makeRule(freq: RecurrenceFreq, interval: number): RecurrenceRule {
  return { freq, interval, byWeekday: [], byMonthDay: [], until: null, count: null };
}

function parseRecurrence(
  _working: string,
  consume: (re: RegExp) => RegExpMatchArray | null,
): { rule: RecurrenceRule; raw: string; label: string } | null {
  const base = (rule: RecurrenceRule, raw: string, label: string) => ({ rule, raw, label });

  const everyDay = consume(/\bevery\s+(\d+)\s*(day|days)\b/i) ?? consume(/\bevery\s+day\b/i);
  if (everyDay) {
    const interval = everyDay[1] ? Number(everyDay[1]) : 1;
    const rule = makeRule('daily', interval);
    return base(rule, everyDay[0], interval === 1 ? 'Every day' : `Every ${interval} days`);
  }

  const everyWeek = consume(/\bevery\s+(\d+)\s*(week|weeks)\b/i) ?? consume(/\bevery\s+week\b/i);
  if (everyWeek) {
    const interval = everyWeek[1] ? Number(everyWeek[1]) : 1;
    const rule = makeRule('weekly', interval);
    return base(rule, everyWeek[0], interval === 1 ? 'Every week' : `Every ${interval} weeks`);
  }

  const everyWeekday = consume(new RegExp(`\\bevery\\s+${WEEKDAY_PATTERN}\\b`, 'i'));
  if (everyWeekday) {
    const rule = makeRule('weekly', 1);
    rule.byWeekday = [weekdayIndex(everyWeekday[1])];
    return base(rule, everyWeekday[0], `Every ${WEEKDAYS_SHORT[rule.byWeekday[0]]}`);
  }

  const everyMonth = consume(/\bevery\s+(\d+)\s*(month|months)\b/i) ?? consume(/\bevery\s+month\b/i);
  if (everyMonth) {
    const interval = everyMonth[1] ? Number(everyMonth[1]) : 1;
    const rule = makeRule('monthly', interval);
    return base(rule, everyMonth[0], interval === 1 ? 'Every month' : `Every ${interval} months`);
  }

  const everyMonthDay = consume(/\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b/i);
  if (everyMonthDay) {
    const rule = makeRule('monthly', 1);
    rule.byMonthDay = [Number(everyMonthDay[1])];
    return base(rule, everyMonthDay[0], `Every month on day ${everyMonthDay[1]}`);
  }

  const everyYear = consume(/\bevery\s+(\d+)?\s*(year|years)\b/i) ?? consume(/\b(?:yearly|annually)\b/i);
  if (everyYear) {
    const interval = everyYear[1] ? Number(everyYear[1]) : 1;
    const rule = makeRule('yearly', interval);
    return base(rule, everyYear[0], interval === 1 ? 'Every year' : `Every ${interval} years`);
  }

  const shorthand = consume(/\b(daily|weekly|monthly)\b/i);
  if (shorthand) {
    const word = shorthand[1].toLowerCase();
    const rule = makeRule(word as RecurrenceFreq, 1);
    return base(rule, shorthand[0], `Every ${word.replace('ly', '')}`);
  }

  return null;
}

// ── Date parsing ─────────────────────────────────────────────────────────────

function parseDate(
  _working: string,
  consume: (re: RegExp) => RegExpMatchArray | null,
): { iso: string; raw: string; label: string; night?: boolean } | null {
  const today = todayISO();

  const named = consume(/\b(today|tomorrow|tonight)\b/i);
  if (named) {
    const word = named[1].toLowerCase();
    if (word === 'today') return { iso: today, raw: named[0], label: 'Today' };
    if (word === 'tonight') return { iso: today, raw: named[0], label: 'Tonight', night: true };
    return { iso: addDays(today, 1), raw: named[0], label: 'Tomorrow' };
  }

  const inN = consume(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (inN) {
    const n = Number(inN[1]);
    const unit = inN[2].toLowerCase();
    let iso = today;
    if (unit.startsWith('day')) iso = addDays(today, n);
    else if (unit.startsWith('week')) iso = addDays(today, n * 7);
    else iso = addMonths(today, n);
    return { iso, raw: inN[0], label: inN[0].trim() };
  }

  const nextWeekday = consume(new RegExp(`\\bnext\\s+${WEEKDAY_PATTERN}\\b`, 'i'));
  if (nextWeekday) {
    const iso = upcomingWeekday(nextWeekday[1]);
    if (iso) return { iso, raw: nextWeekday[0], label: nextWeekday[0].trim() };
  }

  const thisWeekday = consume(new RegExp(`\\bthis\\s+${WEEKDAY_PATTERN}\\b`, 'i'));
  if (thisWeekday) {
    const iso = upcomingWeekday(thisWeekday[1]);
    if (iso) return { iso, raw: thisWeekday[0], label: thisWeekday[0].trim() };
  }

  const nextPeriod = consume(/\bnext\s+(week|month|year)\b/i);
  if (nextPeriod) {
    const unit = nextPeriod[1].toLowerCase();
    const iso = unit === 'week' ? addDays(today, 7) : unit === 'month' ? addMonths(today, 1) : addMonths(today, 12);
    return { iso, raw: nextPeriod[0], label: nextPeriod[0].trim() };
  }

  const iso = consume(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && isValidISODate(iso[0])) {
    return { iso: iso[0], raw: iso[0], label: iso[0] };
  }

  const slash = consume(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : fromISODate(today).getFullYear();
    if (year < 100) year += 2000;
    if (a > 12 && b <= 12) [a, b] = [b, a]; // day/month input
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
      let candidate = `${year}-${pad(a)}-${pad(b)}`;
      if (!isValidISODate(candidate)) return null;
      // A bare M/D in the past rolls to next year.
      if (!slash[3] && candidate < today) candidate = `${year + 1}-${pad(a)}-${pad(b)}`;
      return { iso: candidate, raw: slash[0], label: candidate };
    }
  }

  const monthDay = consume(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i,
  );
  if (monthDay) {
    const month = monthIndex(monthDay[1]);
    const day = Number(monthDay[2]);
    let year = monthDay[3] ? Number(monthDay[3]) : fromISODate(today).getFullYear();
    const candidate = `${year}-${pad(month + 1)}-${pad(day)}`;
    if (!isValidISODate(candidate)) return null;
    if (!monthDay[3] && candidate < today) year += 1;
    const finalISO = `${year}-${pad(month + 1)}-${pad(day)}`;
    return { iso: finalISO, raw: monthDay[0], label: finalISO };
  }

  const dayMonth = consume(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?\b/i);
  if (dayMonth) {
    const month = monthIndex(dayMonth[2]);
    const day = Number(dayMonth[1]);
    let year = dayMonth[3] ? Number(dayMonth[3]) : fromISODate(today).getFullYear();
    let candidate = `${year}-${pad(month + 1)}-${pad(day)}`;
    if (!isValidISODate(candidate)) return null;
    if (!dayMonth[3] && candidate < today) candidate = `${year + 1}-${pad(month + 1)}-${pad(day)}`;
    return { iso: candidate, raw: dayMonth[0], label: candidate };
  }

  const bareWeekday = consume(new RegExp(`\\b${WEEKDAY_PATTERN}\\b`, 'i'));
  if (bareWeekday) {
    const iso = upcomingWeekday(bareWeekday[1]);
    if (iso) return { iso, raw: bareWeekday[0], label: bareWeekday[0].trim() };
  }

  return null;
}

// ── Time parsing ─────────────────────────────────────────────────────────────

function parseTime(
  _working: string,
  consume: (re: RegExp) => RegExpMatchArray | null,
): { value: string; raw: string } | null {
  const meridiem = consume(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (meridiem) {
    const value = parseTimeToken(`${meridiem[1]}${meridiem[2] ? `:${meridiem[2]}` : ''}${meridiem[3]}`);
    if (value) return { value, raw: meridiem[0] };
  }

  const clock = consume(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i);
  if (clock) {
    const value = parseTimeToken(`${clock[1]}:${clock[2]}`);
    if (value) return { value, raw: clock[0] };
  }

  const atHour = consume(/\bat\s+(\d{1,2})\b/i);
  if (atHour) {
    const value = parseTimeToken(atHour[1]);
    if (value) return { value, raw: atHour[0] };
  }

  const named = consume(/\b(noon|midday|midnight|morning|afternoon|evening|night)\b/i);
  if (named) {
    const value = parseTimeToken(named[1]);
    if (value) return { value, raw: named[0] };
  }

  return null;
}
