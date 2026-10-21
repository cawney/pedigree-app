// Filtering and sorting the short list. "Smart filters" are saved
// combinations of these settings.

import type { HipEntry, HorseInfo } from "./types";

export interface ShortlistFilter {
  /** Only these catalogs. Empty = all. */
  itemIds: string[];
  /** Entries with any of these tags. Empty = any. */
  tags: string[];
  /** Minimum star rating. 0 = any. */
  minRating: number;
  /** Matches hip number, note, tags and horse details. */
  text: string;
  onlyWithBidLimit: boolean;
  /** Horse detail filters, e.g. { sire: "Into Mischief" } (substring, any case). */
  horse: Partial<Record<keyof HorseInfo, string>>;
}

export const EMPTY_FILTER: ShortlistFilter = { itemIds: [], tags: [], minRating: 0, text: "", onlyWithBidLimit: false, horse: {} };

export type SortKey = "catalog" | "rating" | "recent";

export interface SmartFilter {
  id: string;
  name: string;
  filter: ShortlistFilter;
  sort: SortKey;
}

export function isFiltered(f: ShortlistFilter): boolean {
  return (
    f.itemIds.length > 0 ||
    f.tags.length > 0 ||
    f.minRating > 0 ||
    f.text.trim() !== "" ||
    f.onlyWithBidLimit ||
    Object.values(f.horse).some((v) => v?.trim())
  );
}

const lc = (s: string | undefined) => (s ?? "").toLowerCase();

export function matches(e: HipEntry, f: ShortlistFilter): boolean {
  if (f.itemIds.length && !f.itemIds.includes(e.itemId)) return false;
  if (f.tags.length && !e.tags.some((t) => f.tags.includes(t))) return false;
  if (e.rating < f.minRating) return false;
  if (f.onlyWithBidLimit && !e.bidLimit) return false;
  for (const [field, want] of Object.entries(f.horse)) {
    if (want?.trim() && !lc(e.horse?.[field as keyof HorseInfo]).includes(lc(want.trim()))) return false;
  }
  const q = lc(f.text.trim());
  if (q) {
    const haystack = [e.hip, `hip ${e.hip ?? ""}`, `page ${e.page}`, e.note, ...e.tags, ...Object.values(e.horse ?? {})].map(lc).join("\n");
    if (!q.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return true;
}

/** Hip numbers sort numerically, with suffixes after: 9, 10, 10A, 11. */
export function compareHips(a: Pick<HipEntry, "hip" | "page">, b: Pick<HipEntry, "hip" | "page">): number {
  const parse = (h?: string) => {
    const m = /^(\d+)(.*)$/.exec(h?.trim() ?? "");
    return m ? { n: Number(m[1]), rest: m[2] } : null;
  };
  const pa = parse(a.hip);
  const pb = parse(b.hip);
  if (pa && pb) return pa.n - pb.n || pa.rest.localeCompare(pb.rest) || a.page - b.page;
  return a.page - b.page;
}

export function sortEntries(entries: HipEntry[], key: SortKey, catalogOrder: Map<string, number>): HipEntry[] {
  const byCatalog = (a: HipEntry, b: HipEntry) =>
    (catalogOrder.get(a.itemId) ?? 1e9) - (catalogOrder.get(b.itemId) ?? 1e9) || compareHips(a, b);
  const sorted = [...entries];
  if (key === "rating") sorted.sort((a, b) => b.rating - a.rating || byCatalog(a, b));
  else if (key === "recent") sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else sorted.sort(byCatalog);
  return sorted;
}

/** Every tag in use, presets first. */
export function allTags(entries: HipEntry[], presets: string[]): string[] {
  const used = new Set(entries.flatMap((e) => e.tags));
  return [...presets, ...[...used].filter((t) => !presets.includes(t)).sort()];
}
