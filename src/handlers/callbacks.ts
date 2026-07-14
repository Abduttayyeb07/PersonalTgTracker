import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import {
  completeTask,
  deleteTask,
  ensureUser,
  getTask,
  getUser,
  listCategories,
  updateTask,
} from "../services/store.js";
import { renderBoard, renderCard, renderList } from "./render.js";
import {
  categoryPicker,
  datePicker,
  mainMenu,
  priorityPicker,
  snoozeOptions,
} from "../keyboards.js";
import { resolveQuickDate, resolveSnooze } from "../utils/dates.js";
import {
  flowPickCategory,
  flowPickDate,
  flowPickPriority,
  startAddFlow,
} from "./addFlow.js";
import { approveWeekly, listWeekly, promptLog, sendWeekly } from "./weekly.js";

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
      case "menu":
        await ctx.editMessageText("What would you like to do?", { reply_markup: mainMenu() });
        break;
      case "card":
        await renderCard(ctx, user, Number(rest[0]), true);
        break;

      // ----- Task actions -----
      case "done": {
        await completeTask(user.userId, Number(rest[0]));
        await ctx.editMessageText("✅ <b>Done!</b> Nice work.", { parse_mode: "HTML" });
        break;
      }
      case "del": {
        await deleteTask(user.userId, Number(rest[0]));
        await ctx.editMessageText("🗑 Deleted.");
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
        await ctx.editMessageReplyMarkup({ reply_markup: categoryPicker(cats, `ecatset:${rest[0]}`) });
        break;
      }
      case "ecatset": {
        await updateTask(user.userId, Number(rest[0]), { categoryId: Number(rest[1]) });
        await renderCard(ctx, user, Number(rest[0]), true);
        break;
      }
      case "epri": {
        await ctx.editMessageReplyMarkup({ reply_markup: priorityPicker(`epriset:${rest[0]}`) });
        break;
      }
      case "epriset": {
        await updateTask(user.userId, Number(rest[0]), { priority: Number(rest[1]) });
        await renderCard(ctx, user, Number(rest[0]), true);
        break;
      }
      case "edate": {
        await ctx.editMessageReplyMarkup({ reply_markup: datePicker(`edateset:${rest[0]}`) });
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
          .text("Weekly", `erepset:${id}:weekly`)
          .text("Monthly", `erepset:${id}:monthly`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
        break;
      }
      case "erepset": {
        await updateTask(user.userId, Number(rest[0]), { recurrence: rest[1] as any });
        await renderCard(ctx, user, Number(rest[0]), true);
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
        kb.row().text("« Menu", "menu:back");
        await ctx.editMessageText("📂 <b>Your categories</b>\nTap one to see its tasks.", {
          parse_mode: "HTML",
          reply_markup: kb,
        });
        break;
      }
      case "catlist":
        await renderList(ctx, user, { categoryId: Number(rest[0]) }, true);
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

      // ----- Settings -----
      case "settings": {
        const kb = new InlineKeyboard()
          .text(`🕘 Digest: ${user.digestEnabled ? user.digestHour + ":00" : "off"}`, "noop")
          .row()
          .text(`🌍 TZ: ${user.timezone}`, "noop")
          .row()
          .text("« Menu", "menu:back");
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
