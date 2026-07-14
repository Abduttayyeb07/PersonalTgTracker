import { DateTime } from "luxon";
import type { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { config } from "../config.js";
import {
  allUsers,
  cleanupUserDay,
  clearWeekEntries,
  dueReminders,
  listCategories,
  listWeekEntries,
  tasksDueToday,
  updateTask,
  updateUser,
} from "./store.js";
import { buildWeeklyUpdate } from "./weekly.js";
import { nextOccurrence } from "../utils/dates.js";
import { taskCard, taskLine } from "../utils/format.js";
import { taskActions } from "../keyboards.js";

// Starts a single interval loop that fires due reminders and morning digests.
export function startScheduler(bot: Bot<BotContext>): void {
  const intervalMs = Math.max(10, config.schedulerIntervalSeconds) * 1000;
  const tick = async () => {
    try {
      await fireReminders(bot);
      await fireDigests(bot);
      await runDailyCleanup();
      await runWeeklyReset(bot);
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
      const next = nextOccurrence(task.remindAt, task.recurrence);
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
          "\n\n———\n<i>A new week has started — this update's log has been cleared. Reply or use</i> /log <i>to begin logging.</i>";
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

    let body: string;
    if (tasks.length === 0) {
      body = `☀️ <b>Good morning${user.name ? ", " + user.name : ""}!</b>\n\nNothing scheduled for today. Enjoy the clear runway. ✨`;
    } else {
      const lines = tasks.map(
        (t, i) => `${i + 1}. ${taskLine(t, user.timezone, catMap.get(t.categoryId ?? -1))}`
      );
      body =
        `☀️ <b>Good morning${user.name ? ", " + user.name : ""}!</b>\n` +
        `Here's your day — <b>${tasks.length}</b> task${tasks.length > 1 ? "s" : ""}:\n\n` +
        lines.join("\n") +
        `\n\n<i>Open any with</i> /task_&lt;id&gt; <i>or see</i> /today.`;
    }

    try {
      await bot.api.sendMessage(user.chatId, body, { parse_mode: "HTML" });
      await updateUser(user.userId, { lastDigestDate: today });
    } catch (err) {
      console.error(`Failed to send digest to ${user.userId}:`, err);
    }
  }
}
