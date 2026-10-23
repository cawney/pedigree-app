// Zoom and pan math for the page viewer.
//
// The page box (fitted size w×h) sits centered in the stage. It is drawn with
// `translate(x, y) scale(zoom)` from its top-left corner, so a point `u`
// inside the box appears at stage position `offset + pan + zoom * u`.

export interface Size {
  w: number;
  h: number;
}

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
export const IDENTITY: View = { zoom: 1, x: 0, y: 0 };

function clampAxis(pan: number, zoom: number, box: number, stage: number): number {
  const offset = (stage - box) / 2;
  const scaled = box * zoom;
  // Smaller than the screen: keep it centered.
  if (scaled <= stage) return stage / 2 - offset - scaled / 2;
  // Bigger: don't let an edge pull inside the screen.
  return Math.min(-offset, Math.max(stage - offset - scaled, pan));
}

/** Keep the zoomed page covering the screen (or centered if it's smaller). */
export function clampView(v: View, box: Size, stage: Size): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom));
  return {
    zoom,
    x: clampAxis(v.x, zoom, box.w, stage.w),
    y: clampAxis(v.y, zoom, box.h, stage.h),
  };
}

/**
 * Zoom to `zoom` while keeping the content that was under stage point
 * `anchor` (with view `from`) under stage point `to`. Used for pinch (anchor
 * = starting midpoint, to = current midpoint) and double-tap.
 */
export function zoomAround(from: View, zoom: number, anchor: { x: number; y: number }, to: { x: number; y: number }, box: Size, stage: Size): View {
  const ox = (stage.w - box.w) / 2;
  const oy = (stage.h - box.h) / 2;
  const ux = (anchor.x - ox - from.x) / from.zoom;
  const uy = (anchor.y - oy - from.y) / from.zoom;
  return clampView({ zoom, x: to.x - ox - zoom * ux, y: to.y - oy - zoom * uy }, box, stage);
}

/** Largest size that fits `page` inside `stage` without changing its shape. */
export function fitSize(page: Size, stage: Size): Size & { scale: number } {
  const scale = Math.min(stage.w / page.w, stage.h / page.h);
  return { w: page.w * scale, h: page.h * scale, scale };
}

/**
 * iOS Safari refuses to draw canvases above ~16.7 megapixels, so cap the
 * render scale.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

export function capScale(page: Size, scale: number, maxPixels = MAX_CANVAS_PIXELS): number {
  const pixels = page.w * scale * page.h * scale;
  return pixels > maxPixels ? scale * Math.sqrt(maxPixels / pixels) : scale;
}
