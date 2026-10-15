import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { capScale, fitSize, type Size } from "./geometry";

interface Props {
  doc: PDFDocumentProxy;
  pageNum: number;
  /** Area the page is fitted into. */
  bounds: Size;
  /** Extra resolution for zoomed-in viewing. */
  renderZoom?: number;
}

/** One PDF page drawn to fit `bounds`, sharp on high-density screens. */
export function PageCanvas({ doc, pageNum, bounds, renderZoom = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<Size>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!bounds.w || !bounds.h) return;
    let cancelled = false;
    let task: RenderTask | undefined;

    (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const pageSize = { w: base.width, h: base.height };
      const fitted = fitSize(pageSize, bounds);
      setFit({ w: fitted.w, h: fitted.h });

      const scale = capScale(pageSize, fitted.scale * (window.devicePixelRatio || 1) * renderZoom);
      const viewport = page.getViewport({ scale });
      // Draw offscreen, then swap in, so re-rendering at a new zoom never
      // flashes a blank page.
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = page.render({ canvas: off, viewport });
      await task.promise;
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")?.drawImage(off, 0, 0);
      off.width = off.height = 0; // release memory now (matters on iPad)
      setFailed(false);
    })().catch((e: Error) => {
      if (!cancelled && e?.name !== "RenderingCancelledException") {
        console.error(`page ${pageNum} failed to render`, e);
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, bounds.w, bounds.h, renderZoom]);

  return (
    <div className="page-sheet" style={fit ? { width: fit.w, height: fit.h } : undefined}>
      <canvas ref={canvasRef} className="page-canvas" />
      {failed && <span className="page-error">This page couldn’t be displayed.</span>}
    </div>
  );
}
