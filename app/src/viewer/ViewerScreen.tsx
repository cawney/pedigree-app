import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf } from "../pdf";
import { goToLibrary } from "../router";
import { pdfFiles } from "../store/files";
import { getItem, updateItem, type LibraryItem } from "../store/library";
import { PageStage, type StageHandle } from "./PageStage";
import { ThumbStrip } from "./ThumbStrip";

export function ViewerScreen({ id }: { id: string }) {
  const [item, setItem] = useState<LibraryItem>();
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [thumbs, setThumbs] = useState(false);
  const stage = useRef<StageHandle>(null);

  // Load the catalog from this device.
  useEffect(() => {
    let task: ReturnType<typeof openPdf> | undefined;
    let cancelled = false;
    (async () => {
      const it = await getItem(id);
      if (!it) throw new Error("This catalog isn’t in your library.");
      if (cancelled) return;
      setItem(it);
      task = openPdf(await pdfFiles.open(id));
      const d = await task.promise;
      if (cancelled) return;
      setPage(Math.min(Math.max(1, it.lastPage ?? 1), d.numPages));
      setDoc(d);
      void updateItem(id, { lastOpenedAt: new Date().toISOString(), pageCount: d.numPages });
    })().catch((e: Error) => {
      if (!cancelled) setError(e.message || "This catalog couldn’t be opened.");
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [id]);

  // Remember where the user is.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => void updateItem(id, { lastPage: page }), 400);
    return () => clearTimeout(t);
  }, [id, doc, page]);

  // Keyboard: arrows/space/page keys turn pages, Home/End jump, Esc closes.
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) stage.current?.go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) stage.current?.go(-1);
      else if (e.key === "Home") setPage(1);
      else if (e.key === "End") setPage(doc.numPages);
      else if (e.key === "Escape") goToLibrary();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc]);

  return (
    <div className={chrome ? "screen viewer" : "screen viewer immersive"}>
      <header className="topbar viewer-bar">
        <button className="btn ghost" onClick={goToLibrary}>
          ‹ Library
        </button>
        <h1 className="viewer-title">{item?.title}</h1>
        {doc && <PageJump page={page} pageCount={doc.numPages} onPage={setPage} />}
        {doc && (
          <button className="btn ghost" aria-pressed={thumbs} onClick={() => setThumbs((t) => !t)}>
            Pages
          </button>
        )}
      </header>

      {error ? (
        <div className="empty">
          <h2>Can’t open this catalog</h2>
          <p>{error}</p>
          <button className="btn" onClick={goToLibrary}>
            Back to library
          </button>
        </div>
      ) : doc ? (
        <PageStage ref={stage} doc={doc} page={page} pageCount={doc.numPages} onPage={setPage} onTapCenter={() => setChrome((c) => !c)} />
      ) : (
        <div className="stage loading">Opening…</div>
      )}

      {doc && thumbs && chrome && <ThumbStrip doc={doc} page={page} onPage={setPage} />}
    </div>
  );
}

function PageJump({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (n: number) => void }) {
  const [text, setText] = useState(String(page));
  useEffect(() => setText(String(page)), [page]);

  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (n >= 1 && n <= pageCount) onPage(n);
    else setText(String(page));
  };

  return (
    <form
      className="page-jump"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <input
        aria-label="Go to page"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
      />
      <span>of {pageCount}</span>
    </form>
  );
}
