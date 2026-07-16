import PDFDocument from "pdfkit";
import type { Category, Task } from "../db/schema.js";
import { formatDue } from "../utils/format.js";

const PRIORITY_ORDER = [1, 2, 3, 4] as const;
const PRIORITY_LABEL: Record<number, string> = {
  1: "Critical",
  2: "Important",
  3: "Normal",
  4: "Low",
};

function recurrenceText(task: Task): string {
  if (task.recurrence === "none") return "";
  if (task.recurrence === "custom") {
    const n = task.recurrenceIntervalDays ?? 0;
    return n > 0 ? `Repeats every ${n} day${n > 1 ? "s" : ""}` : "Repeats";
  }
  return `Repeats ${task.recurrence}`;
}

/**
 * Renders every open (not done/cancelled) task into a PDF, grouped by
 * priority the same way the in-chat /board is. Returns the finished file
 * as a Buffer, ready to send as a Telegram document.
 */
export function buildTasksPdf(
  userName: string | null,
  tasks: Task[],
  catMap: Map<number, Category>,
  timezone: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).fillColor("#111").text("Personal Tracker — Task List", { align: "center" });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .fillColor("#666")
      .text(
        `${userName ? userName + "  ·  " : ""}Generated ${new Date().toLocaleString()}  ·  ${tasks.length} open task${tasks.length === 1 ? "" : "s"}`,
        { align: "center" }
      );
    doc.moveDown(1.2);

    if (tasks.length === 0) {
      doc.fontSize(13).fillColor("#333").text("No pending tasks — you're all caught up.", { align: "center" });
      doc.end();
      return;
    }

    const groups = new Map<number, Task[]>();
    for (const t of tasks) {
      const p = Math.min(4, Math.max(1, t.priority));
      const list = groups.get(p) ?? [];
      list.push(t);
      groups.set(p, list);
    }

    for (const p of PRIORITY_ORDER) {
      const items = groups.get(p);
      if (!items || items.length === 0) continue;

      doc
        .fontSize(14)
        .fillColor("#111")
        .text(`${PRIORITY_LABEL[p]}  (${items.length})`, { underline: true });
      doc.moveDown(0.4);

      items.forEach((t, i) => {
        const cat = catMap.get(t.categoryId ?? -1);
        doc.fontSize(11).fillColor("#000").text(`${i + 1}. ${t.title}`, { continued: false });

        const meta: string[] = [];
        if (cat) meta.push(cat.name);
        meta.push(`Due: ${formatDue(t.dueAt, timezone)}`);
        const rec = recurrenceText(t);
        if (rec) meta.push(rec);
        doc
          .fontSize(9)
          .fillColor("#555")
          .text(meta.join("   ·   "), { indent: 14 });

        if (t.notes) {
          doc.fontSize(9).fillColor("#888").text(t.notes, { indent: 14 });
        }
        doc.moveDown(0.5);
      });

      doc.moveDown(0.6);
    }

    doc.end();
  });
}
