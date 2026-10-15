// The user's catalog library on this device. Everything here is the
// `LocalStore` boundary: optional account sync will hook in at this layer.

import { getDb, type LibraryItem } from "./db";
import { pdfFiles } from "./files";

export type { LibraryItem };

const listeners = new Set<() => void>();

/** Run `fn` whenever the library changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  listeners.forEach((fn) => fn());
}

export async function listItems(): Promise<LibraryItem[]> {
  const items = await (await getDb()).getAll("items");
  // Most recently used first.
  return items.sort((a, b) => (b.lastOpenedAt ?? b.addedAt).localeCompare(a.lastOpenedAt ?? a.addedAt));
}

export async function getItem(id: string): Promise<LibraryItem | undefined> {
  return (await getDb()).get("items", id);
}

export async function putItem(item: LibraryItem): Promise<void> {
  await (await getDb()).put("items", item);
  changed();
}

export async function updateItem(id: string, patch: Partial<LibraryItem>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("items", "readwrite");
  const item = await tx.store.get(id);
  if (item) await tx.store.put({ ...item, ...patch, id });
  await tx.done;
  changed();
}

/** Remove a catalog and its PDF from this device. */
export async function removeItem(id: string): Promise<void> {
  await pdfFiles.remove(id);
  await (await getDb()).delete("items", id);
  changed();
}
