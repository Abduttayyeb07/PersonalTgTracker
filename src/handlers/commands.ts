import { Composer, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import type { BotContext } from "../types.js";
import {
  createTask,
  ensureUser,
  getTask,
  getUser,
  resolveCategory,
  updateUser,
} from "../services/store.js";
import { parseQuickAdd } from "../services/parser.js";
import { tryNaturalLanguageEdit } from "../services/nlEdit.js";
import { handleMarkDone, renderBoard, renderCard, renderList, renderTotal } from "./render.js";
import { homeRow, mainMenu, taskActions, timezonePicker } from "../keyboards.js";
import { localTimeIn, resolveTimezone } from "../utils/timezone.js";
import { taskCard } from "../utils/format.js";
import { listCategories } from "../services/store.js";
import { cancelAddFlow, handleFlowText, startAddFlow } from "./addFlow.js";
import { updateTask } from "../services/store.js";
import { config } from "../config.js";
import { isChitChat } from "../utils/chitchat.js";
import { doLog, listWeekly, promptLog, sendWeekly } from "./weekly.js";
import { addWatch, listWatches, promptWatch } from "./watch.js";

export const commands = new Composer<BotContext>();

// Full command reference — organized by topic, plain-language "how to use".
export const HELP = `📖 <b>Personal Tracker Help</b>
<i>Everything I can do, in one place.</i>

⚡️ <b>Quick add: just type a task, no command needed</b>
<blockquote><code>Pay rent tomorrow 10am #personal !p1</code>
<code>Team standup every day 9:30am #work</code>
<code>Buy groceries this weekend</code></blockquote>
<code>#tag</code> files it into a category. <code>!p1</code> to <code>!p4</code> sets priority (1 is most urgent).

📋 <b>Tasks</b>
/board: see everything grouped by priority, from Critical to Low
/add: add a task step by step with buttons, no typing needed
/today: what's due today
/week: everything due in the next 7 days
/all: every open task
/overdue: anything past its due date
/task_&lt;id&gt;: open one task (e.g. <code>/task_12</code>) to mark done, snooze, edit or delete

📊 <b>Weekly report (for work updates)</b>
/log: add a note about something you did this week
/weeklog: see everything you've logged so far this week
/weekly: turn this week's notes into a polished summary you can send to your manager
<i>Every Sunday at 11:59pm I generate and send it automatically, then start you fresh for the new week.</i>

⚙️ <b>Your settings</b>
/timezone: set your city so reminders land at the right time
/digest: pick what time your morning summary arrives (default 9am), or turn it off
/whoami: see your name, ID and current settings
/menu: reopen the main button menu

🔔 <b>How reminders work</b>
I message you automatically when a task is due, and send one morning digest of the day ahead. Finished and past one-off tasks are cleared out at midnight. Recurring reminders and future tasks are kept.

<i>Tip: you don't need to memorize commands. /menu gives you buttons for everything.</i>`;

// The main panel shown on /start, /menu, and "« Back" to the top level.
export function welcomeText(name: string | null, userId: number): string {
  return (
    `👋 <b>Welcome${name ? ", " + name : ""}!</b>\n` +
    `<i>Personal Tracker keeps your work on track.</i>\n\n` +
    `I hold your <b>personal</b> &amp; <b>professional</b> tasks in one place, remind you on time, and send a 🌅 morning digest.\n\n` +
    `<blockquote>🪪 Your private ID: <code>${userId}</code>\n🔒 Only you can ever see your data.</blockquote>\n` +
    `Type a task like <code>Call the bank tomorrow 11am #personal</code>, tap a button below 👇, or send /help for the full guide.`
  );
}

commands.command("start", async (ctx) => {
  const from = ctx.from!;
  await ensureUser(from.id, ctx.chat!.id, from.first_name);
  await ctx.reply(welcomeText(from.first_name, from.id), {
    parse_mode: "HTML",
    reply_markup: mainMenu(),
  });
});

commands.command("add", async (ctx) => {
  await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await startAddFlow(ctx);
});

// Aborts a guided /add in progress, or any pending settings prompt.
commands.command("cancel", async (ctx) => {
  const hadFlow = Boolean(ctx.session.flow);
  const hadAwaiting = Boolean(ctx.session.awaiting);
  ctx.session.awaiting = undefined;
  ctx.session.editTaskId = undefined;
  if (hadFlow) return cancelAddFlow(ctx, false);
  if (!hadAwaiting) return ctx.reply("Nothing in progress to cancel.");
  await ctx.reply("❌ Cancelled.");
});

commands.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
commands.command("menu", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await ctx.reply(welcomeText(user.name, user.userId), {
    parse_mode: "HTML",
    reply_markup: mainMenu(),
  });
});

commands.command("board", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderBoard(ctx, user);
});

commands.command("total", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await renderTotal(ctx, user);
});

commands.command("log", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  const arg = ctx.match?.toString().trim();
  if (arg) return doLog(ctx, user, arg);
  return promptLog(ctx);
});

// /watch [topic] — subscribe to a "what's new" digest for any topic.
commands.command("watch", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  const arg = ctx.match?.toString().trim();
  if (arg) return addWatch(ctx, user, arg);
  return promptWatch(ctx);
});

commands.command("topics", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  await listWatches(ctx, user);
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
      `Name: <b>${user.name ?? "Not set"}</b>\n` +
      `Telegram ID: <code>${user.userId}</code>\n` +
      `Timezone: <b>${user.timezone}</b>\n` +
      `Daily digest: <b>${user.digestEnabled ? user.digestHour + ":00" : "off"}</b>\n\n` +
      `<i>Your tasks are private to this ID. No one else can see them.</i>`,
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

// /timezone [city or IANA name]
commands.command("timezone", async (ctx) => {
  const user = await ensureUser(ctx.from!.id, ctx.chat!.id, ctx.from!.first_name);
  const arg = ctx.match?.toString().trim();
  if (!arg) return promptTimezone(ctx, user);
  await applyTimezone(ctx, user.userId, arg);
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
    return applyTimezone(ctx, user.userId, text);
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
  if (ctx.session.awaiting === "recurrence_days" && ctx.session.editTaskId) {
    const id = ctx.session.editTaskId;
    ctx.session.awaiting = undefined;
    ctx.session.editTaskId = undefined;
    const n = Number(text.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return ctx.reply("Please send a whole number of days, between 1 and 365.");
    }
    await updateTask(user.userId, id, { recurrence: "custom", recurrenceIntervalDays: n });
    return renderCard(ctx, user, id);
  }
  if (ctx.session.awaiting === "watch_topic") {
    ctx.session.awaiting = undefined;
    return addWatch(ctx, user, text);
  }

  // Guided add flow in progress?
  if (ctx.session.flow) {
    return handleFlowText(ctx, user);
  }

  // Plain greetings/acknowledgements shouldn't become tasks.
  if (isChitChat(text)) {
    return ctx.reply(
      "👋 Hey there! I mostly turn what you type into tasks. Try something like <code>Call mom tomorrow 6pm</code>, tap /menu for buttons, or send /help to see everything I can do.",
      { parse_mode: "HTML" }
    );
  }

  // Natural-language edit of an existing task ("move rent to friday", "make groceries p1")?
  const editOutcome = await tryNaturalLanguageEdit(user, text);
  if (editOutcome.type === "ambiguous") {
    const kb = new InlineKeyboard();
    editOutcome.matches.slice(0, 6).forEach((t) => kb.text(`${t.title} (#${t.id})`, `card:${t.id}`).row());
    return ctx.reply(`I found a few tasks matching "${editOutcome.phrase}" — which one?`, {
      reply_markup: kb,
    });
  }
  if (editOutcome.type === "applied") {
    const task = await getTask(user.userId, editOutcome.taskId);
    if (task) {
      const cats = await listCategories(user.userId);
      const cat = cats.find((c) => c.id === task.categoryId);
      return ctx.reply(`✅ <b>${editOutcome.verb}</b>\n\n` + taskCard(task, user.timezone, cat), {
        parse_mode: "HTML",
        reply_markup: taskActions(task.id),
      });
    }
  }
  if (editOutcome.type === "deleted") {
    return ctx.reply(`🗑 Deleted "${editOutcome.title}".`, { reply_markup: homeRow() });
  }
  if (editOutcome.type === "completed") {
    return handleMarkDone(ctx, user, editOutcome.taskId, false);
  }
  // type is "not_recognized" or "no_match": fall through to quick-add.

  // Otherwise: natural-language quick add.
  await quickAdd(ctx, user, text);
});

async function quickAdd(ctx: BotContext, user: Awaited<ReturnType<typeof ensureUser>>, text: string) {
  const cats = await listCategories(user.userId);

  // Hybrid: try the AI parser if enabled, fall back to deterministic chrono parsing.
  let parsed: ReturnType<typeof parseQuickAdd> | undefined;
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

  const task = await createTask({
    userId: user.userId,
    categoryId: category?.id ?? null,
    title: parsed.title,
    dueAt: parsed.dueAt,
    priority: parsed.priority,
    remindAt: parsed.dueAt, // ping at due time by default
    reminderSent: false,
    status: "pending",
    recurrence: parsed.recurrence,
    recurrenceIntervalDays: parsed.recurrenceIntervalDays,
  });

  const cat = cats.find((c) => c.id === task.categoryId);
  const { taskActions } = await import("../keyboards.js");
  await ctx.reply("✅ <b>Added</b>\n\n" + taskCard(task, user.timezone, cat), {
    parse_mode: "HTML",
    reply_markup: taskActions(task.id),
  });
}

async function promptTimezone(ctx: BotContext, user: { timezone: string }) {
  ctx.session.awaiting = "timezone";
  await ctx.reply(
    `🌍 <b>Timezone</b>\n\n` +
      `Currently <b>${user.timezone}</b>. It's <b>${localTimeIn(user.timezone)}</b> for you now.\n\n` +
      `<blockquote>Tap a city below, or just type your city or country, e.g. <code>Dubai</code>, <code>UAE</code>, <code>London</code>, <code>New York</code>. I'll match it to the right zone.</blockquote>`,
    { parse_mode: "HTML", reply_markup: timezonePicker() }
  );
}

async function applyTimezone(ctx: BotContext, userId: number, input: string) {
  const zone = resolveTimezone(input);
  if (!zone) {
    return ctx.reply(
      `🤔 I couldn't find a timezone for "<b>${input}</b>". Try a city like <code>Dubai</code> or <code>London</code>, or an IANA name like <code>Asia/Dubai</code>. Use /timezone to see the buttons.`,
      { parse_mode: "HTML" }
    );
  }
  await updateUser(userId, { timezone: zone });
  await ctx.reply(
    `✅ Timezone set to <b>${zone}</b>.\nIt's now <b>${localTimeIn(zone)}</b> for you. Reminders and your daily digest will follow this.`,
    { parse_mode: "HTML" }
  );
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
