import { DateTime } from "luxon";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { BotContext } from "../types.js";
import { config } from "../config.js";
import {
  allUsers,
  cleanupUserDay,
  clearWeekEntries,
  dueReminders,
  dueTopicWatches,
  listCategories,
  listWeekEntries,
  markTopicWatchSent,
  tasksDueToday,
  updateTask,
  updateUser,
} from "./store.js";
import { buildWeeklyUpdate } from "./weekly.js";
import { buildTopicDigest } from "./watchDigest.js";
import { nextOccurrence } from "../utils/dates.js";
import { priorityLabel, taskCard, taskLine } from "../utils/format.js";
import { taskActions, watchItemActions } from "../keyboards.js";
import type { Category, Task } from "../db/schema.js";

// Same fix as the board/list views: plain "/task_id" text is not tappable in
// Telegram, so digest messages use real buttons to open each task.
function digestTaskButtons(tasks: Task[], catMap: Map<number, Category>): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const t of tasks) {
    const cat = catMap.get(t.categoryId ?? -1);
    const dot = priorityLabel(t.priority).split(" ")[0];
    const title = t.title.length > 32 ? t.title.slice(0, 31).trimEnd() + "…" : t.title;
    kb.text(`${dot} ${cat ? cat.emoji + " " : ""}${title}`, `card:${t.id}`).row();
  }
  return kb;
}

// Starts a single interval loop that fires due reminders and morning digests.
export function startScheduler(bot: Bot<BotContext>): void {
  const intervalMs = Math.max(10, config.schedulerIntervalSeconds) * 1000;
  const tick = async () => {
    try {
      await fireReminders(bot);
      await fireDigests(bot);
      await runDailyCleanup();
      await runWeeklyReset(bot);
      await runTopicWatches(bot);
    } catch (err) {
      console.error("Scheduler tick error:", err);
    }
  };
  // Run shortly after boot, then on the interval.
  setTimeout(tick, 3000);
  setInterval(tick, intervalMs);
  console.log(`Scheduler running every ${config.schedulerIntervalSeconds}s.`);
}

async function fireReminders(bot: Bot<BotContext>): Promise<void> {
  const due = await dueReminders();
  for (const task of due) {
    const cats = await listCategories(task.userId);
    const cat = cats.find((c) => c.id === task.categoryId);
    const user = (await allUsers()).find((u) => u.userId === task.userId);
    const tz = user?.timezone ?? config.defaultTimezone;
    const chatId = user?.chatId ?? task.userId;

    try {
      await bot.api.sendMessage(chatId, "🔔 <b>Reminder</b>\n\n" + taskCard(task, tz, cat), {
        parse_mode: "HTML",
        reply_markup: taskActions(task.id),
      });
    } catch (err) {
      console.error(`Failed to send reminder for task ${task.id}:`, err);
    }

    // Recurring: reschedule to next occurrence; one-off: mark sent.
    if (task.recurrence !== "none" && task.remindAt) {
      const next = nextOccurrence(task.remindAt, task.recurrence, task.recurrenceIntervalDays);
      await updateTask(task.userId, task.id, {
        remindAt: next,
        dueAt: next,
        reminderSent: false,
      });
    } else {
      await updateTask(task.userId, task.id, { reminderSent: true });
    }
  }
}

// Once per local day, purge finished/past one-off tasks. Recurring tasks and
// future-dated tasks are preserved (see cleanupUserDay). Runs silently.
async function runDailyCleanup(): Promise<void> {
  const users = await allUsers();
  for (const user of users) {
    const today = DateTime.now().setZone(user.timezone).toISODate();
    if (!today || user.lastCleanupDate === today) continue;
    // Skip the very first observation for a user (nothing to purge yet, just mark).
    if (user.lastCleanupDate === null) {
      await updateUser(user.userId, { lastCleanupDate: today });
      continue;
    }
    try {
      const removed = await cleanupUserDay(user);
      await updateUser(user.userId, { lastCleanupDate: today });
      if (removed > 0) console.log(`Cleaned ${removed} task(s) for user ${user.userId}.`);
    } catch (err) {
      console.error(`Cleanup failed for ${user.userId}:`, err);
    }
  }
}

function fmtWeekKey(dt: DateTime): string {
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, "0")}`;
}

// Weekly reset: at Sunday 23:59 (local) generate & send the Weekly Update, then
// clear that week's log. Robust to downtime — it targets the most recently
// ENDED week and won't touch the ongoing one, so a missed Sunday is caught up.
async function runWeeklyReset(bot: Bot<BotContext>): Promise<void> {
  const users = await allUsers();
  for (const user of users) {
    const now = DateTime.now().setZone(user.timezone);
    // The Sunday-23:59 boundary of the current ISO week.
    let lastClose = now.set({ weekday: 7, hour: 23, minute: 59, second: 0, millisecond: 0 });
    if (lastClose > now) lastClose = lastClose.minus({ weeks: 1 });
    const keyToClose = fmtWeekKey(lastClose);

    if (user.lastWeeklyReset === keyToClose) continue; // already processed this boundary

    const entries = await listWeekEntries(user.userId, keyToClose);
    try {
      if (entries.length > 0) {
        const { text } = await buildWeeklyUpdate(entries, false);
        const body =
          "🗓 <b>Your Weekly Update is ready</b>\n\n" +
          escapeHtmlBlock(text) +
          "\n\n<i>A new week has started. This update's log has been cleared. Use</i> /log <i>to begin logging again.</i>";
        await bot.api.sendMessage(user.chatId, body, { parse_mode: "HTML" });
        await clearWeekEntries(user.userId, keyToClose);
      }
      await updateUser(user.userId, { lastWeeklyReset: keyToClose });
    } catch (err) {
      console.error(`Weekly reset failed for ${user.userId}:`, err);
    }
  }
}

function escapeHtmlBlock(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fireDigests(bot: Bot<BotContext>): Promise<void> {
  const users = await allUsers();
  for (const user of users) {
    if (!user.digestEnabled) continue;
    const now = DateTime.now().setZone(user.timezone);
    const today = now.toISODate();
    // Send once per day, at/after the configured hour.
    if (user.lastDigestDate === today) continue;
    if (now.hour < user.digestHour) continue;

    const tasks = await tasksDueToday(user);
    const cats = await listCategories(user.userId);
    const catMap = new Map(cats.map((c) => [c.id, c]));

    const dateStr = now.toFormat("cccc, d LLLL");
    let body: string;
    let kb: InlineKeyboard | undefined;
    if (tasks.length === 0) {
      body =
        `🌅 <b>Good morning${user.name ? ", " + user.name : ""}!</b>\n` +
        `<i>${dateStr}</i>\n\n` +
        `<blockquote>✨ Nothing scheduled today. Enjoy the clear runway.</blockquote>`;
    } else {
      const lines = tasks.map((t) => taskLine(t, user.timezone, catMap.get(t.categoryId ?? -1)));
      body =
        `🌅 <b>Good morning${user.name ? ", " + user.name : ""}!</b>\n` +
        `<i>${dateStr}</i>\n\n` +
        `Here's your day: <b>${tasks.length}</b> task${tasks.length > 1 ? "s" : ""} 👇\n` +
        `<blockquote>${lines.join("\n")}</blockquote>\n` +
        `<i>Tap a task to open it, or see /today · /board</i>`;
      kb = digestTaskButtons(tasks, catMap);
    }

    try {
      await bot.api.sendMessage(user.chatId, body, { parse_mode: "HTML", reply_markup: kb });
      await updateUser(user.userId, { lastDigestDate: today });
    } catch (err) {
      console.error(`Failed to send digest to ${user.userId}:`, err);
    }
  }
}

// "What's new" digests for /watch topics — fixed cadence (config.watchIntervalDays),
// never sent by local calendar day, just N days since the last send (or since
// creation, for a brand-new subscription — those fire on the very next tick).
async function runTopicWatches(bot: Bot<BotContext>): Promise<void> {
  const cutoff = new Date(Date.now() - config.watchIntervalDays * 24 * 60 * 60 * 1000);
  const due = await dueTopicWatches(cutoff);
  if (due.length === 0) return;

  const users = await allUsers();
  for (const watch of due) {
    const user = users.find((u) => u.userId === watch.userId);
    if (!user) continue;

    try {
      const outcome = await buildTopicDigest(watch.topic);
      if (outcome.type === "not_configured") continue; // retry next tick, don't mark sent

      if (outcome.type === "no_results") {
        await bot.api.sendMessage(
          user.chatId,
          `🔎 <b>${watch.topic}</b>: nothing fresh to report this week.`,
          { parse_mode: "HTML", reply_markup: watchItemActions(watch.id) }
        );
      } else {
        await bot.api.sendDocument(user.chatId, new InputFile(outcome.buffer, "whats-new.pdf"), {
          caption: `🔎 What's new: <b>${watch.topic}</b>`,
          parse_mode: "HTML",
          reply_markup: watchItemActions(watch.id),
        });
      }
      await markTopicWatchSent(watch.id);
    } catch (err) {
      console.error(`Topic watch failed for "${watch.topic}" (user ${watch.userId}):`, err);
    }
  }
}
