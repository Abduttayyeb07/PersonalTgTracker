import * as chrono from "chrono-node";
import { DateTime } from "luxon";

export type RecurrenceValue = "none" | "daily" | "weekly" | "monthly" | "custom";

export interface ParsedInput {
  title: string; // cleaned title with date text & tags removed
  dueAt: Date | null; // absolute instant, or null if no date found
  priority: number; // 1..4 (default 3)
  categoryHint: string | null; // from #tag, e.g. "work"
  recurrence: RecurrenceValue;
  recurrenceIntervalDays: number | null; // only set when recurrence is "custom"
}

// Maps common words / #tags to a category name hint.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Professional: ["work", "office", "professional", "meeting", "client", "project", "standup", "deadline"],
  Personal: ["personal", "home", "family", "health", "gym", "grocery", "bills", "rent"],
};

// !p1..!p4 or "p1" priority tokens.
function extractPriority(text: string): { text: string; priority: number } {
  const m = text.match(/(?:^|\s)!?p([1-4])\b/i);
  if (m) {
    return { text: text.replace(m[0], " ").trim(), priority: Number(m[1]) };
  }
  return { text, priority: 3 };
}

function extractCategoryHint(text: string): { text: string; hint: string | null } {
  // Explicit #tag wins.
  const tag = text.match(/#(\w+)/);
  if (tag) {
    const raw = tag[1].toLowerCase();
    let hint: string | null = null;
    for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
      if (raw === cat.toLowerCase() || words.includes(raw)) hint = cat;
    }
    if (!hint) hint = tag[1][0].toUpperCase() + tag[1].slice(1); // custom category
    return { text: text.replace(tag[0], " ").trim(), hint };
  }
  // Otherwise infer from keywords (does not remove them from the title).
  const lower = text.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) return { text, hint: cat };
  }
  return { text, hint: null };
}

// Spelled-out numbers so "every two days" works, not just "every 2 days".
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  couple: 2, few: 3,
};
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function wordToNumber(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token.toLowerCase()] ?? 0;
}

// Detects recurrence phrases: "every N days"/"every two days", "every N weeks",
// "every day", "daily"/"weekly"/"monthly". Strips the matched phrase out of the text.
export function extractRecurrence(
  text: string
): { text: string; recurrence: RecurrenceValue; intervalDays: number | null } {
  const dayRe = new RegExp(`\\bevery\\s+(\\d+|${NUMBER_WORD_PATTERN})\\s*(?:of\\s+)?day(s)?\\b`, "i");
  let m = text.match(dayRe);
  if (m) {
    const n = Math.max(1, wordToNumber(m[1]));
    return { text: text.replace(m[0], " ").trim(), recurrence: "custom", intervalDays: n };
  }
  const weekRe = new RegExp(`\\bevery\\s+(\\d+|${NUMBER_WORD_PATTERN})\\s*(?:of\\s+)?week(s)?\\b`, "i");
  m = text.match(weekRe);
  if (m) {
    const n = Math.max(1, wordToNumber(m[1]));
    return { text: text.replace(m[0], " ").trim(), recurrence: "custom", intervalDays: n * 7 };
  }
  if (/\bevery\s*day\b/i.test(text)) {
    return { text: text.replace(/\bevery\s*day\b/i, " ").trim(), recurrence: "daily", intervalDays: null };
  }
  if (/\bevery\s*week\b/i.test(text)) {
    return { text: text.replace(/\bevery\s*week\b/i, " ").trim(), recurrence: "weekly", intervalDays: null };
  }
  if (/\bevery\s*month\b/i.test(text)) {
    return { text: text.replace(/\bevery\s*month\b/i, " ").trim(), recurrence: "monthly", intervalDays: null };
  }
  if (/\bdaily\b/i.test(text)) {
    return { text: text.replace(/\bdaily\b/i, " ").trim(), recurrence: "daily", intervalDays: null };
  }
  if (/\bweekly\b/i.test(text)) {
    return { text: text.replace(/\bweekly\b/i, " ").trim(), recurrence: "weekly", intervalDays: null };
  }
  if (/\bmonthly\b/i.test(text)) {
    return { text: text.replace(/\bmonthly\b/i, " ").trim(), recurrence: "monthly", intervalDays: null };
  }
  return { text, recurrence: "none", intervalDays: null };
}

/**
 * Parse a free-text quick-add string into a structured task.
 * Interprets dates in the user's timezone so "tomorrow 9am" is their 9am.
 */
export function parseQuickAdd(input: string, timezone: string): ParsedInput {
  let working = input.trim();

  const pr = extractPriority(working);
  working = pr.text;

  const cat = extractCategoryHint(working);
  working = cat.text;

  const rec = extractRecurrence(working);
  working = rec.text;

  // Reference "now" in the user's timezone so relative dates resolve correctly.
  const refNow = DateTime.now().setZone(timezone).toJSDate();
  const results = chrono.parse(working, refNow, { forwardDate: true });

  let dueAt: Date | null = null;
  if (results.length > 0) {
    const r = results[0];
    // Assume the parsed wall-clock time is in the user's timezone.
    const comps = r.start;
    const iso = DateTime.fromObject(
      {
        year: comps.get("year") ?? undefined,
        month: comps.get("month") ?? undefined,
        day: comps.get("day") ?? undefined,
        hour: comps.get("hour") ?? 9, // default 9am if only a date was given
        minute: comps.get("minute") ?? 0,
      },
      { zone: timezone }
    );
    if (iso.isValid) dueAt = iso.toJSDate();
    // Strip the matched date text out of the title.
    working = (working.slice(0, r.index) + working.slice(r.index + r.text.length)).trim();
  }

  // A recurring task needs a starting point even if no explicit time was given
  // (e.g. "check the server every 2 days" with no date). Default to tomorrow 9am.
  if (!dueAt && rec.recurrence !== "none") {
    dueAt = DateTime.now()
      .setZone(timezone)
      .plus({ days: 1 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
      .toJSDate();
  }

  // Tidy leftover connector words at the edges.
  const title = working.replace(/\s{2,}/g, " ").replace(/^(to|for|at|on|by)\s+/i, "").trim() || input.trim();

  return {
    title,
    dueAt,
    priority: pr.priority,
    categoryHint: cat.hint,
    recurrence: rec.recurrence,
    recurrenceIntervalDays: rec.intervalDays,
  };
}
