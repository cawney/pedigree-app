// Building PDFs to share: chosen pages (or the whole book) with markup drawn
// in, plus an optional short list summary page. Runs entirely on the device,
// so it works with no signal.

import { BlendMode, LineCapStyle, PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, type RGB } from "pdf-lib";
import type { PageViewport, PDFDocumentProxy } from "pdfjs-dist";
import { strokePath } from "../markup/ink";
import { loadPage } from "../markup/store";
import { NOTE_FONT_SIZE, NOTE_WIDTH, type Annotation } from "../markup/types";
import { openPdf } from "../pdf";
import { hipLabel, type HipEntry } from "../shortlist/types";
import { pdfFiles } from "../store/files";

export interface ExportPage {
  itemId: string;
  page: number;
}

export interface SummaryOptions {
  title: string;
  entries: HipEntry[];
  catalogTitles: Map<string, string>;
  /** Bid limits are private, so they're only included when asked. */
  includeBids: boolean;
}

type Progress = (message: string) => void;

/** One catalog opened for export: raw bytes for pdf-lib, PDF.js for coordinates. */
async function openCatalog(itemId: string) {
  const source = await pdfFiles.open(itemId);
  const bytes = source.kind === "blob" ? await source.blob.arrayBuffer() : await (await fetch(source.url)).arrayBuffer();
  let task: ReturnType<typeof openPdf> | undefined;
  return {
    source,
    bytes,
    async viewer(): Promise<PDFDocumentProxy> {
      task ??= openPdf(source);
      return task.promise;
    },
    async close() {
      await task?.destroy();
    },
  };
}

/** Selected pages from one or more catalogs, in the order given. */
export async function buildPagesPdf(
  pages: ExportPage[],
  opts: { includeMarkup: boolean; summary?: SummaryOptions; onProgress?: Progress },
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  if (opts.summary) drawSummary(out, font, bold, opts.summary);

  const itemIds = [...new Set(pages.map((p) => p.itemId))];
  const copied = new Map<string, PDFPage>();
  for (const [i, itemId] of itemIds.entries()) {
    opts.onProgress?.(itemIds.length > 1 ? `Preparing catalog ${i + 1} of ${itemIds.length}…` : "Preparing pages…");
    const cat = await openCatalog(itemId);
    try {
      const src = await PDFDocument.load(cat.bytes, { ignoreEncryption: true });
      const nums = pages.filter((p) => p.itemId === itemId).map((p) => p.page);
      const copies = await out.copyPages(src, nums.map((n) => n - 1));
      for (const [j, n] of nums.entries()) {
        if (opts.includeMarkup) await drawPageMarkup(copies[j], await loadPage(itemId, n), cat, n, font);
        copied.set(`${itemId}:${n}`, copies[j]);
      }
    } finally {
      await cat.close();
    }
  }
  for (const p of pages) {
    const page = copied.get(`${p.itemId}:${p.page}`);
    if (page) out.addPage(page);
  }
  opts.onProgress?.("Saving…");
  return out.save();
}

/** The whole catalog. Without markup this is the original file, untouched. */
export async function buildBookPdf(itemId: string, opts: { includeMarkup: boolean; onProgress?: Progress }): Promise<Blob | Uint8Array> {
  const cat = await openCatalog(itemId);
  try {
    if (!opts.includeMarkup) return cat.source.kind === "blob" ? cat.source.blob : new Uint8Array(cat.bytes);
    opts.onProgress?.("Adding your markup…");
    const doc = await PDFDocument.load(cat.bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= doc.getPageCount(); n++) {
      const anns = await loadPage(itemId, n);
      if (anns.length) await drawPageMarkup(doc.getPage(n - 1), anns, cat, n, font);
    }
    opts.onProgress?.("Saving…");
    return doc.save();
  } finally {
    await cat.close();
  }
}

async function drawPageMarkup(
  page: PDFPage,
  anns: Annotation[],
  cat: Awaited<ReturnType<typeof openCatalog>>,
  pageNum: number,
  font: PDFFont,
) {
  if (!anns.length) return;
  const viewport = (await (await cat.viewer()).getPage(pageNum)).getViewport({ scale: 1 });
  drawMarkup(page, anns, viewport, font);
}

/**
 * Draw markup onto a PDF page. Markup is stored in on-screen page units;
 * PDF.js converts those to the page's own PDF coordinates, which accounts
 * for cropping and rotation.
 */
export function drawMarkup(page: PDFPage, anns: Annotation[], viewport: PageViewport, font: PDFFont) {
  const toPdf = (x: number, y: number) => viewport.convertToPdfPoint(x, y) as [number, number];
  // drawSvgPath flips y around its origin, so feed it negated y.
  const forSvg = (x: number, y: number): [number, number] => {
    const [px, py] = toPdf(x, y);
    return [px, -py];
  };

  for (const a of anns) {
    if (a.kind === "highlighter") {
      page.drawSvgPath(strokePath(a, true, forSvg), {
        x: 0,
        y: 0,
        borderColor: hex(a.color),
        borderWidth: a.width,
        borderLineCap: LineCapStyle.Round,
        blendMode: BlendMode.Multiply,
      });
    }
  }
  for (const a of anns) {
    if (a.kind === "pen") page.drawSvgPath(strokePath(a, true, forSvg), { x: 0, y: 0, color: hex(a.color) });
  }
  for (const a of anns) {
    if (a.kind !== "note") continue;
    const size = NOTE_FONT_SIZE;
    const pad = size * 0.55;
    const lines = wrapText(a.text, font, size, NOTE_WIDTH - pad * 2);
    const height = lines.length * size * 1.3 + pad * 2;
    const [x, top] = toPdf(a.x, a.y);
    page.drawRectangle({ x, y: top - height, width: NOTE_WIDTH, height, color: hex(a.color), borderColor: rgb(0.75, 0.72, 0.6), borderWidth: 0.5 });
    lines.forEach((line, i) =>
      page.drawText(line, { x: x + pad, y: top - pad - size * (i + 1) * 1.3 + size * 0.3, size, font, color: rgb(0.11, 0.14, 0.13) }),
    );
  }
}

// ---------- Summary page ----------

const LETTER = { w: 612, h: 792 };
const MARGIN = 40;

function drawSummary(doc: PDFDocument, font: PDFFont, bold: PDFFont, s: SummaryOptions) {
  const cols = [
    { label: "Hip", width: 52 },
    { label: "Catalog", width: 120 },
    { label: "Rating", width: 42 },
    { label: "Tags", width: 90 },
    ...(s.includeBids ? [{ label: "Bid limit", width: 62 }] : []),
  ];
  const noteWidth = LETTER.w - MARGIN * 2 - cols.reduce((n, c) => n + c.width, 0);
  cols.push({ label: "Notes", width: noteWidth });

  const size = 9;
  const lineH = size * 1.3;
  let page = doc.addPage([LETTER.w, LETTER.h]);
  let y = LETTER.h - MARGIN;

  page.drawText(pdfText(s.title), { x: MARGIN, y: y - 16, size: 16, font: bold });
  y -= 30;
  const when = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  page.drawText(pdfText(`${s.entries.length} horses · ${when}`), { x: MARGIN, y: y - 10, size: 10, font, color: rgb(0.4, 0.42, 0.41) });
  y -= 26;

  const header = () => {
    let x = MARGIN;
    for (const c of cols) {
      page.drawText(c.label, { x, y: y - size, size, font: bold });
      x += c.width;
    }
    y -= lineH + 4;
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: LETTER.w - MARGIN, y: y + 2 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
    y -= 4;
  };
  header();

  for (const e of s.entries) {
    const cells = [
      hipLabel(e),
      s.catalogTitles.get(e.itemId) ?? "",
      e.rating ? `${e.rating}/5` : "",
      e.tags.join(", "),
      ...(s.includeBids ? [e.bidLimit ? `$${e.bidLimit.toLocaleString("en-US")}` : ""] : []),
      e.note ?? "",
    ].map((text, i) => wrapText(text, font, size, cols[i].width - 6));
    const rowH = Math.max(1, ...cells.map((c) => c.length)) * lineH + 6;

    if (y - rowH < MARGIN) {
      page = doc.addPage([LETTER.w, LETTER.h]);
      y = LETTER.h - MARGIN;
      header();
    }
    let x = MARGIN;
    cells.forEach((lines, i) => {
      lines.forEach((line, j) => page.drawText(line, { x, y: y - size - j * lineH, size, font }));
      x += cols[i].width;
    });
    y -= rowH;
    page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: LETTER.w - MARGIN, y: y + 3 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
  }
}

// ---------- Text helpers ----------

/**
 * The built-in PDF fonts only cover Western European characters. Swap
 * typographic punctuation for plain equivalents and drop anything else
 * (e.g. emoji) rather than failing the whole export.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "·")
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "");
}

export function wrapText(text: string, font: Pick<PDFFont, "widthOfTextAtSize">, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of pdfText(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the column is broken up.
      line = word;
      while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function hex(color: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0, 0, 0);
}
