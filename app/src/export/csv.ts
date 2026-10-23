import type { HipEntry } from "../shortlist/types";

/** The short list as a spreadsheet. */
export function shortlistCsv(entries: HipEntry[], catalogTitles: Map<string, string>, includeBids: boolean): string {
  const header = ["Catalog", "Hip", "Page", "Rating", "Tags", ...(includeBids ? ["Bid limit"] : []), "Notes", "Sire", "Dam", "Sex"];
  const rows = entries.map((e) => [
    catalogTitles.get(e.itemId) ?? "",
    e.hip ?? "",
    String(e.page),
    e.rating ? String(e.rating) : "",
    e.tags.join("; "),
    ...(includeBids ? [e.bidLimit ? String(e.bidLimit) : ""] : []),
    e.note ?? "",
    e.horse?.sire ?? "",
    e.horse?.dam ?? "",
    e.horse?.sex ?? "",
  ]);
  // Leading byte-order mark so Excel opens it as UTF-8.
  return "\ufeff" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(v: string): string {
  // Quote when needed; neutralise leading =,+,-,@ so spreadsheets don't run them as formulas.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
