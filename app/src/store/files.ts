// Where catalog PDFs are kept on the device, so they open with no internet.
//
// - iOS/Android: the app's private data folder (Capacitor Filesystem). The OS
//   doesn't clear it to free space the way it can clear browser storage.
// - Browser: IndexedDB, with a request for persistent storage.

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { getDb } from "./db";

export type PdfSource = { kind: "blob"; blob: Blob } | { kind: "url"; url: string };

export type ProgressFn = (loaded: number, total: number | undefined) => void;

export interface PdfFiles {
  /** Store a PDF the user picked from their device. */
  saveBlob(id: string, blob: Blob): Promise<void>;
  /** Download a PDF straight to the device. Returns its size in bytes. */
  download(id: string, url: string, onProgress?: ProgressFn): Promise<number>;
  open(id: string): Promise<PdfSource>;
  remove(id: string): Promise<void>;
}

export class FileMissingError extends Error {
  constructor() {
    super("This catalog's file is missing from this device. Remove it and add it again.");
  }
}

export const webFiles: PdfFiles = {
  async saveBlob(id, blob) {
    await (await getDb()).put("files", blob, id);
    void requestPersistentStorage();
  },

  async download(id, url, onProgress) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
    const total = Number(res.headers.get("Content-Length")) || undefined;
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
    await this.saveBlob(id, new Blob(chunks, { type: "application/pdf" }));
    return loaded;
  },

  async open(id) {
    const blob = await (await getDb()).get("files", id);
    if (!blob) throw new FileMissingError();
    return { kind: "blob", blob };
  },

  async remove(id) {
    await (await getDb()).delete("files", id);
  },
};

const nativeDir = Directory.Data;
const nativePath = (id: string) => `catalogs/${id}.pdf`;

export const nativeFiles: PdfFiles = {
  async saveBlob(id, blob) {
    // The native bridge passes base64 strings, so write in chunks to keep
    // memory flat for large catalogs.
    const chunkSize = 4 * 1024 * 1024;
    let offset = 0;
    do {
      const data = await blobToBase64(blob.slice(offset, offset + chunkSize));
      const opts = { path: nativePath(id), directory: nativeDir, data };
      if (offset === 0) await Filesystem.writeFile({ ...opts, recursive: true });
      else await Filesystem.appendFile(opts);
      offset += chunkSize;
    } while (offset < blob.size);
  },

  async download(id, url, onProgress) {
    const path = nativePath(id);
    const listener = await Filesystem.addListener("progress", (p) => {
      if (p.url === url) onProgress?.(p.bytes, p.contentLength || undefined);
    });
    try {
      await Filesystem.downloadFile({ url, path, directory: nativeDir, recursive: true, progress: true });
    } finally {
      await listener.remove();
    }
    const stat = await Filesystem.stat({ path, directory: nativeDir });
    return stat.size;
  },

  async open(id) {
    try {
      const { uri } = await Filesystem.getUri({ path: nativePath(id), directory: nativeDir });
      await Filesystem.stat({ path: nativePath(id), directory: nativeDir });
      return { kind: "url", url: Capacitor.convertFileSrc(uri) };
    } catch {
      throw new FileMissingError();
    }
  },

  async remove(id) {
    await Filesystem.deleteFile({ path: nativePath(id), directory: nativeDir }).catch(() => {});
  },
};

export const pdfFiles: PdfFiles = Capacitor.isNativePlatform() ? nativeFiles : webFiles;

/** Ask the browser not to clear our storage when space runs low. */
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported; storage stays "best effort".
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
