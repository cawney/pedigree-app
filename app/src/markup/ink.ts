// Turning recorded points into drawable shapes, and eraser hit-testing.

import getStroke from "perfect-freehand";
import type { InkPoint, Stroke } from "./types";

/** Maps a point in page units to the space a path is drawn in. */
export type PointMap = (x: number, y: number) => [number, number];
const identity: PointMap = (x, y) => [x, y];

/** Outline polygon for a pen stroke; its width follows pressure. */
export function penOutline(points: InkPoint[], width: number, pressure: boolean, done = true): number[][] {
  return getStroke(points, {
    size: width,
    thinning: pressure ? 0.6 : 0.45,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !pressure,
    last: done,
  });
}

/** SVG path for a pen stroke: a filled outline. */
export function penPath(points: InkPoint[], width: number, pressure: boolean, done = true, map: PointMap = identity): string {
  return outlineToPath(penOutline(points, width, pressure, done), map);
}

/** SVG path for a highlighter stroke: a plain centre line, drawn with a thick stroke. */
export function centerLinePath(points: InkPoint[], map: PointMap = identity): string {
  if (points.length === 0) return "";
  const fmt = (x: number, y: number) => map(x, y).map(round).join(" ");
  const [first, ...rest] = points;
  // A single tap still draws a dot.
  if (rest.length === 0) return `M${fmt(first[0], first[1])} L${fmt(first[0] + 0.01, first[1])}`;
  return `M${fmt(first[0], first[1])} ` + rest.map((p) => `L${fmt(p[0], p[1])}`).join(" ");
}

export function strokePath(s: Stroke, done = true, map: PointMap = identity): string {
  return s.kind === "highlighter" ? centerLinePath(s.points, map) : penPath(s.points, s.width, s.pressure, done, map);
}

/** Smooth closed path through an outline polygon (quadratic curves between midpoints). */
function outlineToPath(outline: number[][], map: PointMap): string {
  if (outline.length < 3) return "";
  const pts = outline.map(([x, y]) => map(x, y));
  const f = (p: number[]) => `${round(p[0])} ${round(p[1])}`;
  let d = `M${f(pts[0])} Q`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    d += `${f(a)} ${f([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])} `;
  }
  return d + "Z";
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Does a circle at (x, y) with radius r touch the stroke? */
export function hitsStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const reach = r + s.width / 2;
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

function distToSegment(x: number, y: number, a: InkPoint, b: InkPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** Skip points closer than `minDist` to the previous one (keeps stored strokes small). */
export function addPoint(points: InkPoint[], p: InkPoint, minDist = 0.4): boolean {
  const last = points[points.length - 1];
  if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < minDist) return false;
  points.push([round(p[0]), round(p[1]), Math.round(p[2] * 100) / 100]);
  return true;
}
