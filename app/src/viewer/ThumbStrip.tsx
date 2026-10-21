import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { capScale } from "./geometry";

const THUMB_HEIGHT = 96;

type Observe = (el: Element, onChange: (visible: boolean) => void) => () => void;

/** Scrollable strip of page thumbnails. Only pages near the visible part of
 * the strip are drawn, so catalogs with hundreds of pages stay light. */
export function ThumbStrip({ doc, page, onPage, marked }: { doc: PDFDocumentProxy; page: number; onPage: (n: number) => void; marked?: Set<number> }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [observe, setObserve] = useState<Observe>();

  useEffect(() => {
    const callbacks = new Map<Element, (visible: boolean) => void>();
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => callbacks.get(e.target)?.(e.isIntersecting)),
      { root: stripRef.current, rootMargin: "0px 600px" },
    );
    setObserve(() => (el: Element, cb: (visible: boolean) => void) => {
      callbacks.set(el, cb);
      io.observe(el);
      return () => {
        callbacks.delete(el);
        io.unobserve(el);
      };
    });
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-page="${page}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [page]);

  return (
    <nav className="thumbs" ref={stripRef} aria-label="Pages">
      {observe &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <Thumb key={i + 1} doc={doc} n={i + 1} active={i + 1 === page} marked={!!marked?.has(i + 1)} observe={observe} onClick={() => onPage(i + 1)} />
        ))}
    </nav>
  );
}

function Thumb({ doc, n, active, marked, observe, onClick }: { doc: PDFDocumentProxy; n: number; active: boolean; marked: boolean; observe: Observe; onClick: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(THUMB_HEIGHT * 0.77);

  useEffect(() => observe(buttonRef.current!, setVisible), [observe]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!visible) {
      canvas.width = canvas.height = 0; // free memory for thumbs scrolled far away
      return;
    }
    let cancelled = false;
    let task: RenderTask | undefined;
    (async () => {
      const p = await doc.getPage(n);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const scale = capScale({ w: base.width, h: base.height }, (THUMB_HEIGHT / base.height) * (window.devicePixelRatio || 1));
      const vp = p.getViewport({ scale });
      setWidth((THUMB_HEIGHT * base.width) / base.height);
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      task = p.render({ canvas, viewport: vp });
      await task.promise;
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, visible]);

  return (
    <button ref={buttonRef} className={active ? "thumb active" : "thumb"} data-page={n} onClick={onClick} aria-current={active ? "page" : undefined}>
      <canvas ref={canvasRef} style={{ width, height: THUMB_HEIGHT }} />
      <span>
        {n}
        {marked && <span className="thumb-marked" title="Has markup" />}
      </span>
    </button>
  );
}
