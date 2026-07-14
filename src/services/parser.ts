import * as chrono from "chrono-node";
import { DateTime } from "luxon";

export interface ParsedInput {
  title: string; // cleaned title with date text & tags removed
  dueAt: Date | null; // absolute instant, or null if no date found
  priority: number; // 1..4 (default 3)
  categoryHint: string | null; // from #tag, e.g. "work"
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

  // Tidy leftover connector words at the edges.
  const title = working.replace(/\s{2,}/g, " ").replace(/^(to|for|at|on|by)\s+/i, "").trim() || input.trim();

  return { title, dueAt, priority: pr.priority, categoryHint: cat.hint };
}
