import { Bot, session } from "grammy";
import { config } from "./config.js";
import type { BotContext, SessionData } from "./types.js";
import { commands } from "./handlers/commands.js";
import { callbacks } from "./handlers/callbacks.js";

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.botToken);

  // In-memory session for the transient guided-add / settings flows.
  bot.use(session<SessionData, BotContext>({ initial: (): SessionData => ({}) }));

  // Callback buttons first, then commands/text.
  bot.use(callbacks);
  bot.use(commands);

  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  return bot;
}

// Registers the slash-command menu shown in Telegram's UI.
export async function setCommands(bot: Bot<BotContext>): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Welcome & main menu" },
    { command: "board", description: "Priority board" },
    { command: "total", description: "Total pending tasks + PDF export" },
    { command: "add", description: "Add a task (guided)" },
    { command: "cancel", description: "Cancel guided add / a pending prompt" },
    { command: "today", description: "Tasks due today" },
    { command: "week", description: "Next 7 days" },
    { command: "all", description: "All pending tasks" },
    { command: "overdue", description: "Overdue tasks" },
    { command: "log", description: "Log weekly work" },
    { command: "weekly", description: "Generate Weekly Update" },
    { command: "watch", description: "Watch a topic for what's new" },
    { command: "topics", description: "Manage your topic watches" },
    { command: "whoami", description: "Your profile & ID" },
    { command: "menu", description: "Main menu" },
    { command: "timezone", description: "Set your timezone" },
    { command: "digest", description: "Set daily digest hour" },
    { command: "help", description: "How to use the bot" },
  ]);
}
