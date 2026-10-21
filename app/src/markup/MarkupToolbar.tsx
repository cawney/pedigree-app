import type { ToolSettings } from "./useMarkup";
import { HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, NOTE_COLORS, PEN_COLORS, PEN_WIDTHS, type Tool } from "./types";

interface Props {
  tools: ToolSettings;
  onTools: (patch: Partial<ToolSettings>) => void;
  fingerDraws: boolean;
  onFingerDraws: (on: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "pen", label: "Pen", icon: "✎" },
  { tool: "highlighter", label: "Highlighter", icon: "▍" },
  { tool: "note", label: "Note", icon: "▤" },
  { tool: "eraser", label: "Eraser", icon: "⌫" },
];

/** Tool palette shown while marking up. */
export function MarkupToolbar(p: Props) {
  const { tools, onTools } = p;
  const colors =
    tools.tool === "pen" ? PEN_COLORS : tools.tool === "highlighter" ? HIGHLIGHTER_COLORS : tools.tool === "note" ? NOTE_COLORS : [];
  const color =
    tools.tool === "pen" ? tools.penColor : tools.tool === "highlighter" ? tools.highlighterColor : tools.noteColor;
  const setColor = (c: string) =>
    onTools(tools.tool === "pen" ? { penColor: c } : tools.tool === "highlighter" ? { highlighterColor: c } : { noteColor: c });
  const widths = tools.tool === "pen" ? PEN_WIDTHS : tools.tool === "highlighter" ? HIGHLIGHTER_WIDTHS : [];
  const width = tools.tool === "pen" ? tools.penWidth : tools.highlighterWidth;
  const setWidth = (i: number) => onTools(tools.tool === "pen" ? { penWidth: i } : { highlighterWidth: i });

  return (
    <div className="markup-toolbar" role="toolbar" aria-label="Markup tools">
      <div className="tool-group">
        <button className="tool-btn" aria-label="Previous page" onClick={p.onPrev}>
          ‹
        </button>
        <button className="tool-btn" aria-label="Next page" onClick={p.onNext}>
          ›
        </button>
      </div>

      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className="tool-btn"
            aria-label={t.label}
            title={t.label}
            aria-pressed={tools.tool === t.tool}
            onClick={() => onTools({ tool: t.tool })}
          >
            <span aria-hidden>{t.icon}</span>
            <small>{t.label}</small>
          </button>
        ))}
      </div>

      {colors.length > 0 && (
        <div className="tool-group">
          {colors.map((c) => (
            <button
              key={c}
              className="swatch"
              aria-label={`Color ${c}`}
              aria-pressed={c === color}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      )}

      {widths.length > 0 && (
        <div className="tool-group">
          {widths.map((w, i) => (
            <button key={w} className="tool-btn size" aria-label={["Thin", "Medium", "Thick"][i]} aria-pressed={i === width} onClick={() => setWidth(i)}>
              <span className="size-dot" style={{ width: 4 + i * 5, height: 4 + i * 5 }} />
            </button>
          ))}
        </div>
      )}

      <div className="tool-group">
        <button className="tool-btn" aria-label="Undo" title="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
          ↶
        </button>
        <button className="tool-btn" aria-label="Redo" title="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
          ↷
        </button>
        <button className="tool-btn" title="Clear this page" disabled={!p.canClear} onClick={p.onClear}>
          <small>Clear</small>
        </button>
      </div>

      <div className="tool-group">
        <button
          className="tool-btn"
          aria-pressed={p.fingerDraws}
          title={p.fingerDraws ? "Fingers draw. Tap so only the pencil draws." : "Only the pencil draws. Tap to draw with fingers too."}
          onClick={() => p.onFingerDraws(!p.fingerDraws)}
        >
          <span aria-hidden>☝</span>
          <small>{p.fingerDraws ? "Finger draws" : "Pencil only"}</small>
        </button>
      </div>
    </div>
  );
}
