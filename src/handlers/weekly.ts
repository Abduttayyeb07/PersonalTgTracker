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
import { homeRow } from "../keyboards.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Split one message into multiple log items: one per line, stripping common
// bullet/numbering prefixes ("- ", "* ", "1. ", "1) ") so pasted lists work.
// Telegram's native copy-to-clipboard button caps the copied text at 256
// characters. Truncate on a word boundary rather than mid-word.
const COPY_TEXT_LIMIT = 256;
function truncateForCopy(text: string): string {
  if (text.length <= COPY_TEXT_LIMIT) return text;
  const cut = text.slice(0, COPY_TEXT_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

function splitEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0);
}

// Ask the user to send what they did (enters log mode).
export async function promptLog(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = "week_log";
  await ctx.reply(
    "📝 <b>Log this week's work</b>\n\n" +
      "Send what you did. One line per item, or several lines in a single message:\n" +
      "<blockquote>Fixed login bug\nShipped the weekly report feature\nReviewed PRs for the API</blockquote>\n" +
      "Each line is saved as its own item.",
    { parse_mode: "HTML" }
  );
}

// Save one or more notes (split by line) to the current week.
export async function doLog(ctx: BotContext, user: User, text: string): Promise<void> {
  const key = currentWeekKey(user.timezone);
  const items = splitEntries(text);
  if (items.length === 0) return;
  for (const item of items) {
    await addWeekEntry(user.userId, key, item);
  }
  const entries = await listWeekEntries(user.userId, key);
  const kb = new InlineKeyboard()
    .text("➕ Log more", "wk:log")
    .text("📄 This week", "wk:list")
    .row()
    .text("🧾 Generate update", "wk:gen")
    .row()
    .text("🏠 Home", "menu:back");
  const added = items.length > 1 ? `Added ${items.length} items` : "Logged";
  await ctx.reply(`✅ ${added} (${entries.length} total this week). Keep going or generate your update.`, {
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
    .text("🧾 Generate update", "wk:gen")
    .row()
    .text("« Back", "menu:back");
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
    .copyText("📋 Copy", truncateForCopy(text))
    .row()
    .text("✅ Approve & clear", `wk:approve:${key}`)
    .row()
    .text("🔄 Regenerate", "wk:regen")
    .text(technical ? "💼 Business" : "🛠 Technical", technical ? "wk:biz" : "wk:tech")
    .row()
    .text("📄 View notes", "wk:list");

  const footer =
    `\n\n${ai ? "✨ AI-generated" : "📝 Plain format"} · ${weekLabel(user.timezone)}` +
    `\n<i>Approve to save and clear this week's log.</i>`;

  // Body sent as escaped text so it's easy to copy into your company tool.
  const message = escapeHtml(text) + footer;
  await ctx.reply(message, { parse_mode: "HTML", reply_markup: kb });
}

// Approve: clear the week's entries.
export async function approveWeekly(ctx: BotContext, user: User, weekKey: string): Promise<void> {
  const n = await clearWeekEntries(user.userId, weekKey);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await ctx.reply(`✅ Weekly Update approved. Cleared ${n} logged item(s). Fresh week ahead! 🚀`, {
    reply_markup: homeRow(),
  });
}
