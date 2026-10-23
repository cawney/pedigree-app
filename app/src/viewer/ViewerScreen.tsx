import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useDrawing } from "../markup/drawing";
import { MarkupLayer } from "../markup/MarkupLayer";
import { MarkupToolbar } from "../markup/MarkupToolbar";
import { NoteSheet } from "../markup/NoteSheet";
import { NOTE_WIDTH, type Note } from "../markup/types";
import { useMarkup, useToolSettings } from "../markup/useMarkup";
import { openPdf } from "../pdf";
import { readPref, writePref } from "../prefs";
import { buildBookPdf, buildPagesPdf } from "../export/buildPdf";
import { ExportSheet, type ExportChoice } from "../export/ExportSheet";
import { fileName } from "../export/share";
import { allTags } from "../shortlist/filters";
import { HipPanel } from "../shortlist/HipPanel";
import { addEntry, listEntries, useEntries } from "../shortlist/store";
import { hipLabel, PRESET_TAGS } from "../shortlist/types";
import { newId } from "../store/db";
import { goToLibrary } from "../router";
import { pdfFiles } from "../store/files";
import { getItem, updateItem, type LibraryItem } from "../store/library";
import { PageStage, type StageHandle } from "./PageStage";
import { ThumbStrip } from "./ThumbStrip";
import type { Size } from "./geometry";

const FINGER_DRAWS_KEY = "pedigree.fingerDraws";
const PENCIL_SEEN_KEY = "pedigree.pencilSeen";

/** The note being written or edited. */
type NoteEdit = { page: number; note?: Note; x: number; y: number };

export function ViewerScreen({ id, startPage }: { id: string; startPage?: number }) {
  const [item, setItem] = useState<LibraryItem>();
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [thumbs, setThumbs] = useState(false);
  const stage = useRef<StageHandle>(null);

  // Short list
  const allEntries = useEntries();
  const listed = (allEntries ?? []).filter((e) => e.itemId === id).sort((a, b) => a.page - b.page);
  const entry = listed.find((e) => e.page === page);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Markup
  const [marking, setMarking] = useState(false);
  const [tools, setTools] = useToolSettings();
  const [fingerDraws, setFingerDrawsState] = useState(() => readPref(FINGER_DRAWS_KEY, true));
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null);
  const markup = useMarkup(id);
  const setFingerDraws = useCallback((on: boolean) => {
    setFingerDrawsState(on);
    writePref(FINGER_DRAWS_KEY, on);
  }, []);
  const draw = useDrawing(markup, tools, {
    active: marking,
    fingerDraws,
    // The first time a pencil is used, fingers switch to turning pages and
    // zooming, so a resting palm never leaves marks. The toolbar can switch back.
    onPencil: () => {
      if (readPref(PENCIL_SEEN_KEY, false)) return;
      writePref(PENCIL_SEEN_KEY, true);
      setFingerDraws(false);
    },
    onNewNote: (page, x, y) => {
      void doc?.getPage(page).then((p) => {
        const w = p.getViewport({ scale: 1 }).width;
        setNoteEdit({ page, x: Math.max(0, Math.min(x, w - NOTE_WIDTH)), y });
      });
    },
    onEditNote: (page, note) => setNoteEdit({ page, note, x: note.x, y: note.y }),
  });

  useEffect(() => markup.ensure([page - 1, page, page + 1]), [markup, page]);

  const renderOverlay = useCallback(
    (n: number, size: Size, cssScale: number) => (
      <MarkupLayer page={n} annotations={markup.get(n)} size={size} cssScale={cssScale} live={draw.live} />
    ),
    [markup, draw],
  );

  const saveNote = (text: string, color: string) => {
    if (!noteEdit) return;
    const { page: p, note } = noteEdit;
    const anns = markup.get(p);
    if (note) markup.commit(p, anns.map((a) => (a.id === note.id ? { ...note, text, color } : a)));
    else markup.commit(p, [...anns, { kind: "note", id: newId(), x: noteEdit.x, y: noteEdit.y, text, color }]);
    setNoteEdit(null);
  };

  const deleteNote = () => {
    if (noteEdit?.note) markup.commit(noteEdit.page, markup.get(noteEdit.page).filter((a) => a.id !== noteEdit.note!.id));
    setNoteEdit(null);
  };

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
      setPage(Math.min(Math.max(1, startPage ?? it.lastPage ?? 1), d.numPages));
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

  const pageRef = useRef(page);
  pageRef.current = page;

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) markup.redo(pageRef.current);
        else markup.undo(pageRef.current);
      } else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) stage.current?.go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) stage.current?.go(-1);
      else if (e.key === "Home") setPage(1);
      else if (e.key === "End") setPage(doc.numPages);
      else if (e.key === "Escape") goToLibrary();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, markup]);

  return (
    <div className={chrome || marking ? "screen viewer" : "screen viewer immersive"}>
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
        {doc && (
          <button
            className={entry ? "btn ghost starred" : "btn ghost"}
            aria-pressed={!!entry}
            title={entry ? "On your short list" : "Add to short list"}
            onClick={() => {
              if (!entry) void addEntry(id, page);
              setPanelOpen(entry ? (o) => !o : true);
            }}
          >
            {entry ? "★" : "☆"} <span className="label">{entry ? hipLabel(entry) : "Short list"}</span>
          </button>
        )}
        {doc && (
          <button className="btn ghost" onClick={() => setSharing(true)}>
            ⇪ <span className="label">Share</span>
          </button>
        )}
        {doc &&
          (marking ? (
            <button className="btn primary" onClick={() => setMarking(false)}>
              Done
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setMarking(true)}>
              ✎ <span className="label">Mark up</span>
            </button>
          ))}
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
        <div className="viewer-main">
          <PageStage
            ref={stage}
            doc={doc}
            page={page}
            pageCount={doc.numPages}
            onPage={setPage}
            onTapCenter={() => !marking && setChrome((c) => !c)}
            draw={draw}
            renderOverlay={renderOverlay}
          />
          {panelOpen && entry && (
            <HipPanel
              key={entry.key}
              entry={entry}
              knownTags={allTags(allEntries ?? [], PRESET_TAGS)}
              prev={listed.filter((e) => e.page < page).at(-1)?.page}
              next={listed.find((e) => e.page > page)?.page}
              onGo={setPage}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="stage loading">Opening…</div>
      )}

      {doc && marking && (
        <MarkupToolbar
          tools={tools}
          onTools={setTools}
          fingerDraws={fingerDraws}
          onFingerDraws={setFingerDraws}
          canUndo={markup.canUndo(page)}
          canRedo={markup.canRedo(page)}
          canClear={markup.get(page).length > 0}
          onUndo={() => markup.undo(page)}
          onRedo={() => markup.redo(page)}
          onClear={() => {
            if (confirm(`Clear all markup on page ${page}? You can undo this.`)) markup.commit(page, []);
          }}
          onPrev={() => stage.current?.go(-1)}
          onNext={() => stage.current?.go(1)}
        />
      )}

      {doc && thumbs && (chrome || marking) && <ThumbStrip doc={doc} page={page} onPage={setPage} marked={markup.marked} />}

      {sharing && doc && item && (
        <ExportSheet title={item.title} choices={exportChoices(item, page, listed, doc.numPages)} onClose={() => setSharing(false)} />
      )}

      {noteEdit && (
        <NoteSheet
          isNew={!noteEdit.note}
          initialText={noteEdit.note?.text ?? ""}
          initialColor={noteEdit.note?.color ?? tools.noteColor}
          onSave={saveNote}
          onDelete={deleteNote}
          onClose={() => setNoteEdit(null)}
        />
      )}
    </div>
  );
}

/** What can be shared from the viewer. */
function exportChoices(item: LibraryItem, page: number, listed: { page: number; hip?: string }[], pageCount: number): ExportChoice[] {
  const entry = listed.find((e) => e.page === page);
  const choices: ExportChoice[] = [
    {
      id: "page",
      label: "This page",
      detail: entry ? hipLabel(entry) : `Page ${page}`,
      options: { markup: true },
      build: async (o) => ({
        name: fileName(`${item.title} - ${entry ? hipLabel(entry) : `Page ${page}`}`, "pdf"),
        type: "application/pdf",
        data: await buildPagesPdf([{ itemId: item.id, page }], { includeMarkup: o.includeMarkup, onProgress: o.onProgress }),
      }),
    },
  ];
  if (listed.length) {
    choices.push({
      id: "list",
      label: "My short list from this catalog",
      detail: `${listed.length} ${listed.length === 1 ? "page" : "pages"}`,
      options: { markup: true, summary: true, bids: true },
      build: async (o) => {
        const mine = (await listEntries()).filter((e) => e.itemId === item.id).sort((a, b) => a.page - b.page);
        return {
          name: fileName(`${item.title} - Short list`, "pdf"),
          type: "application/pdf",
          data: await buildPagesPdf(
            mine.map((e) => ({ itemId: item.id, page: e.page })),
            {
              includeMarkup: o.includeMarkup,
              onProgress: o.onProgress,
              summary: o.includeSummary
                ? { title: `${item.title} - Short list`, entries: mine, catalogTitles: new Map([[item.id, item.title]]), includeBids: o.includeBids }
                : undefined,
            },
          ),
        };
      },
    });
  }
  choices.push({
    id: "book",
    label: "Whole catalog",
    detail: `${pageCount} pages`,
    options: { markup: true },
    build: async (o) => ({
      name: fileName(item.title, "pdf"),
      type: "application/pdf",
      data: await buildBookPdf(item.id, { includeMarkup: o.includeMarkup, onProgress: o.onProgress }),
    }),
  });
  return choices;
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
