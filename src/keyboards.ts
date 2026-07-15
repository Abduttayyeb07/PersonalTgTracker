import { InlineKeyboard } from "grammy";
import type { Category } from "./db/schema.js";

// Buttons under a single task card. `back` is the callback for the up-one-level
// button (defaults to the board overview).
export function taskActions(taskId: number, back = "board"): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Done", `done:${taskId}`)
    .text("⏰ Snooze", `snooze:${taskId}`)
    .row()
    .text("✏️ Edit", `edit:${taskId}`)
    .text("🗑 Delete", `del:${taskId}`)
    .row()
    .text("« Back", back);
}

// Confirm-before-delete step — delete is irreversible, so require one extra tap.
export function deleteConfirm(taskId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Yes, delete", `delok:${taskId}`)
    .text("« Cancel", `card:${taskId}`);
}

// A single "back" row helper for sub-screens (pickers, lists, menus).
export function backRow(back: string): InlineKeyboard {
  return new InlineKeyboard().text("« Back", back);
}

// For terminal/confirmation messages (task done, deleted, weekly approved) —
// a one-tap way back to the main panel without typing a command.
export function homeRow(): InlineKeyboard {
  return new InlineKeyboard().text("🏠 Home", "menu:back");
}

// Abort button shown during the guided /add flow at every step.
export function cancelRow(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel", "aflow_cancel");
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

// Repeat picker for guided add (mirrors the edit-menu repeat options).
export function repeatPicker(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("None", `${prefix}:none`)
    .text("Daily", `${prefix}:daily`)
    .row()
    .text("Every 2 days", `${prefix}:custom:2`)
    .text("Every 3 days", `${prefix}:custom:3`)
    .row()
    .text("Weekly", `${prefix}:weekly`)
    .text("Monthly", `${prefix}:monthly`)
    .row()
    .text("⌨️ Custom", `${prefix}:custom:ask`);
}

// Common timezones as quick buttons (callback: tz:<IANA>).
const COMMON_ZONES: [string, string][] = [
  ["🇦🇪 Dubai", "Asia/Dubai"],
  ["🇵🇰 Karachi", "Asia/Karachi"],
  ["🇮🇳 India", "Asia/Kolkata"],
  ["🇸🇦 Riyadh", "Asia/Riyadh"],
  ["🇬🇧 London", "Europe/London"],
  ["🇩🇪 Berlin", "Europe/Berlin"],
  ["🇺🇸 New York", "America/New_York"],
  ["🇺🇸 Los Angeles", "America/Los_Angeles"],
  ["🇸🇬 Singapore", "Asia/Singapore"],
  ["🇯🇵 Tokyo", "Asia/Tokyo"],
];

export function timezonePicker(): InlineKeyboard {
  const kb = new InlineKeyboard();
  COMMON_ZONES.forEach(([label, zone], i) => {
    kb.text(label, `tz:${zone}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
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
    .text("⚙️ Settings", "settings:open")
    .text("❓ Help", "help:open");
}

// Navigation under the priority board.
export function boardMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Add", "add:new")
    .text("📋 Today", "list:today")
    .row()
    .text("🔄 Refresh", "board:open")
    .text("« Back", "menu:back");
}
