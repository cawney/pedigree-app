import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PageMarkup } from "../markup/types";
import type { HipEntry } from "../shortlist/types";

/** A catalog in the user's library on this device. */
export interface LibraryItem {
  id: string;
  title: string;
  saleCompany?: string;
  saleDate?: string; // YYYY-MM-DD
  pageCount?: number;
  sizeBytes: number;
  /** The catalog's id on the server, if it came from there. */
  serverId?: string;
  sourceUrl?: string;
  addedAt: string;
  lastOpenedAt?: string;
  /** Page the user was on when they last closed the catalog. */
  lastPage?: number;
}

interface PedigreeDB extends DBSchema {
  items: { key: string; value: LibraryItem };
  /** PDF files, used when running in a browser (native apps use the filesystem). */
  files: { key: string; value: Blob };
  /** Markup per catalog page. */
  markup: { key: string; value: PageMarkup; indexes: { byItem: string } };
  /** Short list entries, one per catalog page. */
  hips: { key: string; value: HipEntry; indexes: { byItem: string } };
}

let dbPromise: Promise<IDBPDatabase<PedigreeDB>> | undefined;

export function getDb(): Promise<IDBPDatabase<PedigreeDB>> {
  dbPromise ??= openDB<PedigreeDB>("pedigree", 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("items", { keyPath: "id" });
        db.createObjectStore("files");
      }
      if (oldVersion < 2) {
        db.createObjectStore("markup", { keyPath: "key" }).createIndex("byItem", "itemId");
      }
      if (oldVersion < 3) {
        db.createObjectStore("hips", { keyPath: "key" }).createIndex("byItem", "itemId");
      }
    },
  });
  return dbPromise;
}

/** Ids that work outside secure contexts too (e.g. a phone testing the dev server over the LAN). */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
