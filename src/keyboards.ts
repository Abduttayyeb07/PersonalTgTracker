import { InlineKeyboard } from "grammy";
import type { Category } from "./db/schema.js";

// Buttons under a single task card.
export function taskActions(taskId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Done", `done:${taskId}`)
    .text("⏰ Snooze", `snooze:${taskId}`)
    .row()
    .text("✏️ Edit", `edit:${taskId}`)
    .text("🗑 Delete", `del:${taskId}`);
}

// Snooze duration options.
export function snoozeOptions(taskId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("+1h", `snz:${taskId}:60`)
    .text("+3h", `snz:${taskId}:180`)
    .text("Tonight", `snz:${taskId}:tonight`)
    .row()
    .text("Tomorrow 9am", `snz:${taskId}:tomorrow`)
    .text("Next week", `snz:${taskId}:week`)
    .row()
    .text("« Back", `card:${taskId}`);
}

// Category picker (used in guided add + edit).
export function categoryPicker(cats: Category[], prefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  cats.forEach((c, i) => {
    kb.text(`${c.emoji} ${c.name}`, `${prefix}:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

// Priority picker for guided add.
export function priorityPicker(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔴 P1", `${prefix}:1`)
    .text("🟠 P2", `${prefix}:2`)
    .text("🟡 P3", `${prefix}:3`)
    .text("⚪ P4", `${prefix}:4`);
}

// Quick date choices for guided add.
export function datePicker(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Today", `${prefix}:today`)
    .text("Tomorrow", `${prefix}:tomorrow`)
    .row()
    .text("This weekend", `${prefix}:weekend`)
    .text("Next week", `${prefix}:week`)
    .row()
    .text("No date", `${prefix}:none`)
    .text("⌨️ Type it", `${prefix}:custom`);
}

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗂 Board", "board:open")
    .text("📋 Today", "list:today")
    .row()
    .text("🗓 Week", "list:week")
    .text("📂 Categories", "cats:open")
    .row()
    .text("➕ Add task", "add:new")
    .text("📝 Weekly", "wk:list")
    .row()
    .text("⚙️ Settings", "settings:open");
}

// Navigation under the priority board.
export function boardMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Add", "add:new")
    .text("📋 Today", "list:today")
    .row()
    .text("🔄 Refresh", "board:open")
    .text("« Menu", "menu:back");
}
