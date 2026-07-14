import { Composer } from "grammy";
import { DateTime } from "luxon";
import type { BotContext } from "../types.js";
import {
  createTask,
  ensureUser,
  getUser,
  resolveCategory,
  updateUser,
} from "../services/store.js";
import { parseQuickAdd } from "../services/parser.js";
import { renderBoard, renderCard, renderList } from "./render.js";
import { mainMenu } from "../keyboards.js";
import { taskCard } from "../utils/format.js";
import { listCategories } from "../services/store.js";
import { handleFlowText, startAddFlow } from "./addFlow.js";
import { updateTask } from "../services/store.js";
import { config } from "../config.js";
import { doLog, listWeekly, promptLog, sendWeekly } from "./weekly.js";

export const commands = new Composer<BotContext>();

const HELP = `<b>Personal Tracker</b> — your task & reminder assistant.

<b>Quick add</b> (just type):
• <code>Pay rent tomorrow 10am #personal !p1</code>
• <code>Team standup every day 9:30am #work</code>
• <code>Buy groceries this weekend</code>

<b>Commands</b>
/board — priority board (Critical · Important · Normal · Low)
/add — guided add (buttons)
/today — tasks due today
/week — next 7 days
/all — everything pending
/overdue — past due
/task_&lt;id&gt; — open a task
/log — log this week's work
/weekly — generate your Weekly Update
/whoami — your profile & ID
/menu — main menu
/timezone — set your timezone
/digest — set daily digest hour (default 9am)
/help — this message

<i>Tips:</i> use <code>#category</code> to file it, <code>!p1</code>..<code>!p4</code> for priority. I ping you at the reminder time and send a morning digest.

🧹 <i>Fresh each day:</i> finished and past one-off tasks clear at midnight — your recurring reminders and upcoming tasks stay.

📊 <i>Weekly Update:</i> log work all week with /log, then /weekly turns it into a polished report. Auto-sent every Sunday 11:59pm, then the week resets.`;

commands.command("start", async (ctx) => {
  const from = ctx.from!;
  await ensureUser(from.id, ctx.chat!.id, from.first_name);
  await ctx.reply(
    `👋 Welcome to <b>Personal Tracker</b>, ${from.first_name}!\n\n` +
      `I keep your personal & professional tasks in one place, remind you when they're due, and send a morning digest.\n\n` +
      `🪪 Your private ID: <code>${from.id}</code>\n` +
      `🔒 Everything you save is visible only to you.\n\n` +
      `Just type a task like <code>Call the bank tomorrow 11am #personal</code>, or use the menu below.`,
    { parse_mode: "HTML", reply_markup: mainMenu() }
  );
  await ctx.reply(HELP, { parse_mode: "HTML" });
});

commands.command("add", async (ctx) => {
  await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await startAddFlow(ctx);
});

commands.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
commands.command("menu", (ctx) =>
  ctx.reply("What would you like to do?", { reply_markup: mainMenu() })
);

commands.command("board", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderBoard(ctx, user);
});

commands.command("log", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  const arg = ctx.match?.toString().trim();
  if (arg) return doLog(ctx, user, arg);
  return promptLog(ctx);
});

commands.command("weekly", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await sendWeekly(ctx, user);
});

commands.command("weeklog", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await listWeekly(ctx, user);
});

commands.command("whoami", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await ctx.reply(
    `🪪 <b>Your profile</b>\n\n` +
      `Name: <b>${user.name ?? "—"}</b>\n` +
      `Telegram ID: <code>${user.userId}</code>\n` +
      `Timezone: <b>${user.timezone}</b>\n` +
      `Daily digest: <b>${user.digestEnabled ? user.digestHour + ":00" : "off"}</b>\n\n` +
      `<i>Your tasks are private to this ID — no one else can see them.</i>`,
    { parse_mode: "HTML" }
  );
});

commands.command("today", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderList(ctx, user, "today");
});
commands.command("week", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderList(ctx, user, "week");
});
commands.command("all", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderList(ctx, user, "all");
});
commands.command("overdue", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderList(ctx, user, "overdue");
});

// /timezone [Area/City]
commands.command("timezone", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  const arg = ctx.match?.toString().trim();
  if (!arg) {
    ctx.session.awaiting = "timezone";
    return ctx.reply(
      `Your timezone is <b>${user.timezone}</b>.\nReply with an IANA name to change it, e.g. <code>Asia/Kolkata</code>, <code>America/New_York</code>, <code>Europe/London</code>.`,
      { parse_mode: "HTML" }
    );
  }
  if (!DateTime.now().setZone(arg).isValid) {
    return ctx.reply("That doesn't look like a valid IANA timezone. Try e.g. Asia/Kolkata.");
  }
  await updateUser(user.userId, { timezone: arg });
  await ctx.reply(`✅ Timezone set to <b>${arg}</b>.`, { parse_mode: "HTML" });
});

// /digest [hour]
commands.command("digest", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  const arg = ctx.match?.toString().trim();
  if (!arg) {
    ctx.session.awaiting = "digest_hour";
    return ctx.reply(
      `Daily digest is ${user.digestEnabled ? `on at <b>${user.digestHour}:00</b>` : "<b>off</b>"}.\nReply with an hour 0–23 to set it, or <code>off</code> to disable.`,
      { parse_mode: "HTML" }
    );
  }
  await applyDigestSetting(ctx, arg);
});

// /task_<id>
commands.hears(/^\/task_(\d+)/, async (ctx) => {
  const user = await getUser(ctx.from!.id);
  if (!user) return;
  const id = Number(ctx.match[1]);
  await renderCard(ctx, user, id);
});

// Free-text: either continues a guided flow, answers a settings prompt, or quick-adds.
commands.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return; // unmatched command

  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);

  // Settings prompts awaiting a reply.
  if (ctx.session.awaiting === "timezone") {
    ctx.session.awaiting = undefined;
    if (!DateTime.now().setZone(text.trim()).isValid)
      return ctx.reply("Not a valid IANA timezone. Try /timezone again.");
    await updateUser(user.userId, { timezone: text.trim() });
    return ctx.reply(`✅ Timezone set to <b>${text.trim()}</b>.`, { parse_mode: "HTML" });
  }
  if (ctx.session.awaiting === "digest_hour") {
    ctx.session.awaiting = undefined;
    return applyDigestSetting(ctx, text.trim());
  }
  if (ctx.session.awaiting === "edit_title" && ctx.session.editTaskId) {
    const id = ctx.session.editTaskId;
    ctx.session.awaiting = undefined;
    ctx.session.editTaskId = undefined;
    await updateTask(user.userId, id, { title: text.trim() });
    return renderCard(ctx, user, id);
  }
  if (ctx.session.awaiting === "week_log") {
    ctx.session.awaiting = undefined; // one note per message; button re-enters log mode
    return doLog(ctx, user, text);
  }

  // Guided add flow in progress?
  if (ctx.session.flow) {
    return handleFlowText(ctx, user);
  }

  // Otherwise: natural-language quick add.
  await quickAdd(ctx, user, text);
});

async function quickAdd(ctx: BotContext, user: Awaited<ReturnType<typeof ensureUser>>, text: string) {
  const cats = await listCategories(user.userId);

  // Hybrid: try the AI parser if enabled, fall back to deterministic chrono parsing.
  let parsed:
    | (ReturnType<typeof parseQuickAdd> & { recurrence?: "none" | "daily" | "weekly" | "monthly" })
    | undefined;
  if (config.bedrock.enabled && config.bedrock.modelId) {
    try {
      const { parseWithBedrock } = await import("../services/bedrock.js");
      parsed = await parseWithBedrock(
        text,
        user.timezone,
        cats.map((c) => c.name)
      );
    } catch (err) {
      console.warn("Bedrock parse failed, falling back to chrono:", (err as Error).message);
    }
  }
  if (!parsed) parsed = parseQuickAdd(text, user.timezone);

  const category = await resolveCategory(user.userId, parsed.categoryHint);
  const recurrence = parsed.recurrence ?? "none";

  const task = await createTask({
    userId: user.userId,
    categoryId: category?.id ?? null,
    title: parsed.title,
    dueAt: parsed.dueAt,
    priority: parsed.priority,
    remindAt: parsed.dueAt, // ping at due time by default
    reminderSent: false,
    status: "pending",
    recurrence,
  });

  const cat = cats.find((c) => c.id === task.categoryId);
  const { taskActions } = await import("../keyboards.js");
  await ctx.reply("✅ <b>Added</b>\n\n" + taskCard(task, user.timezone, cat), {
    parse_mode: "HTML",
    reply_markup: taskActions(task.id),
  });
}

async function applyDigestSetting(ctx: BotContext, arg: string) {
  const user = (await getUser(ctx.from!.id))!;
  if (/^off$/i.test(arg)) {
    await updateUser(user.userId, { digestEnabled: false });
    return ctx.reply("🔕 Daily digest disabled. Turn it back on with /digest.");
  }
  const hour = Number(arg);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return ctx.reply("Please give an hour between 0 and 23, or 'off'.");
  }
  await updateUser(user.userId, { digestHour: hour, digestEnabled: true });
  await ctx.reply(`✅ Daily digest set to <b>${hour}:00</b> your time.`, { parse_mode: "HTML" });
}
