import { useRef, useState } from "react";
import { percent } from "../format";
import type { LibraryItem } from "../store/library";
import { addFromFile, addFromUrl } from "./addCatalog";

type Status =
  | { state: "idle" }
  | { state: "fetching" }
  | { state: "saving"; loaded: number; total?: number }
  | { state: "error"; message: string };

export function AddCatalogSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (item: LibraryItem) => void }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = status.state === "fetching" || status.state === "saving";

  const finish = (item: LibraryItem) => {
    onClose();
    onAdded(item);
  };
  const fail = (e: unknown) => setStatus({ state: "error", message: (e as Error).message });

  const submitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    try {
      const item = await addFromUrl(
        url,
        (stage) => setStatus(stage === "fetching" ? { state: "fetching" } : { state: "saving", loaded: 0 }),
        (loaded, total) => setStatus({ state: "saving", loaded, total }),
      );
      finish(item);
    } catch (err) {
      fail(err);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setStatus({ state: "saving", loaded: 0 });
    try {
      finish(await addFromFile(file));
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="add-title">Add a catalog</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>

        {/* noValidate: allow links pasted without "https://" (we add it). */}
        <form onSubmit={submitUrl} noValidate>
          <label htmlFor="add-url">Paste a link to a catalog PDF</label>
          <div className="url-row">
            <input
              id="add-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoFocus
              placeholder="https://…/catalog.pdf"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
            <button className="btn primary" type="submit" disabled={busy || !url.trim()}>
              Download
            </button>
          </div>
        </form>

        <div className="or">or</div>

        <button className="btn large block" onClick={() => fileInput.current?.click()} disabled={busy}>
          Choose a PDF on this device
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />

        <div className="sheet-status" aria-live="polite">
          {status.state === "fetching" && <p>Getting the catalog from the web…</p>}
          {status.state === "saving" && <p>Saving to this device… {status.total ? percent(status.loaded, status.total) : ""}</p>}
          {status.state === "error" && <p className="error-text">{status.message}</p>}
        </div>
      </div>
    </div>
  );
}
