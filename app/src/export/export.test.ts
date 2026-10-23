import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "../markup/types";
import type { HipEntry } from "../shortlist/types";
import { shortlistCsv } from "./csv";

vi.mock("../pdf", () => ({}));
vi.mock("../store/files", () => ({}));
vi.mock("../markup/store", () => ({}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: {}, Filesystem: {} }));
vi.mock("@capacitor/share", () => ({ Share: {} }));

const { drawMarkup, pdfText, wrapText } = await import("./buildPdf");
const { fileName } = await import("./share");
const { parseDollars } = await import("../shortlist/HipPanel");

const entry = (over: Partial<HipEntry>): HipEntry => ({
  key: "a:1",
  itemId: "a",
  page: 1,
  rating: 0,
  tags: [],
  addedAt: "",
  updatedAt: "",
  ...over,
});

describe("shortlistCsv", () => {
  const titles = new Map([["a", "Fall Sale"]]);
  const rows = [entry({ hip: "12", rating: 4, tags: ["Vet", "Inspect"], bidLimit: 150000, note: 'Said "nice", walks well\nsmall', horse: { sire: "Gun Runner" } })];

  it("quotes cells and keeps bid limits out unless asked", () => {
    const csv = shortlistCsv(rows, titles, false);
    expect(csv.startsWith("﻿Catalog,Hip,Page,Rating,Tags,Notes,Sire,Dam,Sex\r\n")).toBe(true);
    expect(csv).toContain('Fall Sale,12,1,4,Vet; Inspect,"Said ""nice"", walks well\nsmall",Gun Runner,,');
    expect(csv).not.toContain("150000");
    expect(shortlistCsv(rows, titles, true)).toContain(",150000,");
  });

  it("stops spreadsheet formulas", () => {
    expect(shortlistCsv([entry({ note: "=HYPERLINK(1)" })], titles, false)).toContain("'=HYPERLINK(1)");
  });
});

describe("pdf text", () => {
  it("replaces characters the built-in fonts can't draw", () => {
    expect(pdfText("“Nice” – walk… 🐎 café")).toBe('"Nice" - walk...  café');
  });

  it("wraps to width, breaking long words", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrapText("Good walk and a big hip on him\nVet first", font, 10, 80);
    expect(lines.every((l) => font.widthOfTextAtSize(l, 10) <= 80)).toBe(true);
    expect(lines.at(-1)).toBe("Vet first");
    expect(wrapText("x".repeat(60), font, 10, 50).length).toBeGreaterThan(1);
  });
});

describe("drawMarkup", () => {
  it("draws strokes and notes onto a PDF page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const anns: Annotation[] = [
      { kind: "pen", id: "p", color: "#c62828", width: 2, pressure: false, points: [[10, 10, 0.5], [100, 50, 0.5], [200, 60, 0.5]] },
      { kind: "highlighter", id: "h", color: "#ffe600", width: 14, pressure: false, points: [[10, 300, 0.5], [300, 300, 0.5]] },
      { kind: "note", id: "n", x: 50, y: 500, text: "Vet first 🐎", color: "#fff4a3" },
    ];
    // Unrotated page: PDF y runs up from the bottom.
    const viewport = { convertToPdfPoint: (x: number, y: number) => [x, 792 - y] };
    drawMarkup(page, anns, viewport as never, font);
    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.getPageCount()).toBe(1);
  });
});

describe("helpers", () => {
  it("parses dollar amounts", () => {
    expect(parseDollars("150,000")).toBe(150000);
    expect(parseDollars("$150k")).toBe(150000);
    expect(parseDollars("1.2m")).toBe(1200000);
    expect(parseDollars("")).toBeUndefined();
    expect(parseDollars("abc")).toBeUndefined();
  });

  it("makes safe file names", () => {
    expect(fileName('Keeneland: Sept / Book 1 "test"', "pdf")).toBe("Keeneland Sept Book 1 test.pdf");
    expect(fileName("", "csv")).toBe("Catalog.csv");
  });
});
