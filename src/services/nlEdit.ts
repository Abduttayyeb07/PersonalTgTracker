import type { Task, User } from "../db/schema.js";
import { deleteTask, listTasks, updateTask } from "./store.js";
import { parseQuickAdd } from "./parser.js";
import { formatDue } from "../utils/format.js";

// Maps free-text priority words to the 1..4 scale.
const PRIORITY_WORDS: Record<string, number> = {
  p1: 1, p2: 2, p3: 3, p4: 4,
  urgent: 1, critical: 1,
  high: 2, important: 2,
  normal: 3, medium: 3,
  low: 4,
};

type Intent =
  | { kind: "reschedule"; phrase: string; whenText: string }
  | { kind: "priority"; phrase: string; priority: number }
  | { kind: "rename"; phrase: string; newTitle: string }
  | { kind: "complete"; phrase: string }
  | { kind: "delete"; phrase: string };

// Recognizes edit-style phrasing pointed at an EXISTING task by name, e.g.
// "move rent to next friday" or "make groceries p1". Returns null for
// anything else, so the caller can fall back to normal quick-add.
function detectIntent(text: string): Intent | null {
  const t = text.trim();

  let m = t.match(/^(?:move|reschedule|push|change)\s+(.+?)\s+to\s+(.+)$/i);
  if (m) return { kind: "reschedule", phrase: m[1].trim(), whenText: m[2].trim() };

  m = t.match(
    /^(?:make|set)\s+(.+?)\s+(?:priority\s+(?:to\s+)?)?(p[1-4]|urgent|critical|high|important|normal|medium|low)\s*$/i
  );
  if (m) {
    const p = PRIORITY_WORDS[m[2].toLowerCase()];
    if (p) return { kind: "priority", phrase: m[1].trim(), priority: p };
  }

  m = t.match(/^rename\s+(.+?)\s+to\s+(.+)$/i);
  if (m) return { kind: "rename", phrase: m[1].trim(), newTitle: m[2].trim() };

  m = t.match(/^mark\s+(.+?)\s+(?:as\s+)?done$/i) ?? t.match(/^(?:complete|finish)\s+(.+)$/i);
  if (m) return { kind: "complete", phrase: m[1].trim() };

  m = t.match(/^(?:delete|remove)\s+(.+)$/i);
  if (m) return { kind: "delete", phrase: m[1].trim() };

  return null;
}

// Fuzzy-matches the referenced phrase ("rent", "groceries") against the
// user's open task titles — substring either direction, case-insensitive.
function findMatches(phrase: string, tasks: Task[]): Task[] {
  const p = phrase.toLowerCase().replace(/^(the|my|task)\s+/, "").trim();
  if (p.length < 2) return [];
  return tasks.filter((t) => {
    const title = t.title.toLowerCase();
    return title.includes(p) || p.includes(title);
  });
}

export type NlEditOutcome =
  | { type: "not_recognized" }
  | { type: "no_match" }
  | { type: "ambiguous"; matches: Task[]; phrase: string }
  | { type: "applied"; taskId: number; verb: string }
  | { type: "deleted"; title: string }
  | { type: "completed"; taskId: number };

export async function tryNaturalLanguageEdit(user: User, text: string): Promise<NlEditOutcome> {
  const intent = detectIntent(text);
  if (!intent) return { type: "not_recognized" };

  const openTasks = await listTasks(user, "all");
  const matches = findMatches(intent.phrase, openTasks);

  if (matches.length === 0) return { type: "no_match" };
  if (matches.length > 1) return { type: "ambiguous", matches, phrase: intent.phrase };

  const task = matches[0];

  switch (intent.kind) {
    case "reschedule": {
      const parsed = parseQuickAdd(intent.whenText, user.timezone);
      if (!parsed.dueAt) return { type: "no_match" };
      await updateTask(user.userId, task.id, {
        dueAt: parsed.dueAt,
        remindAt: parsed.dueAt,
        reminderSent: false,
      });
      return { type: "applied", taskId: task.id, verb: `Moved to ${formatDue(parsed.dueAt, user.timezone)}` };
    }
    case "priority": {
      await updateTask(user.userId, task.id, { priority: intent.priority });
      return { type: "applied", taskId: task.id, verb: `Priority set to P${intent.priority}` };
    }
    case "rename": {
      await updateTask(user.userId, task.id, { title: intent.newTitle });
      return { type: "applied", taskId: task.id, verb: "Renamed" };
    }
    case "complete":
      return { type: "completed", taskId: task.id };
    case "delete": {
      await deleteTask(user.userId, task.id);
      return { type: "deleted", title: task.title };
    }
  }
}
