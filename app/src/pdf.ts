// PDF.js setup and loading.

import {
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfSource } from "./store/files";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Fonts, character maps etc. copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs. */
const assets = new URL("pdfjs/", document.baseURI).href;

/**
 * Feeds PDF.js only the parts of a stored file it asks for, so a 300 MB
 * catalog opens instantly without being read into memory.
 */
class BlobRangeTransport extends PDFDataRangeTransport {
  constructor(private readonly blob: Blob) {
    super(blob.size, null);
  }

  override requestDataRange(begin: number, end: number) {
    this.blob
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => this.onDataRange(begin, new Uint8Array(buf)))
      .catch((e) => console.error("couldn't read PDF range", e));
  }
}

export function openPdf(source: PdfSource): PDFDocumentLoadingTask {
  const common = {
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  };
  if (source.kind === "blob") {
    return getDocument({
      ...common,
      range: new BlobRangeTransport(source.blob),
      disableAutoFetch: true,
      disableStream: true,
    });
  }
  return getDocument({ ...common, url: source.url });
}

/** Page count and embedded title, for PDFs the user adds from their device. */
export async function readPdfInfo(blob: Blob): Promise<{ pageCount: number; title?: string }> {
  const task = openPdf({ kind: "blob", blob });
  try {
    const doc = await task.promise;
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info as { Title?: unknown } | undefined;
    const title = typeof info?.Title === "string" ? info.Title.trim() : "";
    return { pageCount: doc.numPages, title: title || undefined };
  } finally {
    await task.destroy();
  }
}
