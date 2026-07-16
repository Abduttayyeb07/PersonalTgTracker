import { Composer, InlineKeyboard, InputFile } from "grammy";
import type { BotContext } from "../types.js";
import {
  boardTasks,
  deleteTask,
  ensureUser,
  getTask,
  getUser,
  listCategories,
  updateTask,
  updateUser,
} from "../services/store.js";
import { buildTasksPdf } from "../services/pdf.js";
import {
  handleMarkDone,
  handleUndoDone,
  renderBoard,
  renderCard,
  renderList,
  renderTotal,
} from "./render.js";
import {
  categoryPicker,
  datePicker,
  deleteConfirm,
  homeRow,
  mainMenu,
  priorityPicker,
  snoozeOptions,
} from "../keyboards.js";
import { resolveQuickDate, resolveSnooze } from "../utils/dates.js";
import {
  cancelAddFlow,
  flowPickCategory,
  flowPickDate,
  flowPickPriority,
  flowPickRepeat,
  startAddFlow,
} from "./addFlow.js";
import { approveWeekly, listWeekly, promptLog, sendWeekly } from "./weekly.js";
import { HELP, welcomeText } from "./commands.js";

export const callbacks = new Composer<BotContext>();

// Central callback router.
callbacks.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const user = await ensureUser(ctx.from.id, ctx.chat?.id ?? ctx.from.id, ctx.from.first_name);
  const [action, ...rest] = data.split(":");

  try {
    switch (action) {
      // ----- Lists / navigation -----
      case "list":
        await renderList(ctx, user, rest[0] as any, true);
        break;
      case "board":
        await renderBoard(ctx, user, true);
        break;
      case "total": {
        if (rest[0] === "pdf") {
          const [tasks, cats] = await Promise.all([boardTasks(user), listCategories(user.userId)]);
          const catMap = new Map(cats.map((c) => [c.id, c]));
          const pdf = await buildTasksPdf(user.name, tasks, catMap, user.timezone);
          await ctx.replyWithDocument(new InputFile(pdf, "tasks.pdf"), {
            caption: `📄 ${tasks.length} open task${tasks.length === 1 ? "" : "s"} — generated just now.`,
          });
        } else {
          await renderTotal(ctx, user, true);
        }
        break;
      }
      case "menu":
        await ctx
          .editMessageText(welcomeText(user.name, user.userId), {
            parse_mode: "HTML",
            reply_markup: mainMenu(),
          })
          .catch(() => {});
        break;
      case "card":
        await renderCard(ctx, user, Number(rest[0]), true);
        break;

      // ----- Task actions -----
      case "done": {
        await handleMarkDone(ctx, user, Number(rest[0]), true);
        break;
      }
      case "undone": {
        await handleUndoDone(ctx, user, Number(rest[0]));
        break;
      }
      case "del": {
        const id = Number(rest[0]);
        await ctx.editMessageReplyMarkup({ reply_markup: deleteConfirm(id) });
        break;
      }
      case "delok": {
        await deleteTask(user.userId, Number(rest[0]));
        await ctx.editMessageText("🗑 Deleted.", { reply_markup: homeRow() });
        break;
      }
      case "snooze":
        await ctx.editMessageReplyMarkup({ reply_markup: snoozeOptions(Number(rest[0])) });
        break;
      case "snz": {
        const id = Number(rest[0]);
        const when = resolveSnooze(rest[1], user.timezone);
        if (when) {
          await updateTask(user.userId, id, {
            remindAt: when,
            dueAt: when,
            reminderSent: false,
            status: "pending",
          });
          await renderCard(ctx, user, id, true);
        }
        break;
      }

      // ----- Edit menu -----
      case "edit": {
        const id = Number(rest[0]);
        const kb = new InlineKeyboard()
          .text("✏️ Title", `etitle:${id}`)
          .text("📂 Category", `ecat:${id}`)
          .row()
          .text("📅 Date", `edate:${id}`)
          .text("🚩 Priority", `epri:${id}`)
          .row()
          .text("🔁 Repeat", `erep:${id}`)
          .text("« Back", `card:${id}`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        break;
      }
      case "etitle": {
        ctx.session.awaiting = "edit_title";
        ctx.session.editTaskId = Number(rest[0]);
        await ctx.reply("✏️ Send the new title:");
        break;
      }
      case "ecat": {
        const cats = await listCategories(user.userId);
        const kb = categoryPicker(cats, `ecatset:${rest[0]}`).row().text("« Back", `edit:${rest[0]}`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        break;
      }
      case "ecatset": {
        await updateTask(user.userId, Number(rest[0]), { categoryId: Number(rest[1]) });
        await renderCard(ctx, user, Number(rest[0]), true);
        break;
      }
      case "epri": {
        const kb = priorityPicker(`epriset:${rest[0]}`).row().text("« Back", `edit:${rest[0]}`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        break;
      }
      case "epriset": {
        await updateTask(user.userId, Number(rest[0]), { priority: Number(rest[1]) });
        await renderCard(ctx, user, Number(rest[0]), true);
        break;
      }
      case "edate": {
        const kb = datePicker(`edateset:${rest[0]}`).row().text("« Back", `edit:${rest[0]}`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        break;
      }
      case "edateset": {
        const id = Number(rest[0]);
        const d = resolveQuickDate(rest[1], user.timezone);
        await updateTask(user.userId, id, { dueAt: d, remindAt: d, reminderSent: false });
        await renderCard(ctx, user, id, true);
        break;
      }
      case "erep": {
        const id = Number(rest[0]);
        const kb = new InlineKeyboard()
          .text("None", `erepset:${id}:none`)
          .text("Daily", `erepset:${id}:daily`)
          .row()
          .text("Every 2 days", `erepset:${id}:custom:2`)
          .text("Every 3 days", `erepset:${id}:custom:3`)
          .row()
          .text("Weekly", `erepset:${id}:weekly`)
          .text("Monthly", `erepset:${id}:monthly`)
          .row()
          .text("⌨️ Custom interval", `erepcustom:${id}`)
          .row()
          .text("« Back", `edit:${id}`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        break;
      }
      case "erepset": {
        const id = Number(rest[0]);
        const recurrence = rest[1];
        const intervalDays = recurrence === "custom" ? Number(rest[2]) : null;
        await updateTask(user.userId, id, {
          recurrence: recurrence as any,
          recurrenceIntervalDays: intervalDays,
        });
        await renderCard(ctx, user, id, true);
        break;
      }
      case "erepcustom": {
        ctx.session.awaiting = "recurrence_days";
        ctx.session.editTaskId = Number(rest[0]);
        await ctx.reply("🔁 Repeat every how many days? Send a number, e.g. <code>5</code>.", {
          parse_mode: "HTML",
        });
        break;
      }

      // ----- Categories menu -----
      case "cats": {
        const cats = await listCategories(user.userId);
        const kb = new InlineKeyboard();
        cats.forEach((c, i) => {
          kb.text(`${c.emoji} ${c.name}`, `catlist:${c.id}`);
          if (i % 2 === 1) kb.row();
        });
        kb.row().text("« Back", "menu:back");
        await ctx.editMessageText("📂 <b>Your categories</b>\nTap one to see its tasks.", {
          parse_mode: "HTML",
          reply_markup: kb,
        });
        break;
      }
      case "catlist":
        await renderList(ctx, user, { categoryId: Number(rest[0]) }, true, "cats");
        break;

      // ----- Add flow -----
      case "add":
        await startAddFlow(ctx);
        break;
      case "aflow_date":
        await flowPickDate(ctx, user, rest[0]);
        break;
      case "aflow_cat":
        await flowPickCategory(ctx, user, Number(rest[0]));
        break;
      case "aflow_pri":
        await flowPickPriority(ctx, user, Number(rest[0]));
        break;
      case "aflow_rep":
        await flowPickRepeat(ctx, user, rest);
        break;
      case "aflow_cancel":
        await cancelAddFlow(ctx, true);
        break;

      // ----- Weekly update -----
      case "wk": {
        const sub = rest[0];
        if (sub === "log") await promptLog(ctx);
        else if (sub === "list") await listWeekly(ctx, user);
        else if (sub === "gen") await sendWeekly(ctx, user, false);
        else if (sub === "regen") await sendWeekly(ctx, user, false);
        else if (sub === "tech") await sendWeekly(ctx, user, true);
        else if (sub === "biz") await sendWeekly(ctx, user, false);
        else if (sub === "approve") await approveWeekly(ctx, user, rest[1]);
        break;
      }

      // ----- Timezone quick-pick -----
      case "tz": {
        const zone = rest.join(":"); // rejoin in case an IANA name contained ":"
        ctx.session.awaiting = undefined;
        const { resolveTimezone, localTimeIn } = await import("../utils/timezone.js");
        const resolved = resolveTimezone(zone) ?? zone;
        await updateUser(user.userId, { timezone: resolved });
        await ctx.editMessageText(
          `✅ Timezone set to <b>${resolved}</b>.\nIt's now <b>${localTimeIn(resolved)}</b> for you. Reminders and digest follow this.`,
          { parse_mode: "HTML" }
        );
        break;
      }

      // ----- Help -----
      case "help": {
        const kb = new InlineKeyboard().text("« Back", "menu:back");
        await ctx.editMessageText(HELP, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
          // HELP may exceed editMessageText's diff-detection in rare cases; fall back to a fresh message.
          await ctx.reply(HELP, { parse_mode: "HTML", reply_markup: kb });
        });
        break;
      }

      // ----- Settings -----
      case "settings": {
        const kb = new InlineKeyboard()
          .text(`🕘 Digest: ${user.digestEnabled ? user.digestHour + ":00" : "off"}`, "noop")
          .row()
          .text(`🌍 TZ: ${user.timezone}`, "noop")
          .row()
          .text("« Back", "menu:back");
        await ctx.editMessageText(
          "⚙️ <b>Settings</b>\nUse /timezone and /digest to change these.",
          { parse_mode: "HTML", reply_markup: kb }
        );
        break;
      }
      case "noop":
        break;
      default:
        break;
    }
  } finally {
    // Always answer to stop Telegram's loading spinner.
    await ctx.answerCallbackQuery().catch(() => {});
  }
});
