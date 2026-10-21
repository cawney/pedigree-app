// The short list: hips (catalog pages) the user is interested in.

export interface HipEntry {
  /** `${itemId}:${page}` */
  key: string;
  itemId: string;
  page: number;
  /** Hip number as printed in the catalog, e.g. "412" or "412A". */
  hip?: string;
  /** 0 = not rated, 1–5 stars. */
  rating: number;
  tags: string[];
  /** The most the user will pay, in whole dollars. Private: left out of shared PDFs unless asked. */
  bidLimit?: number;
  note?: string;
  addedAt: string;
  updatedAt: string;
  /**
   * Horse details read from the catalog page (Phase 4: hip index). Optional
   * so entries made before extraction still work; smart filters use these
   * when present.
   */
  horse?: HorseInfo;
}

export interface HorseInfo {
  name?: string;
  sire?: string;
  dam?: string;
  damSire?: string;
  sex?: string;
  color?: string;
  foaled?: string;
  consignor?: string;
  state?: string;
}

/** Tags offered with one tap. Users can add their own. */
export const PRESET_TAGS = ["Inspect", "Vet", "Maybe", "Pass", "Bought"];

export const entryKey = (itemId: string, page: number) => `${itemId}:${page}`;

/** "Hip 412", or "Page 12" until the hip number is known. */
export function hipLabel(e: Pick<HipEntry, "hip" | "page">): string {
  return e.hip ? `Hip ${e.hip}` : `Page ${e.page}`;
}
