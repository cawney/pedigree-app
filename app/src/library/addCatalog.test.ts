import { describe, expect, it, vi } from "vitest";

vi.mock("../pdf", () => ({}));
vi.mock("../store/files", () => ({}));
vi.mock("../store/library", () => ({}));

const { normalizeUrl, titleFromFileName } = await import("./addCatalog");

describe("normalizeUrl", () => {
  it("adds https:// to bare links", () => {
    expect(normalizeUrl(" example.com/cat.pdf ")).toBe("https://example.com/cat.pdf");
    expect(normalizeUrl("http://example.com/cat.pdf")).toBe("http://example.com/cat.pdf");
  });
});

describe("titleFromFileName", () => {
  it("turns file names into titles", () => {
    expect(titleFromFileName("2026-September_Yearling--Book1.PDF")).toBe("2026 September Yearling Book1");
    expect(titleFromFileName(".pdf")).toBe("Untitled catalog");
  });
});
