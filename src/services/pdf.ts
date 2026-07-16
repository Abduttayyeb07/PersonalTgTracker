import PDFDocument from "pdfkit";
import type { Category, Task } from "../db/schema.js";
import { formatDue } from "../utils/format.js";

const PRIORITY_ORDER = [1, 2, 3, 4] as const;
const PRIORITY_META: Record<number, { label: string; color: string }> = {
  1: { label: "CRITICAL", color: "#E5484D" },
  2: { label: "IMPORTANT", color: "#F5A524" },
  3: { label: "NORMAL", color: "#3B82F6" },
  4: { label: "LOW", color: "#9AA1AC" },
};

const COLORS = {
  headerBg: "#241B3D",
  headerAccent: "#F5A524",
  headerSubtext: "#C9BFE8",
  text: "#1F2430",
  muted: "#6B7280",
  faint: "#9AA1AC",
  divider: "#E8E4F2",
  footer: "#B0AAC2",
};

const PAGE_MARGIN_X = 50;
const HEADER_HEIGHT = 108;

function recurrenceText(task: Task): string {
  if (task.recurrence === "none") return "";
  if (task.recurrence === "custom") {
    const n = task.recurrenceIntervalDays ?? 0;
    return n > 0 ? `Repeats every ${n} day${n > 1 ? "s" : ""}` : "Repeats";
  }
  return `Repeats ${task.recurrence}`;
}

/**
 * Renders every open (not done/cancelled) task into a PDF: a branded header
 * band, tasks grouped by priority with color-coded section markers (matching
 * the in-chat /board), card-style rows with dividers, and page numbers.
 * Returns the finished file as a Buffer, ready to send as a Telegram document.
 */
export function buildTasksPdf(
  userName: string | null,
  tasks: Task[],
  catMap: Map<number, Category>,
  timezone: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: HEADER_HEIGHT + 30, bottom: 55, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - PAGE_MARGIN_X * 2;

    function drawHeaderBand(): void {
      doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(COLORS.headerBg);
      doc.rect(0, HEADER_HEIGHT - 4, pageWidth, 4).fill(COLORS.headerAccent);
      doc
        .font("Helvetica-Bold")
        .fontSize(22)
        .fillColor("#FFFFFF")
        .text("Personal Tracker", PAGE_MARGIN_X, 28);
      doc.font("Helvetica").fontSize(11).fillColor(COLORS.headerSubtext).text("Task Export", PAGE_MARGIN_X, 56);
      const meta = `${userName ? userName + "   ·   " : ""}Generated ${new Date().toLocaleString()}   ·   ${tasks.length} open task${tasks.length === 1 ? "" : "s"}`;
      doc.fontSize(9).fillColor(COLORS.headerSubtext).text(meta, PAGE_MARGIN_X, 76);
      // The .text() calls above move pdfkit's flow cursor to wherever they
      // finished rendering — reset it to the true content start so the first
      // section heading never overlaps the header's accent stripe.
      doc.y = HEADER_HEIGHT + 30;
    }

    drawHeaderBand();
    doc.on("pageAdded", drawHeaderBand);

    if (tasks.length === 0) {
      doc
        .font("Helvetica")
        .fontSize(13)
        .fillColor(COLORS.muted)
        .text("No pending tasks — you're all caught up.", PAGE_MARGIN_X, doc.y + 20, {
          width: contentWidth,
          align: "center",
        });
      finish();
      return;
    }

    const groups = new Map<number, Task[]>();
    for (const t of tasks) {
      const p = Math.min(4, Math.max(1, t.priority));
      const list = groups.get(p) ?? [];
      list.push(t);
      groups.set(p, list);
    }

    // Adds a new page (redrawing the header via the 'pageAdded' listener)
    // if the given height wouldn't fit before the bottom margin — keeps a
    // section heading or task block from splitting across pages with just
    // its marker/dot orphaned on the trailing page.
    function ensureSpace(height: number): void {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (doc.y + height > bottom) doc.addPage();
    }

    for (const p of PRIORITY_ORDER) {
      const items = groups.get(p);
      if (!items || items.length === 0) continue;
      const meta = PRIORITY_META[p];

      ensureSpace(30);
      // Section heading: colored square marker + label + count, on one line.
      const markerY = doc.y + 3;
      doc.roundedRect(PAGE_MARGIN_X, markerY, 10, 10, 2).fill(meta.color);
      doc
        .font("Helvetica-Bold")
        .fontSize(12.5)
        .fillColor(COLORS.text)
        .text(`  ${meta.label}`, PAGE_MARGIN_X + 14, doc.y, { continued: true });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.muted)
        .text(`   ${items.length} task${items.length === 1 ? "" : "s"}`);

      doc.moveDown(0.35);
      doc
        .moveTo(PAGE_MARGIN_X, doc.y)
        .lineTo(PAGE_MARGIN_X + contentWidth, doc.y)
        .lineWidth(1)
        .strokeColor(meta.color)
        .stroke();
      doc.moveDown(0.5);

      items.forEach((t) => {
        const cat = catMap.get(t.categoryId ?? -1);
        const rowWidth = contentWidth - 14;

        // Measure the whole block up front so it moves to the next page as
        // one unit — never leaves a lone dot behind with its title pushed over.
        const metaLinePreview: string[] = [];
        if (cat) metaLinePreview.push(cat.name);
        metaLinePreview.push(`Due ${formatDue(t.dueAt, timezone)}`);
        const recPreview = recurrenceText(t);
        if (recPreview) metaLinePreview.push(recPreview);

        doc.font("Helvetica-Bold").fontSize(11.5);
        let blockHeight = doc.heightOfString(t.title, { width: rowWidth }) + 2;
        doc.font("Helvetica").fontSize(9);
        blockHeight += doc.heightOfString(metaLinePreview.join("   •   "), { width: rowWidth }) + 10;
        if (t.notes) {
          doc.font("Helvetica-Oblique").fontSize(9);
          blockHeight += doc.heightOfString(t.notes, { width: rowWidth }) + 2;
        }
        ensureSpace(blockHeight);

        const rowStartY = doc.y;

        // Priority dot + title.
        doc.circle(PAGE_MARGIN_X + 3.5, rowStartY + 7, 3.5).fill(meta.color);
        doc
          .font("Helvetica-Bold")
          .fontSize(11.5)
          .fillColor(COLORS.text)
          .text(t.title, PAGE_MARGIN_X + 14, rowStartY, { width: contentWidth - 14 });

        const metaLine: string[] = [];
        if (cat) metaLine.push(cat.name);
        metaLine.push(`Due ${formatDue(t.dueAt, timezone)}`);
        const rec = recurrenceText(t);
        if (rec) metaLine.push(rec);
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text(metaLine.join("   •   "), PAGE_MARGIN_X + 14, doc.y + 2, { width: contentWidth - 14 });

        if (t.notes) {
          doc
            .font("Helvetica-Oblique")
            .fontSize(9)
            .fillColor(COLORS.faint)
            .text(t.notes, PAGE_MARGIN_X + 14, doc.y + 2, { width: contentWidth - 14 });
        }

        doc.moveDown(0.55);
        doc
          .moveTo(PAGE_MARGIN_X + 14, doc.y)
          .lineTo(PAGE_MARGIN_X + contentWidth, doc.y)
          .lineWidth(0.5)
          .strokeColor(COLORS.divider)
          .stroke();
        doc.moveDown(0.5);
      });

      doc.moveDown(0.4);
    }

    finish();

    function finish(): void {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // The footer sits inside the page's own bottom margin — drawing
        // there via the normal flowing .text() would make pdfkit think the
        // content overflows and silently insert a phantom extra page for
        // every single footer. Zero out the bottom margin just for this one
        // absolute-positioned draw so it can't trigger that.
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc
          .font("Helvetica")
          .fontSize(8.5)
          .fillColor(COLORS.footer)
          .text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN_X, doc.page.height - 38, {
            width: contentWidth,
            align: "center",
            lineBreak: false,
          });
        doc.page.margins.bottom = savedBottom;
      }
      doc.end();
    }
  });
}
