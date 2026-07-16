import type { Context, SessionFlavor } from "grammy";

// Transient state for the guided /add flow (in-memory session).
export interface AddDraft {
  title?: string;
  categoryId?: number | null;
  dueAt?: string | null; // ISO string
  remindAt?: string | null; // ISO string
  priority?: number;
  recurrence?: "none" | "daily" | "weekly" | "monthly" | "custom";
  recurrenceIntervalDays?: number | null;
}

export interface SessionData {
  flow?: {
    step:
      | "await_title"
      | "await_datetime"
      | "await_category"
      | "await_priority"
      | "await_repeat"
      | "await_repeat_custom";
    draft: AddDraft;
  };
  // For settings prompts (timezone / digest hour) awaiting a free-text reply.
  awaiting?: "timezone" | "digest_hour" | "edit_title" | "week_log" | "recurrence_days" | "watch_topic";
  editTaskId?: number;
}

export type BotContext = Context & SessionFlavor<SessionData>;
