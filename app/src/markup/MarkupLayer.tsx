import { memo, useSyncExternalStore } from "react";
import type { Size } from "../viewer/geometry";
import type { LiveInk } from "./drawing";
import { strokePath } from "./ink";
import { NOTE_FONT_SIZE, NOTE_WIDTH, type Annotation, type Note, type Stroke } from "./types";

interface Props {
  page: number;
  annotations: Annotation[];
  /** Page size in page units. */
  size: Size;
  /** CSS pixels per page unit (before zoom). */
  cssScale: number;
  live: LiveInk;
}

/** Draws a page's markup over the rendered PDF page. */
export function MarkupLayer({ page, annotations, size, cssScale, live }: Props) {
  // Re-render only when the in-progress stroke on *this* page changes.
  useSyncExternalStore(live.subscribe, () => (live.page === page ? live.version : -1));
  const isLive = live.page === page;
  const hidden = isLive ? live.hidden : undefined;
  const visible = hidden?.size ? annotations.filter((a) => !hidden.has(a.id)) : annotations;
  const strokes = visible.filter((a): a is Stroke => a.kind !== "note");
  const notes = visible.filter((a): a is Note => a.kind === "note");
  const liveStroke = isLive ? live.stroke : null;
  const viewBox = `0 0 ${size.w} ${size.h}`;

  return (
    <div className="markup-layer">
      {/* Highlighters multiply with the page so text underneath stays crisp and dark. */}
      <svg className="ink highlights" viewBox={viewBox} preserveAspectRatio="none">
        {strokes.map((s) => s.kind === "highlighter" && <StrokeShape key={s.id} stroke={s} />)}
        {liveStroke?.kind === "highlighter" && <StrokeShape stroke={liveStroke} version={live.version} />}
      </svg>
      <svg className="ink" viewBox={viewBox} preserveAspectRatio="none">
        {strokes.map((s) => s.kind === "pen" && <StrokeShape key={s.id} stroke={s} />)}
        {liveStroke?.kind === "pen" && <StrokeShape stroke={liveStroke} version={live.version} live />}
      </svg>
      {notes.map((n) => (
        <div
          key={n.id}
          className="note"
          data-note-id={n.id}
          style={{
            left: n.x * cssScale,
            top: n.y * cssScale,
            width: NOTE_WIDTH * cssScale,
            fontSize: NOTE_FONT_SIZE * cssScale,
            background: n.color,
          }}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}

/** Strokes never change once drawn, so their (costly) outline is computed once. */
const StrokeShape = memo(function StrokeShape({ stroke, live }: { stroke: Stroke; version?: number; live?: boolean }) {
  const d = strokePath(stroke, !live);
  if (stroke.kind === "highlighter") {
    return <path d={d} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />;
  }
  return <path d={d} fill={stroke.color} />;
});
