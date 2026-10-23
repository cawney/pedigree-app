// A tiny hash router: #/ is the library, #/read/<id> is the viewer.
// Hash URLs work the same in the browser and inside the native app shell.

import { useSyncExternalStore } from "react";

export type Route = { name: "library" } | { name: "read"; id: string; page?: number };

export function parseRoute(hash: string): Route {
  const m = /^#\/read\/([^/?]+)(?:\?page=(\d+))?/.exec(hash);
  if (!m) return { name: "library" };
  return { name: "read", id: decodeURIComponent(m[1]), page: m[2] ? Number(m[2]) : undefined };
}

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((fn) => fn()));

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => window.location.hash,
  );
  return parseRoute(hash);
}

/** Open a catalog, at a specific page if given (otherwise where the user left off). */
export function openCatalog(id: string, page?: number) {
  history.pushState({ fromLibrary: true }, "", `#/read/${encodeURIComponent(id)}${page ? `?page=${page}` : ""}`);
  listeners.forEach((fn) => fn());
}

/** Back to the library. Uses real history when we came from there, so the
 * browser/Android back button stays in step. */
export function goToLibrary() {
  if ((history.state as { fromLibrary?: boolean } | null)?.fromLibrary) {
    history.back();
  } else {
    history.replaceState(null, "", "#/");
    listeners.forEach((fn) => fn());
  }
}
