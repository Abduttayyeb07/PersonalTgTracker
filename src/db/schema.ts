import {
  pgTable,
  bigint,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  date,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// ---- Enums ----
export const taskStatus = pgEnum("task_status", ["pending", "done", "snoozed", "cancelled"]);
export const recurrence = pgEnum("recurrence", ["none", "daily", "weekly", "monthly"]);

// ---- Users ----
// One row per Telegram user. Multi-user isolation is enforced by user_id everywhere.
export const users = pgTable("users", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(), // Telegram user id
  chatId: bigint("chat_id", { mode: "number" }).notNull(), // where to send reminders
  name: text("name"),
  timezone: text("timezone").notNull().default("UTC"),
  digestHour: integer("digest_hour").notNull().default(9),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  lastDigestDate: date("last_digest_date"), // guards against double-sending
  lastCleanupDate: date("last_cleanup_date"), // guards end-of-day purge
  lastWeeklyReset: text("last_weekly_reset"), // ISO week key of last auto-reset, e.g. "2026-W29"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Categories (the "tabs": Personal, Professional, custom) ----
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").default("📌"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("categories_user_idx").on(t.userId),
  })
);

// ---- Tasks ----
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    // Absolute UTC instant the task/reminder is due. Null = someday/no date.
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: integer("priority").notNull().default(3), // 1 (highest) .. 4 (lowest)
    status: taskStatus("status").notNull().default("pending"),
    recurrence: recurrence("recurrence").notNull().default("none"),
    // Reminder bookkeeping
    remindAt: timestamp("remind_at", { withTimezone: true }), // when to ping; null = digest only
    reminderSent: boolean("reminder_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    byUser: index("tasks_user_idx").on(t.userId),
    byRemind: index("tasks_remind_idx").on(t.remindAt),
    byStatus: index("tasks_status_idx").on(t.status),
  })
);

// ---- Weekly work log entries ----
// Rough notes the user logs through the week; summarised into a "Weekly Update".
export const weekEntries = pgTable(
  "week_entries",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    weekKey: text("week_key").notNull(), // ISO week, e.g. "2026-W29"
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserWeek: index("week_entries_user_week_idx").on(t.userId, t.weekKey),
  })
);

export type User = typeof users.$inferSelect;
export type WeekEntry = typeof weekEntries.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
