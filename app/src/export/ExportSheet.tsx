import { useState } from "react";
import { formatBytes } from "../format";
import { canShareFiles, shareFile, type ShareFile } from "./share";

export interface BuildOptions {
  includeMarkup: boolean;
  includeSummary: boolean;
  includeBids: boolean;
  onProgress: (message: string) => void;
}

export interface ExportChoice {
  id: string;
  label: string;
  detail?: string;
  /** Which options apply to this choice. */
  options: { markup?: boolean; summary?: boolean; bids?: boolean };
  build: (o: BuildOptions) => Promise<ShareFile>;
}

type Step =
  | { step: "pick" }
  | { step: "building"; message: string }
  | { step: "ready"; file: ShareFile }
  | { step: "done"; message: string }
  | { step: "error"; message: string };

/**
 * Pick what to send, build it, then share. Building and sharing are two taps
 * because browsers only open the share sheet in direct response to a tap.
 */
export function ExportSheet({ title, choices, onClose }: { title: string; choices: ExportChoice[]; onClose: () => void }) {
  const [choiceId, setChoiceId] = useState(choices[0]?.id);
  const [includeMarkup, setIncludeMarkup] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeBids, setIncludeBids] = useState(false);
  const [state, setState] = useState<Step>({ step: "pick" });
  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];
  const shareable = canShareFiles();

  const build = async () => {
    setState({ step: "building", message: "Preparing…" });
    try {
      const file = await choice.build({
        includeMarkup,
        includeSummary,
        includeBids,
        onProgress: (message) => setState({ step: "building", message }),
      });
      setState({ step: "ready", file });
    } catch (e) {
      console.error(e);
      setState({ step: "error", message: (e as Error).message || "Couldn’t build the file." });
    }
  };

  const share = async (file: ShareFile) => {
    try {
      const result = await shareFile(file, title);
      if (result === "cancelled") return;
      setState({ step: "done", message: result === "shared" ? "Sent." : `Saved “${file.name}” to your downloads.` });
    } catch (e) {
      setState({ step: "error", message: (e as Error).message || "Couldn’t share the file." });
    }
  };

  const busy = state.step === "building";
  const size = (f: ShareFile) => formatBytes(f.data instanceof Blob ? f.data.size : f.data.byteLength);

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="export-title">Share</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>

        {state.step === "pick" || state.step === "error" ? (
          <>
            <fieldset className="choices">
              <legend className="visually-hidden">What to send</legend>
              {choices.map((c) => (
                <label key={c.id} className={c.id === choice.id ? "choice selected" : "choice"}>
                  <input type="radio" name="export-choice" checked={c.id === choice.id} onChange={() => setChoiceId(c.id)} />
                  <span>
                    <strong>{c.label}</strong>
                    {c.detail && <small>{c.detail}</small>}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="toggles">
              {choice.options.markup && <Toggle label="Include my markup" checked={includeMarkup} onChange={setIncludeMarkup} />}
              {choice.options.summary && <Toggle label="Add a summary page with notes" checked={includeSummary} onChange={setIncludeSummary} />}
              {choice.options.bids && (
                <Toggle label="Include my bid limits" hint="Off by default so you don’t send them by mistake." checked={includeBids} onChange={setIncludeBids} />
              )}
            </div>

            {state.step === "error" && <p className="error-text">{state.message}</p>}
            <button className="btn primary large block" onClick={() => void build()}>
              Create file
            </button>
          </>
        ) : state.step === "building" ? (
          <p className="sheet-progress" aria-live="polite">
            {state.message}
          </p>
        ) : state.step === "ready" ? (
          <div className="ready">
            <p>
              <strong>{state.file.name}</strong>
              <br />
              <small>{size(state.file)}</small>
            </p>
            <button className="btn primary large block" onClick={() => void share(state.file)}>
              {shareable ? "Share…" : "Save file"}
            </button>
          </div>
        ) : (
          <div className="ready">
            <p>{state.message}</p>
            <button className="btn large block" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
