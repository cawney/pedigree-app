// Markup drawn on catalog pages.
//
// Coordinates are in PDF page units (points, 1/72 inch) measured from the
// page's top-left corner as displayed. That keeps marks sharp at any zoom and
// lets them be drawn into exported PDFs exactly where they appear.

/** [x, y, pressure 0–1] */
export type InkPoint = [number, number, number];

export interface Stroke {
  kind: "pen" | "highlighter";
  id: string;
  color: string;
  /** Line width in page units. */
  width: number;
  points: InkPoint[];
  /** True when drawn with a real pressure-sensitive pen (Apple Pencil). */
  pressure: boolean;
}

export interface Note {
  kind: "note";
  id: string;
  /** Top-left corner of the note. */
  x: number;
  y: number;
  text: string;
  color: string;
}

export type Annotation = Stroke | Note;

/** Everything drawn on one page of one catalog. */
export interface PageMarkup {
  /** `${itemId}:${page}` */
  key: string;
  itemId: string;
  page: number;
  annotations: Annotation[];
  updatedAt: string;
}

export type Tool = "pen" | "highlighter" | "note" | "eraser";

export const PEN_COLORS = ["#1d2420", "#c62828", "#1e5bd6", "#1f7a3f"];
export const HIGHLIGHTER_COLORS = ["#ffe600", "#7dff5a", "#ff7ad9", "#5ad7ff"];
export const NOTE_COLORS = ["#fff4a3", "#ffd1dc", "#c8f2c2", "#cfe6ff"];

/** Line widths in page units (a US Letter page is 612 wide). */
export const PEN_WIDTHS = [1.2, 2.2, 3.6];
export const HIGHLIGHTER_WIDTHS = [9, 14, 22];

/** Notes are a fixed width so they lay out the same everywhere. */
export const NOTE_WIDTH = 150;
export const NOTE_FONT_SIZE = 10;
