import { InlineKeyboard, InputFile } from "grammy";
import { DateTime } from "luxon";
import type { BotContext } from "../types.js";
import type { User } from "../db/schema.js";
import {
  addTopicWatch,
  deleteTopicWatch,
  getTopicWatch,
  listTopicWatches,
  markTopicWatchSent,
} from "../services/store.js";
import { buildTopicDigest } from "../services/watchDigest.js";
import { config } from "../config.js";
import { homeRow, watchItemActions, watchTopicPicker } from "../keyboards.js";

const MAX_TOPIC_LEN = 60;
const MAX_WATCHES = 10; // sane cap so one user can't spam-add unlimited topics

function cadenceLabel(): string {
  return config.watchIntervalDays === 7 ? "week" : `${config.watchIntervalDays} days`;
}

export async function promptWatch(ctx: BotContext, edit = false): Promise<void> {
  const body =
    "🔎 <b>Watch a topic</b>\n\n" +
    `Pick one below, or add your own. I'll check what's new every ${cadenceLabel()} and send you a short summary.`;
  const kb = watchTopicPicker();
  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

export async function promptCustomTopic(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = "watch_topic";
  const body =
    "✏️ What topic do you want to watch? (e.g. <i>Formula 1</i>, <i>terrorism</i>, <i>climate change</i> — anything.)";
  await ctx
    .editMessageText(body, { parse_mode: "HTML" })
    .catch(async () => ctx.reply(body, { parse_mode: "HTML" }));
}

export async function addWatch(ctx: BotContext, user: User, rawTopic: string): Promise<void> {
  const topic = rawTopic.trim().slice(0, MAX_TOPIC_LEN);
  if (!topic) return;

  const existing = await listTopicWatches(user.userId);
  if (existing.some((w) => w.topic.toLowerCase() === topic.toLowerCase())) {
    await ctx.reply(`You're already watching "${topic}".`, { reply_markup: homeRow() });
    return;
  }
  if (existing.length >= MAX_WATCHES) {
    await ctx.reply(
      `You're watching ${MAX_WATCHES} topics already — that's the limit for now. Stop watching one first with /topics.`,
      { reply_markup: homeRow() }
    );
    return;
  }

  const watch = await addTopicWatch(user.userId, topic);
  const note = config.tavily.enabled
    ? `Your first digest lands within the next check cycle (every ${cadenceLabel()}), or tap "Check now" below for it right away.`
    : `⚠️ Web search isn't configured yet, so digests won't send until that's set up — your subscription is saved though.`;

  await ctx.reply(`✅ Now watching <b>${topic}</b>.\n\n${note}`, {
    parse_mode: "HTML",
    reply_markup: watchItemActions(watch.id),
  });
}

export async function listWatches(ctx: BotContext, user: User, edit = false): Promise<void> {
  const watches = await listTopicWatches(user.userId);

  if (watches.length === 0) {
    const body =
      `🔎 <b>Topic Watches</b>\n\n<i>You're not watching anything yet. Add a topic and I'll send a ` +
      `"what's new" summary every ${cadenceLabel()}.</i>`;
    const kb = new InlineKeyboard().text("➕ Watch a topic", "watch:add").row().text("« Back", "menu:back");
    if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
    else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
    return;
  }

  const kb = new InlineKeyboard();
  watches.forEach((w, i) => {
    kb.text(w.topic, `watch:open:${w.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (watches.length % 2 === 1) kb.row();
  kb.text("➕ Add topic", "watch:add").row();
  kb.text("« Back", "menu:back");

  const body = `🔎 <b>Topic Watches</b>  ·  <i>${watches.length}</i>\n\nChecked every ${cadenceLabel()}. Tap one to manage it.`;
  if (edit) await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

export async function viewWatch(ctx: BotContext, user: User, id: number): Promise<void> {
  const watch = await getTopicWatch(user.userId, id);
  if (!watch) {
    await ctx.editMessageText("Not found — it may have already been removed.", { reply_markup: homeRow() }).catch(() => {});
    return;
  }
  const last = watch.lastSentAt
    ? DateTime.fromJSDate(watch.lastSentAt).setZone(user.timezone).toFormat("d LLL, h:mm a")
    : "never yet";
  const body = `🔎 <b>${watch.topic}</b>\n\nLast sent: ${last}`;
  await ctx.editMessageText(body, { parse_mode: "HTML", reply_markup: watchItemActions(watch.id) }).catch(() => {});
}

export async function removeWatch(ctx: BotContext, user: User, id: number): Promise<void> {
  await deleteTopicWatch(user.userId, id);
  await listWatches(ctx, user, true);
}

export async function checkWatchNow(ctx: BotContext, user: User, id: number): Promise<void> {
  const watch = await getTopicWatch(user.userId, id);
  if (!watch) return;

  if (!config.tavily.enabled) {
    await ctx.reply("⚠️ Web search isn't configured yet (missing TAVILY_API_KEY) — ask whoever runs the bot to add it.", {
      reply_markup: watchItemActions(id),
    });
    return;
  }

  await ctx.reply(`🔎 Checking what's new in <b>${watch.topic}</b>…`, { parse_mode: "HTML" });
  const outcome = await buildTopicDigest(watch.topic);

  if (outcome.type === "not_configured") {
    await ctx.reply("⚠️ Web search isn't configured yet — ask whoever runs the bot to add TAVILY_API_KEY.", {
      reply_markup: watchItemActions(id),
    });
    return;
  }
  if (outcome.type === "no_results") {
    await markTopicWatchSent(id);
    await ctx.reply(`Nothing fresh to report on <b>${watch.topic}</b> this time.`, {
      parse_mode: "HTML",
      reply_markup: watchItemActions(id),
    });
    return;
  }

  await markTopicWatchSent(id);
  await ctx.replyWithDocument(new InputFile(outcome.buffer, "whats-new.pdf"), {
    caption: `🔎 What's new: <b>${watch.topic}</b>`,
    parse_mode: "HTML",
    reply_markup: watchItemActions(id),
  });
}
