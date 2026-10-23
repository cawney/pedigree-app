import { describe, expect, it } from "vitest";
import { addPoint, centerLinePath, hitsStroke, penPath } from "./ink";
import type { InkPoint, Stroke } from "./types";

const stroke = (points: InkPoint[], width = 2): Stroke => ({ kind: "pen", id: "s", color: "#000", width, points, pressure: false });

describe("hitsStroke", () => {
  const line = stroke([[0, 0, 0.5], [100, 0, 0.5]]);
  it("hits near the line and misses away from it", () => {
    expect(hitsStroke(line, 50, 4, 5)).toBe(true);
    expect(hitsStroke(line, 50, 10, 5)).toBe(false);
    expect(hitsStroke(line, 110, 0, 5)).toBe(false);
  });
  it("handles single-point dots", () => {
    expect(hitsStroke(stroke([[10, 10, 0.5]]), 12, 12, 5)).toBe(true);
  });
});

describe("addPoint", () => {
  it("drops points too close together and rounds", () => {
    const pts: InkPoint[] = [];
    expect(addPoint(pts, [1.23456, 2, 0.555])).toBe(true);
    expect(addPoint(pts, [1.3, 2, 0.5])).toBe(false);
    expect(addPoint(pts, [3, 2, 0.5])).toBe(true);
    expect(pts[0]).toEqual([1.23, 2, 0.56]);
    expect(pts).toHaveLength(2);
  });
});

describe("paths", () => {
  it("builds closed pen outlines and open highlighter lines", () => {
    const pts: InkPoint[] = [[0, 0, 0.5], [10, 5, 0.6], [20, 0, 0.7]];
    expect(penPath(pts, 2, true)).toMatch(/^M.*Z$/);
    expect(centerLinePath(pts)).toBe("M0 0 L10 5 L20 0");
    expect(centerLinePath([[5, 5, 0.5]])).toMatch(/^M5 5 L/);
  });
});
