import { DateTime } from "luxon";

// Resolve a named quick-date choice to an absolute Date in the user's timezone.
// Defaults to 9:00am local for date-only choices.
export function resolveQuickDate(choice: string, timezone: string): Date | null {
  const now = DateTime.now().setZone(timezone);
  switch (choice) {
    case "none":
      return null;
    case "today":
      return now.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    case "tonight":
      return now.set({ hour: 20, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    case "tomorrow":
      return now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    case "weekend": {
      // Next Saturday (or today if it's already the weekend).
      const daysToSat = (6 - now.weekday + 7) % 7; // luxon: Mon=1..Sun=7, Sat=6
      return now.plus({ days: daysToSat }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    }
    case "week":
      return now.plus({ weeks: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    default:
      return null;
  }
}

// Snooze helper: compute a new remind time from a token.
export function resolveSnooze(token: string, timezone: string): Date | null {
  const now = DateTime.now().setZone(timezone);
  if (/^\d+$/.test(token)) return now.plus({ minutes: Number(token) }).toJSDate();
  switch (token) {
    case "tonight":
      return now.set({ hour: 20, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    case "tomorrow":
      return now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    case "week":
      return now.plus({ weeks: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    default:
      return null;
  }
}

// Advance a recurring task to its next occurrence. `intervalDays` is only
// used (and required) when recurrence is "custom" (repeat every N days).
export function nextOccurrence(
  from: Date,
  recurrence: string,
  intervalDays?: number | null
): Date | null {
  const dt = DateTime.fromJSDate(from);
  switch (recurrence) {
    case "daily":
      return dt.plus({ days: 1 }).toJSDate();
    case "weekly":
      return dt.plus({ weeks: 1 }).toJSDate();
    case "monthly":
      return dt.plus({ months: 1 }).toJSDate();
    case "custom":
      return intervalDays && intervalDays > 0 ? dt.plus({ days: intervalDays }).toJSDate() : null;
    default:
      return null;
  }
}
