// Saving markup on this device.

import { getDb } from "../store/db";
import type { Annotation, PageMarkup } from "./types";

const key = (itemId: string, page: number) => `${itemId}:${page}`;

export async function loadPage(itemId: string, page: number): Promise<Annotation[]> {
  return (await (await getDb()).get("markup", key(itemId, page)))?.annotations ?? [];
}

export async function savePage(itemId: string, page: number, annotations: Annotation[]): Promise<void> {
  const db = await getDb();
  if (annotations.length === 0) {
    await db.delete("markup", key(itemId, page));
    return;
  }
  const record: PageMarkup = { key: key(itemId, page), itemId, page, annotations, updatedAt: new Date().toISOString() };
  await db.put("markup", record);
}

/** Page numbers that have any markup. */
export async function markedPages(itemId: string): Promise<Set<number>> {
  const records = await (await getDb()).getAllFromIndex("markup", "byItem", itemId);
  return new Set(records.map((r) => r.page));
}

export async function deleteAllForItem(itemId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("markup", "readwrite");
  for (const k of await tx.store.index("byItem").getAllKeys(itemId)) await tx.store.delete(k);
  await tx.done;
}
