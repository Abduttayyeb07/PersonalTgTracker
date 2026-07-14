import type { BotContext } from "../types.js";
import type { ListFilter } from "../services/store.js";
import { boardTasks, listCategories, listTasks } from "../services/store.js";
import type { Task, User } from "../db/schema.js";
import { taskCard, taskLine } from "../utils/format.js";
import { boardMenu, taskActions } from "../keyboards.js";

const FILTER_TITLE: Record<string, string> = {
  today: "📋 Today",
  week: "🗓 This week",
  all: "📚 All tasks",
  overdue: "⚠️ Overdue",
};

// Render a list of tasks as a single message (with per-task numbers for quick reference).
export async function renderList(
  ctx: BotContext,
  user: User,
  filter: ListFilter,
  edit = false
): Promise<void> {
  const cats = await listCategories(user.userId);
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const tasks = await listTasks(user, filter);

  const title =
    typeof filter === "object"
      ? `${catMap.get(filter.categoryId)?.emoji ?? "📂"} ${catMap.get(filter.categoryId)?.name ?? "Category"}`
      : FILTER_TITLE[filter] ?? "Tasks";

  if (tasks.length === 0) {
    const body = `${title}\n\n<i>Nothing here. Add one with</i> /add <i>or just type it.</i>`;
    return edit
      ? void (await ctx.editMessageText(body, { parse_mode: "HTML" }).catch(() => {}))
      : void (await ctx.reply(body, { parse_mode: "HTML" }));
  }

  const lines = tasks.map(
    (t, i) => `${i + 1}. ${taskLine(t, user.timezone, catMap.get(t.categoryId ?? -1))}  <code>#${t.id}</code>`
  );
  const body = `${title}  <b>(${tasks.length})</b>\n\n${lines.join("\n")}\n\n<i>Tap /task_&lt;id&gt; to open, e.g.</i> /task_${tasks[0].id}`;

  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML" }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML" });
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

  const header = `🗂 <b>Your Board</b>  ·  ${tasks.length} open`;
  if (tasks.length === 0) {
    const body = `${header}\n\n<i>All clear. Add a task with</i> /add <i>or just type one.</i>`;
    return edit
      ? void (await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: boardMenu() }).catch(() => {}))
      : void (await ctx.reply(body, { parse_mode: "HTML", reply_markup: boardMenu() }));
  }

  const sections = BOARD_GROUPS.map((g) => {
    const items = byPriority.get(g.priority) ?? [];
    if (items.length === 0) return `${g.label} · <i>—</i>`;
    const lines = items
      .map((t) => {
        const cat = catMap.get(t.categoryId ?? -1);
        return `   • ${cat ? cat.emoji + " " : ""}${escapeTitle(t.title)} <code>/task_${t.id}</code>`;
      })
      .join("\n");
    return `${g.label} · ${items.length}\n${lines}`;
  });

  const body = `${header}\n\n${sections.join("\n\n")}`;
  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: boardMenu() }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: boardMenu() });
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
