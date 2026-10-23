import { useEffect, useRef, useState } from "react";
import { removeEntry, updateEntry } from "./store";
import { PRESET_TAGS, type HipEntry } from "./types";

interface Props {
  entry: HipEntry;
  /** Tags used anywhere, for one-tap reuse. */
  knownTags: string[];
  /** Previous / next short-listed page in this catalog, if any. */
  prev?: number;
  next?: number;
  onGo: (page: number) => void;
  onClose: () => void;
}

/** Details for a short-listed hip: rating, tags, bid limit, note. Saves as you go. */
export function HipPanel({ entry, knownTags, prev, next, onGo, onClose }: Props) {
  const { itemId, page } = entry;
  const save = (patch: Partial<HipEntry>) => void updateEntry(itemId, page, patch);
  const [newTag, setNewTag] = useState("");
  const tags = [...new Set([...PRESET_TAGS, ...knownTags, ...entry.tags])];

  const toggleTag = (t: string) => save({ tags: entry.tags.includes(t) ? entry.tags.filter((x) => x !== t) : [...entry.tags, t] });
  const addTag = () => {
    const t = newTag.trim();
    if (t && !entry.tags.includes(t)) save({ tags: [...entry.tags, t] });
    setNewTag("");
  };

  return (
    <aside className="hip-panel" aria-label="Short list details">
      <div className="hip-panel-head">
        <label className="hip-number">
          <span>Hip</span>
          <DraftInput
            key={`hip-${entry.key}`}
            value={entry.hip ?? ""}
            placeholder="#"
            inputMode="text"
            aria-label="Hip number"
            onSave={(v) => save({ hip: v.trim() || undefined })}
          />
        </label>
        <span className="hip-page">Page {page}</span>
        <button className="icon-btn" aria-label="Close details" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="stars" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={entry.rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={n <= entry.rating ? "star on" : "star"}
            onClick={() => save({ rating: entry.rating === n ? 0 : n })}
          >
            ★
          </button>
        ))}
      </div>

      <div className="panel-section">
        <h3>Tags</h3>
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className="chip" aria-pressed={entry.tags.includes(t)} onClick={() => toggleTag(t)}>
              {t}
            </button>
          ))}
        </div>
        <form
          className="tag-add"
          onSubmit={(e) => {
            e.preventDefault();
            addTag();
          }}
        >
          <input placeholder="New tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} aria-label="New tag" />
          <button className="btn" type="submit" disabled={!newTag.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="panel-section">
        <h3>
          Bid limit <small>(private)</small>
        </h3>
        <div className="bid-input">
          <span>$</span>
          <DraftInput
            key={`bid-${entry.key}`}
            value={entry.bidLimit ? entry.bidLimit.toLocaleString("en-US") : ""}
            placeholder="0"
            inputMode="numeric"
            aria-label="Bid limit in dollars"
            onSave={(v) => save({ bidLimit: parseDollars(v) })}
          />
        </div>
      </div>

      <div className="panel-section">
        <h3>Notes</h3>
        <DraftInput
          key={`note-${entry.key}`}
          multiline
          value={entry.note ?? ""}
          placeholder="Conformation, walk, vet findings…"
          aria-label="Notes"
          onSave={(v) => save({ note: v.trim() || undefined })}
        />
      </div>

      <div className="panel-nav">
        <button className="btn" disabled={prev === undefined} onClick={() => prev !== undefined && onGo(prev)}>
          ‹ Previous on list
        </button>
        <button className="btn" disabled={next === undefined} onClick={() => next !== undefined && onGo(next)}>
          Next on list ›
        </button>
      </div>

      <button
        className="btn danger-text block"
        onClick={() => {
          void removeEntry(itemId, page);
          onClose();
        }}
      >
        Remove from short list
      </button>
    </aside>
  );
}

/** "$150,000" / "150k" / "1.2m" → whole dollars. */
export function parseDollars(input: string): number | undefined {
  const m = /^\$?\s*([\d,]*\.?\d*)\s*([km])?$/i.exec(input.trim());
  if (!m || !m[1].replace(/[,.]/g, "")) return undefined;
  const n = Number(m[1].replace(/,/g, "")) * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/**
 * A text field that keeps its own draft while typing and saves after a short
 * pause or when it loses focus, so typing never lags or jumps.
 */
function DraftInput({
  value,
  onSave,
  multiline,
  ...rest
}: { value: string; onSave: (v: string) => void; multiline?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<string | null>(null);
  const latest = useRef(onSave);
  latest.current = onSave;

  // Follow outside changes when not editing.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) latest.current(pending.current);
    pending.current = null;
  };
  const change = (v: string) => {
    setDraft(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  // Save anything pending if the panel closes mid-edit.
  useEffect(() => flush, []);

  const common = {
    value: draft,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      flush();
    },
  };
  return multiline ? (
    <textarea {...common} rows={4} placeholder={rest.placeholder} aria-label={rest["aria-label"]} onChange={(e) => change(e.target.value)} />
  ) : (
    <input {...common} {...rest} onChange={(e) => change(e.target.value)} />
  );
}
