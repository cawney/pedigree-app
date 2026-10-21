// Turns pointer input on a page into markup.

import { useMemo, useRef } from "react";
import { newId } from "../store/db";
import { addPoint, hitsStroke } from "./ink";
import type { Markup, ToolSettings } from "./useMarkup";
import { HIGHLIGHTER_WIDTHS, PEN_WIDTHS, type InkPoint, type Note, type Stroke } from "./types";

/**
 * The stroke being drawn right now, kept outside React state so only the
 * markup layer of the current page re-renders while drawing.
 */
export class LiveInk {
  page = 0;
  stroke: Stroke | null = null;
  /** Annotations being erased in the current eraser drag. */
  hidden = new Set<string>();
  version = 0;
  private listeners = new Set<() => void>();
  private frame = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  /** Notify at most once per animation frame. */
  changed() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.version++;
      this.listeners.forEach((fn) => fn());
    });
  }

  clear() {
    this.stroke = null;
    this.hidden = new Set();
    this.changed();
  }
}

/** Where a pointer is, in page units and on screen. */
export interface PagePointer {
  page: number;
  point: InkPoint;
  clientX: number;
  clientY: number;
}

export interface DrawInput {
  live: LiveInk;
  /** Should this kind of pointer draw (rather than turn pages / pan)? */
  wants(pointerType: string): boolean;
  begin(at: PagePointer, pointerType: string): void;
  move(points: PagePointer[]): void;
  end(): void;
  cancel(): void;
  /** A tap outside drawing (e.g. while reading). Opens a note if one was tapped. */
  tap(clientX: number, clientY: number, page: number): boolean;
}

interface Options {
  active: boolean;
  fingerDraws: boolean;
  /** Called the first time an Apple Pencil (or other stylus) touches the page. */
  onPencil: () => void;
  onNewNote: (page: number, x: number, y: number) => void;
  onEditNote: (page: number, note: Note) => void;
}

/** Eraser reach in page units. */
const ERASER_RADIUS = 5;

/** The note element under a screen point, if any. */
function noteIdAt(clientX: number, clientY: number): string | undefined {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = (el as HTMLElement).dataset?.noteId;
    if (id) return id;
  }
  return undefined;
}

export function useDrawing(markup: Markup, tools: ToolSettings, opts: Options): DrawInput {
  // Handlers read current values through refs so the returned object stays
  // stable for the life of the viewer.
  const state = useRef({ markup, tools, opts });
  state.current = { markup, tools, opts };

  return useMemo(() => {
    const live = new LiveInk();
    let erasing: { page: number } | null = null;
    let noteTap: PagePointer | null = null;

    const findNote = (page: number, clientX: number, clientY: number) => {
      const id = noteIdAt(clientX, clientY);
      return id ? (state.current.markup.get(page).find((a) => a.id === id && a.kind === "note") as Note | undefined) : undefined;
    };

    const eraseAt = (at: PagePointer) => {
      const anns = state.current.markup.get(at.page);
      const noteId = noteIdAt(at.clientX, at.clientY);
      for (const a of anns) {
        if (live.hidden.has(a.id)) continue;
        const hit = a.kind === "note" ? a.id === noteId : hitsStroke(a, at.point[0], at.point[1], ERASER_RADIUS);
        if (hit) {
          live.hidden.add(a.id);
          live.changed();
        }
      }
    };

    const input: DrawInput = {
      live,

      wants(pointerType) {
        const { opts } = state.current;
        if (!opts.active) return false;
        return pointerType === "pen" || pointerType === "mouse" || opts.fingerDraws;
      },

      begin(at, pointerType) {
        const { tools, opts } = state.current;
        if (pointerType === "pen") opts.onPencil();
        live.page = at.page;
        if (tools.tool === "eraser") {
          erasing = { page: at.page };
          live.hidden = new Set();
          eraseAt(at);
        } else if (tools.tool === "note") {
          noteTap = at;
        } else {
          const highlighter = tools.tool === "highlighter";
          live.stroke = {
            kind: highlighter ? "highlighter" : "pen",
            id: newId(),
            color: highlighter ? tools.highlighterColor : tools.penColor,
            width: highlighter ? HIGHLIGHTER_WIDTHS[tools.highlighterWidth] : PEN_WIDTHS[tools.penWidth],
            points: [],
            pressure: pointerType === "pen",
          };
          addPoint(live.stroke.points, at.point);
          live.changed();
        }
      },

      move(points) {
        if (live.stroke) {
          let added = false;
          for (const p of points) added = addPoint(live.stroke.points, p.point) || added;
          if (added) live.changed();
        } else if (erasing) {
          points.forEach(eraseAt);
        }
      },

      end() {
        const { markup, opts } = state.current;
        if (live.stroke) {
          const stroke = live.stroke;
          markup.commit(live.page, [...markup.get(live.page), stroke]);
        } else if (erasing) {
          const hidden = live.hidden;
          if (hidden.size) markup.commit(erasing.page, markup.get(erasing.page).filter((a) => !hidden.has(a.id)));
          erasing = null;
        } else if (noteTap) {
          const at = noteTap;
          noteTap = null;
          const existing = findNote(at.page, at.clientX, at.clientY);
          if (existing) opts.onEditNote(at.page, existing);
          else opts.onNewNote(at.page, at.point[0], at.point[1]);
        }
        live.clear();
      },

      cancel() {
        erasing = null;
        noteTap = null;
        live.clear();
      },

      tap(clientX, clientY, page) {
        const note = findNote(page, clientX, clientY);
        if (!note) return false;
        state.current.opts.onEditNote(page, note);
        return true;
      },
    };
    return input;
  }, []);
}
