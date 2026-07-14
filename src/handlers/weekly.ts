import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import type { User } from "../db/schema.js";
import {
  addWeekEntry,
  clearWeekEntries,
  currentWeekKey,
  listWeekEntries,
  weekLabel,
} from "../services/store.js";
import { buildWeeklyUpdate } from "../services/weekly.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Ask the user to send what they did (enters log mode).
export async function promptLog(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = "week_log";
  await ctx.reply(
    "📝 <b>Log this week's work</b>\n\nSend one thing you did (you can send several, one per message). Each is saved to this week.",
    { parse_mode: "HTML" }
  );
}

// Save a single note to the current week.
export async function doLog(ctx: BotContext, user: User, text: string): Promise<void> {
  const key = currentWeekKey(user.timezone);
  await addWeekEntry(user.userId, key, text.trim());
  const entries = await listWeekEntries(user.userId, key);
  const kb = new InlineKeyboard()
    .text("➕ Log another", "wk:log")
    .text("📄 This week", "wk:list")
    .row()
    .text("🧾 Generate update", "wk:gen");
  await ctx.reply(`✅ Logged (${entries.length} this week). Keep going or generate your update.`, {
    reply_markup: kb,
  });
}

// Show the raw entries logged for the current week.
export async function listWeekly(ctx: BotContext, user: User, edit = false): Promise<void> {
  const key = currentWeekKey(user.timezone);
  const entries = await listWeekEntries(user.userId, key);
  const header = `📄 <b>This week</b> (${weekLabel(user.timezone)})`;
  let body: string;
  if (entries.length === 0) {
    body = `${header}\n\n<i>Nothing logged yet. Use</i> /log <i>or the button below.</i>`;
  } else {
    const lines = entries.map((e, i) => `${i + 1}. ${escapeHtml(e.content)}`).join("\n");
    body = `${header}\n\n${lines}`;
  }
  const kb = new InlineKeyboard()
    .text("➕ Log", "wk:log")
    .text("🧾 Generate update", "wk:gen");
  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

// Generate (or regenerate) the polished Weekly Update and show approve controls.
export async function sendWeekly(
  ctx: BotContext,
  user: User,
  technical = false,
  edit = false
): Promise<void> {
  const key = currentWeekKey(user.timezone);
  const entries = await listWeekEntries(user.userId, key);
  if (entries.length === 0) {
    const msg = "Nothing logged this week yet. Add items with /log first.";
    return edit ? void (await ctx.editMessageText(msg).catch(() => {})) : void (await ctx.reply(msg));
  }

  const notice = edit ? "♻️ Regenerating…" : "🧾 Generating your Weekly Update…";
  if (edit) await ctx.editMessageText(notice).catch(() => {});
  else await ctx.reply(notice);

  const { text, ai } = await buildWeeklyUpdate(entries, technical);

  const kb = new InlineKeyboard()
    .text("✅ Approve & clear", `wk:approve:${key}`)
    .row()
    .text("🔄 Regenerate", "wk:regen")
    .text(technical ? "💼 Business" : "🛠 Technical", technical ? "wk:biz" : "wk:tech")
    .row()
    .text("📄 View notes", "wk:list");

  const footer =
    `\n\n———\n${ai ? "✨ AI-generated" : "📝 Plain format"} · ${weekLabel(user.timezone)}` +
    `\n<i>Approve to save & clear this week's log.</i>`;

  // Body sent as escaped text so it's easy to copy into your company tool.
  const message = escapeHtml(text) + footer;
  await ctx.reply(message, { parse_mode: "HTML", reply_markup: kb });
}

// Approve: clear the week's entries.
export async function approveWeekly(ctx: BotContext, user: User, weekKey: string): Promise<void> {
  const n = await clearWeekEntries(user.userId, weekKey);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await ctx.reply(`✅ Weekly Update approved. Cleared ${n} logged item(s) — fresh week ahead. 🚀`);
}
