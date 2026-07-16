import { and, asc, desc, eq, gte, isNull, lt, lte, or, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/index.js";
import { users, categories, tasks, weekEntries, topicWatches } from "../db/schema.js";
import type { Category, NewTask, Task, TopicWatch, User, WeekEntry } from "../db/schema.js";
import { config } from "../config.js";

// ---- Users ----
export async function ensureUser(
  userId: number,
  chatId: number,
  name?: string
): Promise<User> {
  const existing = await db.query.users.findFirst({ where: eq(users.userId, userId) });
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({
      userId,
      chatId,
      name: name ?? null,
      timezone: config.defaultTimezone,
      digestHour: config.defaultDigestHour,
    })
    .returning();

  await ensureDefaultCategories(userId);
  return created;
}

export async function getUser(userId: number): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.userId, userId) });
}

export async function updateUser(userId: number, patch: Partial<User>): Promise<void> {
  await db.update(users).set(patch).where(eq(users.userId, userId));
}

// ---- Categories ----
export async function ensureDefaultCategories(userId: number): Promise<void> {
  const existing = await db.query.categories.findMany({
    where: eq(categories.userId, userId),
  });
  if (existing.length > 0) return;
  await db.insert(categories).values([
    { userId, name: "Personal", emoji: "🏠", isDefault: true },
    { userId, name: "Professional", emoji: "💼", isDefault: false },
  ]);
}

export async function listCategories(userId: number): Promise<Category[]> {
  return db.query.categories.findMany({
    where: eq(categories.userId, userId),
    orderBy: asc(categories.id),
  });
}

export async function resolveCategory(
  userId: number,
  hint: string | null
): Promise<Category | null> {
  const cats = await listCategories(userId);
  if (hint) {
    const found = cats.find((c) => c.name.toLowerCase() === hint.toLowerCase());
    if (found) return found;
    // Create a new custom category for an unrecognised #tag.
    const [created] = await db
      .insert(categories)
      .values({ userId, name: hint, emoji: "📌" })
      .returning();
    return created;
  }
  return cats.find((c) => c.isDefault) ?? cats[0] ?? null;
}

// ---- Tasks ----
export async function createTask(data: NewTask): Promise<Task> {
  const [created] = await db.insert(tasks).values(data).returning();
  return created;
}

export async function getTask(userId: number, id: number): Promise<Task | undefined> {
  return db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), eq(tasks.userId, userId)),
  });
}

export async function updateTask(
  userId: number,
  id: number,
  patch: Partial<Task>
): Promise<void> {
  await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
}

export async function completeTask(userId: number, id: number): Promise<void> {
  await updateTask(userId, id, { status: "done", completedAt: new Date() });
}

// Reverts a "Done" tap — used by the Undo button.
export async function uncompleteTask(userId: number, id: number): Promise<void> {
  await updateTask(userId, id, { status: "pending", completedAt: null });
}

// Recurring tasks already have their next occurrence scheduled the moment the
// reminder fires (fixed-schedule model), so marking one "Done" must NOT flip
// status to "done" — that would exclude it from dueReminders forever and
// silently kill the series. Just record when it was last completed.
export async function acknowledgeRecurringDone(userId: number, id: number): Promise<void> {
  await updateTask(userId, id, { completedAt: new Date() });
}

export async function deleteTask(userId: number, id: number): Promise<void> {
  await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
}

export type ListFilter = "today" | "week" | "all" | "overdue" | { categoryId: number };

export async function listTasks(user: User, filter: ListFilter): Promise<Task[]> {
  const base = and(eq(tasks.userId, user.userId), ne(tasks.status, "done"), ne(tasks.status, "cancelled"));

  if (typeof filter === "object") {
    return db.query.tasks.findMany({
      where: and(base, eq(tasks.categoryId, filter.categoryId)),
      orderBy: [asc(tasks.priority), asc(tasks.dueAt)],
    });
  }

  const now = DateTime.now().setZone(user.timezone);

  if (filter === "today") {
    const end = now.endOf("day").toJSDate();
    return db.query.tasks.findMany({
      where: and(base, or(isNull(tasks.dueAt), lte(tasks.dueAt, end))),
      orderBy: [asc(tasks.dueAt), asc(tasks.priority)],
    });
  }
  if (filter === "week") {
    const end = now.plus({ days: 7 }).endOf("day").toJSDate();
    return db.query.tasks.findMany({
      where: and(base, or(isNull(tasks.dueAt), lte(tasks.dueAt, end))),
      orderBy: [asc(tasks.dueAt), asc(tasks.priority)],
    });
  }
  if (filter === "overdue") {
    return db.query.tasks.findMany({
      where: and(base, lt(tasks.dueAt, now.toJSDate())),
      orderBy: [asc(tasks.dueAt)],
    });
  }
  // all
  return db.query.tasks.findMany({
    where: base,
    orderBy: [asc(tasks.priority), asc(tasks.dueAt)],
  });
}

// Tasks due today (for the digest), in the user's local day.
export async function tasksDueToday(user: User): Promise<Task[]> {
  const now = DateTime.now().setZone(user.timezone);
  const end = now.endOf("day").toJSDate();
  return db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, user.userId),
      ne(tasks.status, "done"),
      ne(tasks.status, "cancelled"),
      or(isNull(tasks.dueAt), lte(tasks.dueAt, end))
    ),
    orderBy: [asc(tasks.priority), asc(tasks.dueAt)],
  });
}

// Reminders that are due to fire.
export async function dueReminders(): Promise<Task[]> {
  const now = new Date();
  return db.query.tasks.findMany({
    where: and(
      eq(tasks.reminderSent, false),
      eq(tasks.status, "pending"),
      lte(tasks.remindAt, now)
    ),
  });
}

// All users (for the digest loop).
export async function allUsers(): Promise<User[]> {
  return db.query.users.findMany();
}

// ---- Weekly work log ----
// ISO week key ("2026-W29") for the current moment in the user's timezone.
export function currentWeekKey(timezone: string): string {
  const dt = DateTime.now().setZone(timezone);
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, "0")}`;
}

// Human-friendly label for a week's date range in the user's timezone.
export function weekLabel(timezone: string): string {
  const dt = DateTime.now().setZone(timezone);
  const start = dt.startOf("week");
  const end = dt.endOf("week");
  return `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;
}

export async function addWeekEntry(userId: number, weekKey: string, content: string): Promise<void> {
  await db.insert(weekEntries).values({ userId, weekKey, content });
}

export async function listWeekEntries(userId: number, weekKey: string): Promise<WeekEntry[]> {
  return db.query.weekEntries.findMany({
    where: and(eq(weekEntries.userId, userId), eq(weekEntries.weekKey, weekKey)),
    orderBy: asc(weekEntries.createdAt),
  });
}

export async function clearWeekEntries(userId: number, weekKey: string): Promise<number> {
  const res = await db
    .delete(weekEntries)
    .where(and(eq(weekEntries.userId, userId), eq(weekEntries.weekKey, weekKey)))
    .returning({ id: weekEntries.id });
  return res.length;
}

// Active (not done/cancelled) tasks grouped for the priority board.
export async function boardTasks(user: User): Promise<Task[]> {
  return db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, user.userId),
      ne(tasks.status, "done"),
      ne(tasks.status, "cancelled")
    ),
    orderBy: [asc(tasks.priority), asc(tasks.dueAt)],
  });
}

// Count of open (not done/cancelled) tasks, for the "Total" summary.
export async function countOpenTasks(userId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), ne(tasks.status, "done"), ne(tasks.status, "cancelled")));
  return row?.count ?? 0;
}

// Most recently created open tasks, for the "Total" summary's preview list.
export async function recentOpenTasks(userId: number, limit: number): Promise<Task[]> {
  return db.query.tasks.findMany({
    where: and(eq(tasks.userId, userId), ne(tasks.status, "done"), ne(tasks.status, "cancelled")),
    orderBy: [desc(tasks.createdAt)],
    limit,
  });
}

/**
 * End-of-day cleanup for a "daily" board feel.
 * Deletes tasks that are finished business — done tasks, and non-recurring
 * tasks whose due date is already in the past (before the start of today).
 * PRESERVES: recurring tasks (daily/weekly/monthly reminders) and any task
 * dated today or in the future. Returns the number of tasks removed.
 */
export async function cleanupUserDay(user: User): Promise<number> {
  const startOfToday = DateTime.now().setZone(user.timezone).startOf("day").toJSDate();
  const res = await db
    .delete(tasks)
    .where(
      and(
        eq(tasks.userId, user.userId),
        eq(tasks.recurrence, "none"),
        or(
          eq(tasks.status, "done"),
          eq(tasks.status, "cancelled"),
          and(ne(tasks.status, "pending"), isNull(tasks.dueAt)),
          lt(tasks.dueAt, startOfToday)
        )
      )
    )
    .returning({ id: tasks.id });
  return res.length;
}

// ---- Topic watches (recurring "what's new" digests) ----
export async function addTopicWatch(userId: number, topic: string): Promise<TopicWatch> {
  const [created] = await db.insert(topicWatches).values({ userId, topic }).returning();
  return created;
}

export async function listTopicWatches(userId: number): Promise<TopicWatch[]> {
  return db.query.topicWatches.findMany({
    where: eq(topicWatches.userId, userId),
    orderBy: asc(topicWatches.createdAt),
  });
}

export async function deleteTopicWatch(userId: number, id: number): Promise<void> {
  await db.delete(topicWatches).where(and(eq(topicWatches.id, id), eq(topicWatches.userId, userId)));
}

export async function getTopicWatch(userId: number, id: number): Promise<TopicWatch | undefined> {
  return db.query.topicWatches.findFirst({
    where: and(eq(topicWatches.id, id), eq(topicWatches.userId, userId)),
  });
}

export async function markTopicWatchSent(id: number): Promise<void> {
  await db.update(topicWatches).set({ lastSentAt: new Date() }).where(eq(topicWatches.id, id));
}

// All watches never sent, or last sent at/before the given cutoff instant —
// i.e. due for their next "what's new" digest.
export async function dueTopicWatches(cutoff: Date): Promise<TopicWatch[]> {
  return db.query.topicWatches.findMany({
    where: or(isNull(topicWatches.lastSentAt), lte(topicWatches.lastSentAt, cutoff)),
  });
}
