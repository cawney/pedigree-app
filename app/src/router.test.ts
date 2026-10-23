import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", { addEventListener: () => {} });
const { parseRoute } = await import("./router");

describe("parseRoute", () => {
  it("parses library and reader routes", () => {
    expect(parseRoute("")).toEqual({ name: "library" });
    expect(parseRoute("#/")).toEqual({ name: "library" });
    expect(parseRoute("#/read/abc")).toEqual({ name: "read", id: "abc", page: undefined });
    expect(parseRoute("#/read/abc?page=12")).toEqual({ name: "read", id: "abc", page: 12 });
  });
});
