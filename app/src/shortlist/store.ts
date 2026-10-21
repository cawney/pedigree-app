// Saving the short list on this device.

import { useEffect, useState } from "react";
import { getDb } from "../store/db";
import { entryKey, type HipEntry } from "./types";

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function listEntries(): Promise<HipEntry[]> {
  return (await getDb()).getAll("hips");
}

export async function getEntry(itemId: string, page: number): Promise<HipEntry | undefined> {
  return (await getDb()).get("hips", entryKey(itemId, page));
}

/** Add a page to the short list (no-op if it's already there). */
export async function addEntry(itemId: string, page: number): Promise<HipEntry> {
  const existing = await getEntry(itemId, page);
  if (existing) return existing;
  const now = new Date().toISOString();
  const entry: HipEntry = { key: entryKey(itemId, page), itemId, page, rating: 0, tags: [], addedAt: now, updatedAt: now };
  await (await getDb()).put("hips", entry);
  changed();
  return entry;
}

export async function updateEntry(itemId: string, page: number, patch: Partial<Omit<HipEntry, "key" | "itemId" | "page">>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("hips", "readwrite");
  const entry = await tx.store.get(entryKey(itemId, page));
  if (entry) await tx.store.put({ ...entry, ...patch, updatedAt: new Date().toISOString() });
  await tx.done;
  changed();
}

export async function removeEntry(itemId: string, page: number): Promise<void> {
  await (await getDb()).delete("hips", entryKey(itemId, page));
  changed();
}

export async function deleteEntriesForItem(itemId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("hips", "readwrite");
  for (const k of await tx.store.index("byItem").getAllKeys(itemId)) await tx.store.delete(k);
  await tx.done;
  changed();
}

/** All short list entries, kept up to date. */
export function useEntries(): HipEntry[] | undefined {
  const [entries, setEntries] = useState<HipEntry[]>();
  useEffect(() => {
    const load = () => void listEntries().then(setEntries);
    load();
    return subscribe(load);
  }, []);
  return entries;
}

/** One page's entry (undefined if not on the list), kept up to date. */
export function useEntry(itemId: string, page: number): HipEntry | undefined {
  const [entry, setEntry] = useState<HipEntry>();
  useEffect(() => {
    let current = true;
    const load = () =>
      void getEntry(itemId, page).then((e) => {
        if (current) setEntry(e);
      });
    load();
    const unsubscribe = subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [itemId, page]);
  return entry;
}
