import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { clampView, fitSize, IDENTITY, MAX_ZOOM, MIN_ZOOM, zoomAround, type Size, type View } from "./geometry";
import { useDebouncedValue, useElementSize } from "./hooks";
import type { DrawInput, PagePointer } from "../markup/drawing";
import { PageCanvas } from "./PageCanvas";

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** A single tap in the middle of the page (shows/hides the toolbars). */
  onTapCenter: () => void;
  /** Markup input. Pointers it wants draw instead of turning pages. */
  draw?: DrawInput;
  /** Drawn over each page (markup). */
  renderOverlay?: (pageNum: number, pageSize: Size, cssScale: number) => ReactNode;
  ref?: React.Ref<StageHandle>;
}

export interface StageHandle {
  go: (delta: 1 | -1) => void;
}

type Point = { x: number; y: number };
type Gesture =
  | { kind: "swipe" | "pan"; start: Point; startView: View; moved: boolean; t0: number }
  | { kind: "pinch"; startDist: number; startMid: Point; startView: View }
  | { kind: "draw"; pointerId: number; pointerType: string; t0: number; last: Point };

/** A finger stroke this young becomes a pinch if a second finger lands. */
const DRAW_TO_PINCH_MS = 250;

const SLIDE_MS = 220;
const DOUBLE_TAP_MS = 280;
const TAP_ZOOM = 2.5;

/** Keep receiving a pointer's events even if it leaves the stage. Throws if the pointer is already gone, which is harmless. */
const capture = (e: React.PointerEvent) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const isZoomed = (v: View) => v.zoom > 1.01;

/**
 * The page area: one page at a time with its neighbours rendered off to the
 * sides, so swiping feels like turning pages in a book.
 *
 * Touch: swipe to turn, pinch to zoom, drag to pan when zoomed, double-tap
 * to zoom in/out, tap the left/right edge to turn, tap the middle to hide
 * the toolbars. Mouse/trackpad: click edges, ctrl+scroll or pinch to zoom,
 * scroll to turn pages or pan when zoomed.
 */
export function PageStage({ doc, page, pageCount, onPage, onTapCenter, draw, renderOverlay, ref }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useElementSize(stageRef);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>(IDENTITY);
  const [dragX, setDragX] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [zoomAnim, setZoomAnim] = useState(false);
  const renderZoom = useDebouncedValue(Math.min(MAX_ZOOM, Math.ceil(view.zoom * 2) / 2), 250);

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const animating = useRef(false);
  const lastTap = useRef<{ t: number; p: Point } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const currentBox = useRef<HTMLDivElement>(null);
  /** Current page size in page units, for turning screen positions into page positions. */
  const pageSize = useRef<Size>({ w: 1, h: 1 });

  // Handlers read the latest values through this ref, so they don't need to
  // be recreated (and re-attached) on every render.
  const latest = useRef({ view, box, stage, page, pageCount, onPage, onTapCenter, draw });
  latest.current = { view, box, stage, page, pageCount, onPage, onTapCenter, draw };

  // Size of the current page when fitted to the screen.
  useEffect(() => {
    if (!stage.w || !stage.h) return;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
      pageSize.current = { w: vp.width, h: vp.height };
      const f = fitSize({ w: vp.width, h: vp.height }, stage);
      setBox({ w: f.w, h: f.h });
    });
    // Warm up the page after next so fast page-turning stays smooth.
    if (page + 2 <= pageCount) void doc.getPage(page + 2);
    return () => {
      cancelled = true;
    };
  }, [doc, page, pageCount, stage]);

  useEffect(() => setView(IDENTITY), [page]);
  useEffect(() => setView((v) => clampView(v, box, stage)), [box, stage]);

  const go = useCallback((delta: 1 | -1) => {
    const { page, pageCount, stage, onPage } = latest.current;
    const target = page + delta;
    if (animating.current || target < 1 || target > pageCount) return;
    animating.current = true;
    setSliding(true);
    setDragX(-delta * stage.w);
    setTimeout(() => {
      setSliding(false);
      setDragX(0);
      onPage(target);
      animating.current = false;
    }, SLIDE_MS);
  }, []);

  useImperativeHandle(ref, () => ({ go }), [go]);

  const springBack = () => {
    setSliding(true);
    setDragX(0);
    setTimeout(() => setSliding(false), SLIDE_MS);
  };

  const animateZoomTo = (next: View) => {
    setZoomAnim(true);
    setView(next);
    setTimeout(() => setZoomAnim(false), 200);
  };

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const beginSingle = (p: Point) => {
    gesture.current = {
      kind: isZoomed(latest.current.view) ? "pan" : "swipe",
      start: p,
      startView: latest.current.view,
      moved: false,
      t0: performance.now(),
    };
  };

  const handleTap = (p: Point, client: { clientX: number; clientY: number }) => {
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && dist(prev.p, p) < 40) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      const { view, box, stage } = latest.current;
      animateZoomTo(zoomAround(view, isZoomed(view) ? 1 : TAP_ZOOM, p, p, box, stage));
      return;
    }
    lastTap.current = { t: now, p };
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      const { view, stage, page, onTapCenter, draw } = latest.current;
      if (draw?.tap(client.clientX, client.clientY, page)) return; // tapped a note
      if (isZoomed(view)) onTapCenter();
      else if (p.x < stage.w * 0.18) go(-1);
      else if (p.x > stage.w * 0.82) go(1);
      else onTapCenter();
    }, DOUBLE_TAP_MS);
  };

  /** Screen position → position on the current page, in page units. */
  const toPagePointer = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): PagePointer => {
    const r = currentBox.current!.getBoundingClientRect();
    const size = pageSize.current;
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    return {
      page: latest.current.page,
      point: [((e.clientX - r.left) / r.width) * size.w, ((e.clientY - r.top) / r.height) * size.h, pressure],
      clientX: e.clientX,
      clientY: e.clientY,
    };
  };

  const beginDraw = (e: React.PointerEvent) => {
    gesture.current = { kind: "draw", pointerId: e.pointerId, pointerType: e.pointerType, t0: performance.now(), last: local(e) };
    latest.current.draw!.begin(toPagePointer(e), e.pointerType);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (animating.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const g = gesture.current;
    const draw = latest.current.draw;

    if (g?.kind === "draw") {
      // A second finger right after a finger stroke started means pinch, not draw.
      const young = performance.now() - g.t0 < DRAW_TO_PINCH_MS;
      if (g.pointerType !== "touch" || e.pointerType !== "touch" || !young) return; // e.g. palm under the pencil
      draw?.cancel();
      gesture.current = null;
      pointers.current.clear();
      // Treat the drawing finger as the first finger of the pinch.
      capture(e);
      pointers.current.set(g.pointerId, g.last);
    }

    if (draw?.wants(e.pointerType) && (e.pointerType === "pen" || pointers.current.size === 0)) {
      // The pencil wins over any touch already down (a resting palm).
      if (pointers.current.size) {
        pointers.current.clear();
        springBack();
      }
      capture(e);
      beginDraw(e);
      return;
    }

    capture(e);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { kind: "pinch", startDist: dist(pts[0], pts[1]), startMid: mid(pts[0], pts[1]), startView: latest.current.view };
      setDragX(0);
    } else if (pts.length === 1) {
      beginSingle(pts[0]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind === "draw") {
      if (e.pointerId !== g.pointerId) return;
      g.last = local(e);
      // Coalesced events give the full-rate Apple Pencil samples between frames.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      latest.current.draw?.move((events.length ? events : [e.nativeEvent]).map(toPagePointer));
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (!g) return;
    const { box, stage, page, pageCount } = latest.current;

    if (g.kind === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2 || !g.startDist) return;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.startView.zoom * dist(pts[0], pts[1])) / g.startDist));
      setView(zoomAround(g.startView, zoom, g.startMid, mid(pts[0], pts[1]), box, stage));
      return;
    }

    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "pan") {
      setView(clampView({ zoom: g.startView.zoom, x: g.startView.x + dx, y: g.startView.y + dy }, box, stage));
    } else {
      const pastEnd = (dx > 0 && page === 1) || (dx < 0 && page === pageCount);
      setDragX(pastEnd ? dx * 0.25 : dx); // resist at the first/last page
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind === "draw") {
      if (e.pointerId !== g.pointerId) return;
      gesture.current = null;
      if (e.type === "pointercancel") latest.current.draw?.cancel();
      else latest.current.draw?.end();
      return;
    }

    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!g || !p) return;

    if (g.kind === "pinch") {
      // Lifting one finger of a pinch continues as a pan with the other.
      const rest = [...pointers.current.values()];
      if (rest.length === 1) beginSingle(rest[0]);
      else gesture.current = null;
      return;
    }
    gesture.current = null;

    if (g.kind === "swipe" && e.type === "pointercancel") return springBack();
    if (!g.moved) {
      if (performance.now() - g.t0 < 350) handleTap(p, e);
      return;
    }
    if (g.kind === "swipe") {
      const dx = p.x - g.start.x;
      const fast = performance.now() - g.t0 < 250 && Math.abs(dx) > 30;
      const far = Math.abs(dx) > Math.min(90, latest.current.stage.w * 0.15);
      const { page, pageCount } = latest.current;
      if ((fast || far) && dx < 0 && page < pageCount) go(1);
      else if ((fast || far) && dx > 0 && page > 1) go(-1);
      else springBack();
    }
  };

  // Trackpad/mouse wheel. Attached natively so it can preventDefault.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let acc = 0;
    let lastTurn = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view, box, stage } = latest.current;
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * Math.exp(-e.deltaY * 0.01)));
        setView(zoomAround(view, zoom, p, p, box, stage));
      } else if (isZoomed(view)) {
        setView(clampView({ zoom: view.zoom, x: view.x - e.deltaX, y: view.y - e.deltaY }, box, stage));
      } else {
        acc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        const now = performance.now();
        if (Math.abs(acc) > 100 && now - lastTurn > 350) {
          go(acc > 0 ? 1 : -1);
          acc = 0;
          lastTurn = now;
        }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go]);

  useEffect(() => () => clearTimeout(tapTimer.current), []);

  return (
    <div
      ref={stageRef}
      className="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {stage.w > 0 && (
        <div
          className="track"
          style={{
            width: stage.w * 3,
            transform: `translate3d(${-stage.w + dragX}px, 0, 0)`,
            transition: sliding ? `transform ${SLIDE_MS}ms ease-out` : "none",
          }}
        >
          {[page - 1, page, page + 1].map((n) => (
            <div className="slot" key={n} style={{ width: stage.w }}>
              {n >= 1 && n <= pageCount && (
                <div
                  className="page-box"
                  ref={n === page ? currentBox : undefined}
                  style={
                    n === page
                      ? {
                          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                          transition: zoomAnim ? "transform 200ms ease-out" : "none",
                        }
                      : undefined
                  }
                >
                  <PageCanvas
                    doc={doc}
                    pageNum={n}
                    bounds={stage}
                    renderZoom={n === page ? renderZoom : 1}
                    overlay={renderOverlay && ((size, cssScale) => renderOverlay(n, size, cssScale))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
