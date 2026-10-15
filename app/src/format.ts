export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "Sep 8, 2026" from "2026-09-08". */
export function formatSaleDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Keeneland · Sep 8, 2026 · 480 pages" */
export function catalogSubtitle(c: { saleCompany?: string; saleDate?: string; pageCount?: number }): string {
  return [c.saleCompany, c.saleDate && formatSaleDate(c.saleDate), c.pageCount && `${c.pageCount} pages`]
    .filter(Boolean)
    .join(" · ");
}

export function percent(loaded: number, total: number | undefined): string {
  return total ? `${Math.min(100, Math.round((loaded / total) * 100))}%` : formatBytes(loaded);
}
