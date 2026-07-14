import type { BotContext } from "../types.js";
import type { User } from "../db/schema.js";
import {
  createTask,
  listCategories,
  resolveCategory,
} from "../services/store.js";
import { parseQuickAdd } from "../services/parser.js";
import { resolveQuickDate } from "../utils/dates.js";
import { categoryPicker, datePicker, priorityPicker, taskActions } from "../keyboards.js";
import { taskCard } from "../utils/format.js";

// Start the guided add flow.
export async function startAddFlow(ctx: BotContext): Promise<void> {
  ctx.session.flow = { step: "await_title", draft: {} };
  await ctx.reply("➕ <b>New task</b>\n\nWhat do you need to do? (send the task title)", {
    parse_mode: "HTML",
  });
}

// Handle free-text while a flow is active (title, or custom date typed in).
export async function handleFlowText(ctx: BotContext, user: User): Promise<void> {
  const flow = ctx.session.flow!;
  if (flow.step === "await_title") {
    flow.draft.title = ctx.message!.text!.trim();
    flow.step = "await_datetime";
    await ctx.reply("📅 When is it due?", { reply_markup: datePicker("aflow_date") });
    return;
  }
  if (flow.step === "await_datetime") {
    // User typed a custom date/time.
    const parsed = parseQuickAdd(ctx.message!.text!, user.timezone);
    flow.draft.dueAt = parsed.dueAt ? parsed.dueAt.toISOString() : null;
    await askCategory(ctx, user);
    return;
  }
}

async function askCategory(ctx: BotContext, user: User): Promise<void> {
  ctx.session.flow!.step = "await_category";
  const cats = await listCategories(user.userId);
  await ctx.reply("📂 Which category?", { reply_markup: categoryPicker(cats, "aflow_cat") });
}

// Called from callbacks for date choice.
export async function flowPickDate(ctx: BotContext, user: User, choice: string): Promise<void> {
  const flow = ctx.session.flow;
  if (!flow) return;
  if (choice === "custom") {
    await ctx.editMessageText("⌨️ Type the date/time, e.g. <i>Friday 3pm</i> or <i>25 Dec 9am</i>", {
      parse_mode: "HTML",
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
  await ctx.editMessageText("🚩 Priority?", { reply_markup: priorityPicker("aflow_pri") });
}

export async function flowPickPriority(ctx: BotContext, user: User, priority: number): Promise<void> {
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
    priority,
    reminderSent: false,
    status: "pending",
    recurrence: "none",
  });

  ctx.session.flow = undefined;
  await ctx.editMessageText("✅ <b>Task created</b>\n\n" + taskCard(task, user.timezone, category ?? undefined), {
    parse_mode: "HTML",
    reply_markup: taskActions(task.id),
  });
}
