import type { BotContext } from "../types.js";
import type { User } from "../db/schema.js";
import {
  createTask,
  listCategories,
  resolveCategory,
} from "../services/store.js";
import { extractRecurrence, parseQuickAdd } from "../services/parser.js";
import { resolveQuickDate } from "../utils/dates.js";
import {
  cancelRow,
  categoryPicker,
  datePicker,
  homeRow,
  priorityPicker,
  repeatPicker,
  taskActions,
} from "../keyboards.js";
import { taskCard } from "../utils/format.js";

// Start the guided add flow.
export async function startAddFlow(ctx: BotContext): Promise<void> {
  ctx.session.flow = { step: "await_title", draft: {} };
  await ctx.reply(
    "➕ <b>New task</b>\n\nWhat do you need to do? (send the task title, e.g. <i>Check the server every 2 days</i>)",
    { parse_mode: "HTML", reply_markup: cancelRow() }
  );
}

// Handle free-text while a flow is active (title, custom date, or custom repeat interval).
export async function handleFlowText(ctx: BotContext, user: User): Promise<void> {
  const flow = ctx.session.flow!;
  const text = ctx.message!.text!.trim();

  if (flow.step === "await_title") {
    // Detect "every N days/weeks" etc. right in the title, same as quick-add,
    // so the guided flow doesn't just store the raw sentence verbatim.
    const rec = extractRecurrence(text);
    flow.draft.title = rec.text.trim() || text;
    flow.draft.recurrence = rec.recurrence;
    flow.draft.recurrenceIntervalDays = rec.intervalDays;
    flow.step = "await_datetime";
    await ctx.reply("📅 When is it due?", {
      reply_markup: datePicker("aflow_date").row().text("❌ Cancel", "aflow_cancel"),
    });
    return;
  }
  if (flow.step === "await_datetime") {
    // User typed a custom date/time.
    const parsed = parseQuickAdd(text, user.timezone);
    flow.draft.dueAt = parsed.dueAt ? parsed.dueAt.toISOString() : null;
    await askCategory(ctx, user);
    return;
  }
  if (flow.step === "await_repeat_custom") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      await ctx.reply("Please send a whole number of days, between 1 and 365.", {
        reply_markup: cancelRow(),
      });
      return;
    }
    flow.draft.recurrence = "custom";
    flow.draft.recurrenceIntervalDays = n;
    await finalizeAdd(ctx, user, false);
    return;
  }
}

async function askCategory(ctx: BotContext, user: User): Promise<void> {
  ctx.session.flow!.step = "await_category";
  const cats = await listCategories(user.userId);
  await ctx.reply("📂 Which category?", {
    reply_markup: categoryPicker(cats, "aflow_cat").row().text("❌ Cancel", "aflow_cancel"),
  });
}

// Called from callbacks for date choice.
export async function flowPickDate(ctx: BotContext, user: User, choice: string): Promise<void> {
  const flow = ctx.session.flow;
  if (!flow) return;
  if (choice === "custom") {
    await ctx.editMessageText("⌨️ Type the date/time, e.g. <i>Friday 3pm</i> or <i>25 Dec 9am</i>", {
      parse_mode: "HTML",
      reply_markup: cancelRow(),
    });
    return;
  }
  const d = resolveQuickDate(choice, user.timezone);
  flow.draft.dueAt = d ? d.toISOString() : null;
  await ctx.editMessageText(`📅 Due: <b>${choice}</b>`, { parse_mode: "HTML" });
  await askCategory(ctx, user);
}

export async function flowPickCategory(ctx: BotContext, user: User, categoryId: number): Promise<void> {
  const flow = ctx.session.flow;
  if (!flow) return;
  flow.draft.categoryId = categoryId;
  flow.step = "await_priority";
  await ctx.editMessageText("🚩 Priority?", {
    reply_markup: priorityPicker("aflow_pri").row().text("❌ Cancel", "aflow_cancel"),
  });
}

export async function flowPickPriority(ctx: BotContext, user: User, priority: number): Promise<void> {
  const flow = ctx.session.flow;
  if (!flow) return;
  flow.draft.priority = priority;

  // Recurrence was already detected from the title text (e.g. "every 2 days") —
  // no need to ask again, go straight to creating the task.
  if (flow.draft.recurrence && flow.draft.recurrence !== "none") {
    await finalizeAdd(ctx, user, true);
    return;
  }
  flow.step = "await_repeat";
  await ctx.editMessageText("🔁 Repeat?", {
    reply_markup: repeatPicker("aflow_rep").row().text("❌ Cancel", "aflow_cancel"),
  });
}

// Called from callbacks for the repeat picker (None/Daily/Every N days/Weekly/Monthly/Custom).
export async function flowPickRepeat(ctx: BotContext, user: User, args: string[]): Promise<void> {
  const flow = ctx.session.flow;
  if (!flow) return;
  const [kind, param] = args;

  if (kind === "custom" && param === "ask") {
    flow.step = "await_repeat_custom";
    await ctx.editMessageText("🔁 Repeat every how many days? Send a number, e.g. <code>5</code>.", {
      parse_mode: "HTML",
      reply_markup: cancelRow(),
    });
    return;
  }

  if (kind === "custom") {
    flow.draft.recurrence = "custom";
    flow.draft.recurrenceIntervalDays = Number(param);
  } else {
    flow.draft.recurrence = kind as "none" | "daily" | "weekly" | "monthly";
    flow.draft.recurrenceIntervalDays = null;
  }
  await finalizeAdd(ctx, user, true);
}

// Aborts the guided add flow at any step. Used by /cancel and the ❌ Cancel button.
export async function cancelAddFlow(ctx: BotContext, viaCallback: boolean): Promise<void> {
  ctx.session.flow = undefined;
  const body = "❌ <b>Cancelled.</b> No task was created.";
  const kb = homeRow();
  if (viaCallback) {
    await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
    });
  } else {
    await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
  }
}

// Create the task from the completed draft and show the result.
async function finalizeAdd(ctx: BotContext, user: User, editMessage: boolean): Promise<void> {
  const flow = ctx.session.flow;
  if (!flow) return;
  const draft = flow.draft;
  const dueAt = draft.dueAt ? new Date(draft.dueAt) : null;
  const category = draft.categoryId
    ? (await listCategories(user.userId)).find((c) => c.id === draft.categoryId)
    : await resolveCategory(user.userId, null);

  const task = await createTask({
    userId: user.userId,
    categoryId: category?.id ?? null,
    title: draft.title!,
    dueAt,
    remindAt: dueAt,
    priority: draft.priority ?? 3,
    reminderSent: false,
    status: "pending",
    recurrence: draft.recurrence ?? "none",
    recurrenceIntervalDays: draft.recurrenceIntervalDays ?? null,
  });

  ctx.session.flow = undefined;
  const body = "✅ <b>Task created</b>\n\n" + taskCard(task, user.timezone, category ?? undefined);
  const kb = taskActions(task.id);
  if (editMessage) {
    await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
    });
  } else {
    await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
  }
}
