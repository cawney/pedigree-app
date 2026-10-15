// The three ways a catalog gets into the library.

import { catalogFileUrl, fetchFromUrl, type ServerCatalog } from "../api";
import { readPdfInfo } from "../pdf";
import { newId } from "../store/db";
import { pdfFiles, type ProgressFn } from "../store/files";
import { listItems, putItem, type LibraryItem } from "../store/library";

/** Download a server catalog to this device (or return it if already here). */
export async function addFromServer(cat: ServerCatalog, onProgress?: ProgressFn): Promise<LibraryItem> {
  const existing = (await listItems()).find((i) => i.serverId === cat.id);
  if (existing) return existing;

  const id = newId();
  let sizeBytes: number;
  try {
    sizeBytes = await pdfFiles.download(id, catalogFileUrl(cat.id), onProgress);
  } catch (e) {
    await pdfFiles.remove(id); // don't leave a half-downloaded file behind
    throw e;
  }
  const item: LibraryItem = {
    id,
    title: cat.title,
    saleCompany: cat.sale_company ?? undefined,
    saleDate: cat.sale_date ?? undefined,
    pageCount: cat.page_count ?? undefined,
    sizeBytes,
    serverId: cat.id,
    sourceUrl: cat.source_url ?? undefined,
    addedAt: new Date().toISOString(),
  };
  await putItem(item);
  return item;
}

/** Have the server fetch a pasted link, then download it to this device. */
export async function addFromUrl(
  url: string,
  onStage: (stage: "fetching" | "saving") => void,
  onProgress?: ProgressFn,
): Promise<LibraryItem> {
  onStage("fetching");
  const cat = await fetchFromUrl(normalizeUrl(url));
  onStage("saving");
  return addFromServer(cat, onProgress);
}

/** Add a PDF from the device. It stays on this device only. */
export async function addFromFile(file: File): Promise<LibraryItem> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!new TextDecoder("latin1").decode(head).includes("%PDF-")) {
    throw new Error("That file isn't a PDF.");
  }
  const info = await readPdfInfo(file);
  const id = newId();
  await pdfFiles.saveBlob(id, file);
  const item: LibraryItem = {
    id,
    title: info.title ?? titleFromFileName(file.name),
    pageCount: info.pageCount,
    sizeBytes: file.size,
    addedAt: new Date().toISOString(),
  };
  await putItem(item);
  return item;
}

/** Accept links pasted without "https://". */
export function normalizeUrl(input: string): string {
  const url = input.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

export function titleFromFileName(name: string): string {
  const title = name
    .replace(/\.pdf$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || "Untitled catalog";
}
