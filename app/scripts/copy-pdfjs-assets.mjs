// Copies the font, character map, color profile and image decoder files
// PDF.js loads at runtime into public/pdfjs, so they're served with the app
// (and bundled into the iOS/Android builds for offline use).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));
const outDir = join(import.meta.dirname, "..", "public", "pdfjs");
mkdirSync(outDir, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const src = join(pdfjsDir, dir);
  if (existsSync(src)) cpSync(src, join(outDir, dir), { recursive: true });
}
