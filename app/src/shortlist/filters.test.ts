import { describe, expect, it } from "vitest";
import { allTags, compareHips, EMPTY_FILTER, isFiltered, matches, sortEntries } from "./filters";
import type { HipEntry } from "./types";

const entry = (over: Partial<HipEntry>): HipEntry => ({
  key: `${over.itemId ?? "a"}:${over.page ?? 1}`,
  itemId: "a",
  page: 1,
  rating: 0,
  tags: [],
  addedAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("matches", () => {
  const e = entry({
    hip: "412",
    rating: 4,
    tags: ["Vet"],
    bidLimit: 150000,
    note: "Good walk, small",
    horse: { sire: "Into Mischief", sex: "Colt" },
  });

  it("passes everything with no filter", () => {
    expect(matches(e, EMPTY_FILTER)).toBe(true);
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
  });

  it("filters by catalog, tag, rating and bid limit", () => {
    expect(matches(e, { ...EMPTY_FILTER, itemIds: ["b"] })).toBe(false);
    expect(matches(e, { ...EMPTY_FILTER, tags: ["Pass", "Vet"] })).toBe(true);
    expect(matches(e, { ...EMPTY_FILTER, tags: ["Pass"] })).toBe(false);
    expect(matches(e, { ...EMPTY_FILTER, minRating: 5 })).toBe(false);
    expect(matches(entry({}), { ...EMPTY_FILTER, onlyWithBidLimit: true })).toBe(false);
  });

  it("searches hip, notes, tags and horse details (all words)", () => {
    const search = (text: string) => matches(e, { ...EMPTY_FILTER, text });
    expect(search("412")).toBe(true);
    expect(search("hip 412")).toBe(true);
    expect(search("walk vet")).toBe(true);
    expect(search("mischief")).toBe(true);
    expect(search("walk filly")).toBe(false);
  });

  it("filters on horse details", () => {
    expect(matches(e, { ...EMPTY_FILTER, horse: { sire: "into mis" } })).toBe(true);
    expect(matches(e, { ...EMPTY_FILTER, horse: { sex: "Filly" } })).toBe(false);
    expect(matches(entry({}), { ...EMPTY_FILTER, horse: { sire: "Gun Runner" } })).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, horse: { sire: "x" } })).toBe(true);
  });
});

describe("sorting", () => {
  it("orders hips numerically with suffixes", () => {
    const hips = ["10A", "9", "10", "100", "11"].map((hip, i) => entry({ hip, page: i + 1 }));
    expect(hips.sort(compareHips).map((e) => e.hip)).toEqual(["9", "10", "10A", "11", "100"]);
  });

  it("sorts by catalog, rating, or recent", () => {
    const list = [
      entry({ itemId: "b", page: 5, rating: 2, updatedAt: "2026-09-03" }),
      entry({ itemId: "a", page: 9, rating: 5, updatedAt: "2026-09-01" }),
      entry({ itemId: "a", page: 2, rating: 3, updatedAt: "2026-09-02" }),
    ];
    const order = new Map([["a", 0], ["b", 1]]);
    expect(sortEntries(list, "catalog", order).map((e) => e.key)).toEqual(["a:2", "a:9", "b:5"]);
    expect(sortEntries(list, "rating", order).map((e) => e.key)).toEqual(["a:9", "a:2", "b:5"]);
    expect(sortEntries(list, "recent", order).map((e) => e.key)).toEqual(["b:5", "a:2", "a:9"]);
  });

  it("lists preset tags first, then custom ones", () => {
    expect(allTags([entry({ tags: ["zed", "Vet"] }), entry({ tags: ["abc"] })], ["Vet", "Pass"])).toEqual(["Vet", "Pass", "abc", "zed"]);
  });
});
