import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { clampView, fitSize, IDENTITY, MAX_ZOOM, MIN_ZOOM, zoomAround, type Size, type View } from "./geometry";
import { useDebouncedValue, useElementSize } from "./hooks";
import { PageCanvas } from "./PageCanvas";

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** A single tap in the middle of the page (shows/hides the toolbars). */
  onTapCenter: () => void;
  ref?: React.Ref<StageHandle>;
}

export interface StageHandle {
  go: (delta: 1 | -1) => void;
}

type Point = { x: number; y: number };
type Gesture =
  | { kind: "swipe" | "pan"; start: Point; startView: View; moved: boolean; t0: number }
  | { kind: "pinch"; startDist: number; startMid: Point; startView: View };

const SLIDE_MS = 220;
const DOUBLE_TAP_MS = 280;
const TAP_ZOOM = 2.5;

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
export function PageStage({ doc, page, pageCount, onPage, onTapCenter, ref }: Props) {
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

  // Handlers read the latest values through this ref, so they don't need to
  // be recreated (and re-attached) on every render.
  const latest = useRef({ view, box, stage, page, pageCount, onPage, onTapCenter });
  latest.current = { view, box, stage, page, pageCount, onPage, onTapCenter };

  // Size of the current page when fitted to the screen.
  useEffect(() => {
    if (!stage.w || !stage.h) return;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
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

  const handleTap = (p: Point) => {
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
      const { view, stage, onTapCenter } = latest.current;
      if (isZoomed(view)) onTapCenter();
      else if (p.x < stage.w * 0.18) go(-1);
      else if (p.x > stage.w * 0.82) go(1);
      else onTapCenter();
    }, DOUBLE_TAP_MS);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (animating.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
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
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
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
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
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
      if (performance.now() - g.t0 < 350) handleTap(p);
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
                  style={
                    n === page
                      ? {
                          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                          transition: zoomAnim ? "transform 200ms ease-out" : "none",
                        }
                      : undefined
                  }
                >
                  <PageCanvas doc={doc} pageNum={n} bounds={stage} renderZoom={n === page ? renderZoom : 1} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
