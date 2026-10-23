import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readPref, writePref } from "../prefs";
import { loadPage, markedPages, savePage } from "./store";
import { HIGHLIGHTER_COLORS, NOTE_COLORS, PEN_COLORS, type Annotation, type Tool } from "./types";

const EMPTY: Annotation[] = [];

export interface Markup {
  /** Annotations on a page ([] until loaded). */
  get(page: number): Annotation[];
  /** Load pages so they can be shown. */
  ensure(pages: number[]): void;
  /** Replace a page's annotations, saving and recording undo. */
  commit(page: number, next: Annotation[]): void;
  undo(page: number): void;
  redo(page: number): void;
  canUndo(page: number): boolean;
  canRedo(page: number): boolean;
  /** Pages that have any markup. */
  marked: Set<number>;
}

/** Markup for one catalog: loaded page by page, saved on every change. */
export function useMarkup(itemId: string): Markup {
  const [pages, setPages] = useState(() => new Map<number, Annotation[]>());
  const [marked, setMarked] = useState(() => new Set<number>());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const loading = useRef(new Set<number>());
  // Undo history per page, as snapshots (annotation arrays are never mutated).
  const history = useRef(new Map<number, { undo: Annotation[][]; redo: Annotation[][] }>());
  const [, bump] = useState(0);

  useEffect(() => {
    void markedPages(itemId).then(setMarked);
  }, [itemId]);

  const ensure = useCallback(
    (nums: number[]) => {
      for (const n of nums) {
        if (n < 1 || pagesRef.current.has(n) || loading.current.has(n)) continue;
        loading.current.add(n);
        void loadPage(itemId, n).then((anns) => {
          loading.current.delete(n);
          setPages((m) => (m.has(n) ? m : new Map(m).set(n, anns)));
        });
      }
    },
    [itemId],
  );

  const write = useCallback(
    (page: number, next: Annotation[]) => {
      pagesRef.current = new Map(pagesRef.current).set(page, next);
      setPages(pagesRef.current);
      setMarked((s) => {
        if (next.length > 0 === s.has(page)) return s;
        const copy = new Set(s);
        if (next.length) copy.add(page);
        else copy.delete(page);
        return copy;
      });
      void savePage(itemId, page, next);
    },
    [itemId],
  );

  const stack = (page: number) => {
    let h = history.current.get(page);
    if (!h) history.current.set(page, (h = { undo: [], redo: [] }));
    return h;
  };

  const get = useCallback((page: number) => pages.get(page) ?? EMPTY, [pages]);

  const commit = useCallback(
    (page: number, next: Annotation[]) => {
      const h = stack(page);
      h.undo.push(pagesRef.current.get(page) ?? EMPTY);
      if (h.undo.length > 100) h.undo.shift();
      h.redo = [];
      write(page, next);
    },
    [write],
  );

  const undo = useCallback(
    (page: number) => {
      const h = stack(page);
      const prev = h.undo.pop();
      if (!prev) return;
      h.redo.push(pagesRef.current.get(page) ?? EMPTY);
      write(page, prev);
      bump((n) => n + 1);
    },
    [write],
  );

  const redo = useCallback(
    (page: number) => {
      const h = stack(page);
      const next = h.redo.pop();
      if (!next) return;
      h.undo.push(pagesRef.current.get(page) ?? EMPTY);
      write(page, next);
      bump((n) => n + 1);
    },
    [write],
  );

  return useMemo(
    () => ({
      get,
      ensure,
      commit,
      undo,
      redo,
      canUndo: (page: number) => (history.current.get(page)?.undo.length ?? 0) > 0,
      canRedo: (page: number) => (history.current.get(page)?.redo.length ?? 0) > 0,
      marked,
    }),
    [get, ensure, commit, undo, redo, marked],
  );
}

export interface ToolSettings {
  tool: Tool;
  penColor: string;
  penWidth: number; // index into PEN_WIDTHS
  highlighterColor: string;
  highlighterWidth: number; // index into HIGHLIGHTER_WIDTHS
  noteColor: string;
}

const DEFAULT_TOOLS: ToolSettings = {
  tool: "pen",
  penColor: PEN_COLORS[1],
  penWidth: 1,
  highlighterColor: HIGHLIGHTER_COLORS[0],
  highlighterWidth: 1,
  noteColor: NOTE_COLORS[0],
};

const TOOLS_KEY = "pedigree.tools";

/** The selected tool, colors and sizes, remembered between sessions. */
export function useToolSettings(): [ToolSettings, (patch: Partial<ToolSettings>) => void] {
  const [settings, setSettings] = useState<ToolSettings>(() => ({ ...DEFAULT_TOOLS, ...readPref(TOOLS_KEY, {}) }));
  const update = useCallback((patch: Partial<ToolSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writePref(TOOLS_KEY, next);
      return next;
    });
  }, []);
  return [settings, update];
}
