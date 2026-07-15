import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import type { ListFilter } from "../services/store.js";
import {
  acknowledgeRecurringDone,
  boardTasks,
  completeTask,
  getTask,
  listCategories,
  listTasks,
  uncompleteTask,
} from "../services/store.js";
import type { Category, Task, User } from "../db/schema.js";
import { formatDue, priorityLabel, taskCard, taskLine } from "../utils/format.js";
import { backRow, boardMenu, taskActions } from "../keyboards.js";

// Buttons that reliably open each task's card — plain "/task_id" text inside
// <code>/<blockquote> formatting is NOT tappable in Telegram, so we use real
// inline buttons instead. One row per task, truncated title with priority + category.
function openTaskButtons(tasks: Task[], catMap: Map<number, Category>, footer?: InlineKeyboard): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const t of tasks) {
    const cat = catMap.get(t.categoryId ?? -1);
    const dot = priorityLabel(t.priority).split(" ")[0];
    const label = `${dot} ${cat ? cat.emoji + " " : ""}${truncate(t.title, 32)}`;
    kb.text(label, `card:${t.id}`).row();
  }
  if (footer) kb.append(footer);
  return kb;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const FILTER_TITLE: Record<string, string> = {
  today: "📋 Today",
  week: "🗓 This week",
  all: "📚 All tasks",
  overdue: "⚠️ Overdue",
};

// Render a list of tasks as a single message. `backTo` is the callback for the
// up-one-level button (category lists go back to the categories menu; others to menu).
export async function renderList(
  ctx: BotContext,
  user: User,
  filter: ListFilter,
  edit = false,
  backTo = "menu"
): Promise<void> {
  const cats = await listCategories(user.userId);
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const tasks = await listTasks(user, filter);

  const title =
    typeof filter === "object"
      ? `${catMap.get(filter.categoryId)?.emoji ?? "📂"} ${catMap.get(filter.categoryId)?.name ?? "Category"}`
      : FILTER_TITLE[filter] ?? "Tasks";

  if (tasks.length === 0) {
    const body = `${title}\n\n<blockquote>✨ Nothing here. Add one with /add or just type it.</blockquote>`;
    const kb = backRow(backTo);
    return edit
      ? void (await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {}))
      : void (await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb }));
  }

  const lines = tasks.map((t) => taskLine(t, user.timezone, catMap.get(t.categoryId ?? -1)));
  const body = `${title}  ·  <i>${tasks.length}</i>\n\n<blockquote>${lines.join("\n")}</blockquote>\n<i>Tap a task below to open it 👇</i>`;
  const kb = openTaskButtons(tasks, catMap, backRow(backTo));

  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

// Priority "board": tasks grouped into Critical / Important / Normal / Low columns.
const BOARD_GROUPS: { priority: number; label: string }[] = [
  { priority: 1, label: "🔴 <b>CRITICAL</b>" },
  { priority: 2, label: "🟠 <b>IMPORTANT</b>" },
  { priority: 3, label: "🟡 <b>NORMAL</b>" },
  { priority: 4, label: "⚪ <b>LOW</b>" },
];

export async function renderBoard(ctx: BotContext, user: User, edit = false): Promise<void> {
  const cats = await listCategories(user.userId);
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const tasks = await boardTasks(user);

  const byPriority = new Map<number, Task[]>();
  for (const t of tasks) {
    const p = Math.min(4, Math.max(1, t.priority));
    (byPriority.get(p) ?? byPriority.set(p, []).get(p)!).push(t);
  }

  const header = `🗂 <b>Your Board</b>  ·  <i>${tasks.length} open</i>`;
  if (tasks.length === 0) {
    const body = `${header}\n\n<blockquote>✨ All clear. Add a task with /add or just type one.</blockquote>`;
    return edit
      ? void (await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: boardMenu() }).catch(() => {}))
      : void (await ctx.reply(body, { parse_mode: "HTML", reply_markup: boardMenu() }));
  }

  // One blockquote "column" per non-empty priority group.
  const sections = BOARD_GROUPS.flatMap((g) => {
    const items = byPriority.get(g.priority) ?? [];
    if (items.length === 0) return [];
    const lines = items
      .map((t) => {
        const cat = catMap.get(t.categoryId ?? -1);
        const due = t.dueAt ? ` <i>· ${formatDue(t.dueAt, user.timezone)}</i>` : "";
        return `${cat ? cat.emoji + " " : "• "}${escapeTitle(t.title)}${due}`;
      })
      .join("\n");
    return [`<blockquote>${g.label} · ${items.length}\n${lines}</blockquote>`];
  });

  const body = `${header}\n\n${sections.join("\n")}\n<i>Tap a task below to open it 👇</i>`;
  const kb = openTaskButtons(tasks, catMap, boardMenu());
  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

function escapeTitle(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render a single task as a card with action buttons.
export async function renderCard(
  ctx: BotContext,
  user: User,
  taskId: number,
  edit = false
): Promise<void> {
  const cats = await listCategories(user.userId);
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const task = (await listTasks(user, "all")).find((t) => t.id === taskId);
  if (!task) {
    const msg = "Task not found (maybe it was completed or deleted).";
    return edit
      ? void (await ctx.editMessageText(msg).catch(() => {}))
      : void (await ctx.reply(msg));
  }
  const body = taskCard(task, user.timezone, catMap.get(task.categoryId ?? -1));
  const kb = taskActions(task.id);
  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

// Shared "mark done" handler used by both the ✅ Done button and natural-language
// completion ("mark rent done"). Recurring tasks keep status "pending" so they
// keep firing on schedule — only their completedAt is recorded.
export async function handleMarkDone(
  ctx: BotContext,
  user: User,
  taskId: number,
  edit: boolean
): Promise<void> {
  const task = await getTask(user.userId, taskId);
  if (!task) {
    const msg = "Task not found (maybe it was already deleted).";
    if (edit) await ctx.editMessageText(msg).catch(() => {});
    else await ctx.reply(msg);
    return;
  }

  const isRecurring = task.recurrence !== "none";
  if (isRecurring) await acknowledgeRecurringDone(user.userId, taskId);
  else await completeTask(user.userId, taskId);

  const kb = new InlineKeyboard().text("↩️ Undo", `undone:${taskId}`).text("🏠 Home", "menu:back");
  const body = isRecurring
    ? "✅ <b>Nice work!</b> This will keep reminding you on schedule."
    : "✅ <b>Done!</b> Nice work.";

  if (edit) {
    await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
    });
  } else {
    await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
  }
}

// Reverts a "Done" tap (works for both the one-off and recurring cases above).
export async function handleUndoDone(ctx: BotContext, user: User, taskId: number): Promise<void> {
  await uncompleteTask(user.userId, taskId);
  await renderCard(ctx, user, taskId, true);
}
