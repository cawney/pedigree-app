// Client for the catalog server (see /server).

/** A catalog stored on the server. Field names match the server's JSON. */
export interface ServerCatalog {
  id: string;
  title: string;
  sale_company: string | null;
  sale_date: string | null; // YYYY-MM-DD
  source_url: string | null;
  sha256: string;
  size_bytes: number;
  page_count: number | null;
  listed: boolean;
  created_at: string;
}

/**
 * Where the server lives. In development this is the Vite proxy at /api.
 * iOS/Android builds must set VITE_API_URL to the server's full address.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 if the server couldn't be reached. */
    readonly status: number,
  ) {
    super(message);
  }
}

export function apiUrl(path: string): string {
  return new URL(API_BASE + path, window.location.href).toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError("Can't reach the catalog server. Check your internet connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error ?? `The catalog server answered with an error (${res.status}).`, res.status);
  }
  return body as T;
}

/** Catalogs in the shared "Available" list. */
export function listAvailable(): Promise<ServerCatalog[]> {
  return request("/catalogs");
}

/** Ask the server to download a PDF from a link and store it. */
export function fetchFromUrl(url: string): Promise<ServerCatalog> {
  return request("/catalogs/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function catalogFileUrl(id: string): string {
  return apiUrl(`/catalogs/${encodeURIComponent(id)}/file`);
}
