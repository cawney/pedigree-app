// Handing a finished file to the user: the share sheet (Mail, Messages,
// AirDrop…) where available, otherwise a download.

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export interface ShareFile {
  name: string;
  data: Blob | Uint8Array;
  type: string;
}

export type ShareResult = "shared" | "downloaded" | "cancelled";

function toBlob(f: ShareFile): Blob {
  return f.data instanceof Blob ? f.data : new Blob([f.data as Uint8Array<ArrayBuffer>], { type: f.type });
}

/** Can this device open a share sheet for files? */
export function canShareFiles(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  try {
    return !!navigator.canShare?.({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/** Must be called from a tap (browsers only allow sharing in response to one). */
export async function shareFile(f: ShareFile, title: string): Promise<ShareResult> {
  if (Capacitor.isNativePlatform()) {
    const path = `exports/${f.name}`;
    await writeNative(path, toBlob(f));
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    try {
      await Share.share({ title, files: [uri] });
      return "shared";
    } catch {
      return "cancelled"; // the user closed the share sheet
    }
  }

  const file = new File([toBlob(f)], f.name, { type: f.type });
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // Some browsers refuse particular files; fall back to a download.
    }
  }
  download(file);
  return "downloaded";
}

export function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function writeNative(path: string, blob: Blob) {
  const chunk = 4 * 1024 * 1024;
  let offset = 0;
  do {
    const data = await toBase64(blob.slice(offset, offset + chunk));
    const opts = { path, directory: Directory.Cache, data };
    if (offset === 0) await Filesystem.writeFile({ ...opts, recursive: true });
    else await Filesystem.appendFile(opts);
    offset += chunk;
  } while (offset < blob.size);
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** A file name that's safe everywhere: "Keeneland September - Hip 412.pdf". */
export function fileName(base: string, ext: string): string {
  const clean = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${clean || "Catalog"}.${ext}`;
}
