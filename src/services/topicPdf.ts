import PDFDocument from "pdfkit";
import type { SearchResult } from "./search.js";

const COLORS = {
  headerBg: "#241B3D",
  headerAccent: "#F5A524",
  headerSubtext: "#C9BFE8",
  text: "#1F2430",
  muted: "#6B7280",
  link: "#3B82F6",
  divider: "#E8E4F2",
};

const PAGE_MARGIN_X = 50;
const HEADER_HEIGHT = 100;

/**
 * Renders a topic's "what's new" digest as a short PDF: a branded header,
 * the AI-generated bullet summary, and a Sources section with the real
 * search-result links (never model-generated, so they can't be hallucinated).
 */
export function buildTopicPdf(topic: string, summary: string, results: SearchResult[]): Promise<Buffer> {
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
      doc.font("Helvetica-Bold").fontSize(20).fillColor("#FFFFFF").text(`What's new: ${topic}`, PAGE_MARGIN_X, 28, {
        width: contentWidth,
      });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(COLORS.headerSubtext)
        .text(`Generated ${new Date().toLocaleString()}`, PAGE_MARGIN_X, 62);
      doc.y = HEADER_HEIGHT + 30;
    }

    drawHeaderBand();
    doc.on("pageAdded", drawHeaderBand);

    // Summary bullets — one line each, already brief by prompt design.
    const bulletLines = summary
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
      .filter((l) => l.length > 0);

    for (const line of bulletLines) {
      doc.circle(PAGE_MARGIN_X + 3.5, doc.y + 7, 3.5).fill(COLORS.headerAccent);
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(COLORS.text)
        .text(line, PAGE_MARGIN_X + 14, doc.y, { width: contentWidth - 14 });
      doc.moveDown(0.5);
    }

    // Sources — real URLs from the search results, clickable, never from the model.
    if (results.length > 0) {
      doc.moveDown(0.5);
      doc
        .moveTo(PAGE_MARGIN_X, doc.y)
        .lineTo(PAGE_MARGIN_X + contentWidth, doc.y)
        .lineWidth(1)
        .strokeColor(COLORS.divider)
        .stroke();
      doc.moveDown(0.5);

      doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.text).text("Sources");
      doc.moveDown(0.3);

      results.forEach((r, i) => {
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor(COLORS.link)
          .text(`${i + 1}. ${r.title}`, PAGE_MARGIN_X, doc.y, {
            width: contentWidth,
            link: r.url || undefined,
            underline: Boolean(r.url),
          });
        doc.moveDown(0.35);
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN_X, doc.page.height - 38, {
          width: contentWidth,
          align: "center",
          lineBreak: false,
        });
      doc.page.margins.bottom = savedBottom;
    }
    doc.end();
  });
}
