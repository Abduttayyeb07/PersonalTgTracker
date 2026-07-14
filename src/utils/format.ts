import { DateTime } from "luxon";
import type { Category, Task } from "../db/schema.js";

const PRIORITY_LABEL: Record<number, string> = {
  1: "🔴 P1",
  2: "🟠 P2",
  3: "🟡 P3",
  4: "⚪ P4",
};

export function priorityLabel(p: number): string {
  return PRIORITY_LABEL[p] ?? "🟡 P3";
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatDue(dueAt: Date | null, timezone: string): string {
  if (!dueAt) return "no date";
  const dt = DateTime.fromJSDate(dueAt).setZone(timezone);
  const now = DateTime.now().setZone(timezone);
  const sameDay = dt.hasSame(now, "day");
  const tomorrow = dt.hasSame(now.plus({ days: 1 }), "day");
  const hasTime = dt.hour !== 0 || dt.minute !== 0;
  const timeStr = hasTime ? dt.toFormat("h:mm a") : "";
  if (sameDay) return timeStr ? `today ${timeStr}` : "today";
  if (tomorrow) return timeStr ? `tomorrow ${timeStr}` : "tomorrow";
  return dt.toFormat(hasTime ? "d LLL, h:mm a" : "d LLL");
}

export function isOverdue(task: Task, timezone: string): boolean {
  if (!task.dueAt) return false;
  return DateTime.fromJSDate(task.dueAt) < DateTime.now();
}

export function taskLine(task: Task, timezone: string, category?: Category): string {
  const cat = category ? `${category.emoji} ` : "";
  const due = task.dueAt ? ` · ${formatDue(task.dueAt, timezone)}` : "";
  const overdue = isOverdue(task, timezone) ? " ⚠️" : "";
  const bell = task.remindAt ? " 🔔" : "";
  return `${priorityLabel(task.priority).split(" ")[0]} ${cat}<b>${escapeHtml(task.title)}</b>${due}${overdue}${bell}`;
}

export function taskCard(task: Task, timezone: string, category?: Category): string {
  const lines = [
    `${priorityLabel(task.priority)}  ${category ? category.emoji + " " + escapeHtml(category.name) : ""}`,
    `\n<b>${escapeHtml(task.title)}</b>`,
  ];
  if (task.notes) lines.push(`\n<i>${escapeHtml(task.notes)}</i>`);
  lines.push(`\n📅 ${formatDue(task.dueAt, timezone)}`);
  if (task.remindAt)
    lines.push(`🔔 reminder: ${formatDue(task.remindAt, timezone)}`);
  if (task.recurrence !== "none") lines.push(`🔁 ${task.recurrence}`);
  return lines.join("\n");
}
