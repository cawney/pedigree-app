import { useState } from "react";
import { NOTE_COLORS } from "./types";

interface Props {
  initialText: string;
  initialColor: string;
  isNew: boolean;
  onSave: (text: string, color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Write or edit a sticky note on a page. */
export function NoteSheet({ initialText, initialColor, isNew, onSave, onDelete, onClose }: Props) {
  const [text, setText] = useState(initialText);
  const [color, setColor] = useState(initialColor);
  const save = () => (text.trim() ? onSave(text.trim(), color) : isNew ? onClose() : onDelete());

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="note-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="note-title">{isNew ? "Add a note" : "Edit note"}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <textarea
          className="note-input"
          autoFocus
          rows={4}
          placeholder="e.g. Vet first. Good walk. Bid to $150k."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
          style={{ background: color }}
        />
        <div className="note-actions">
          <div className="tool-group">
            {NOTE_COLORS.map((c) => (
              <button key={c} className="swatch" aria-label={`Note color ${c}`} aria-pressed={c === color} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
          <div className="note-buttons">
            {!isNew && (
              <button className="btn danger-text" onClick={onDelete}>
                Delete
              </button>
            )}
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
