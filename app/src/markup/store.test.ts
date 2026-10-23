import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { deleteAllForItem, loadPage, markedPages, savePage } from "./store";
import type { Annotation } from "./types";

const note = (id: string): Annotation => ({ kind: "note", id, x: 1, y: 2, text: "Vet first", color: "#fff4a3" });

describe("markup store", () => {
  it("saves per page, lists marked pages, and deletes per catalog", async () => {
    await savePage("cat1", 3, [note("a")]);
    await savePage("cat1", 7, [note("b")]);
    await savePage("cat2", 3, [note("c")]);
    expect(await loadPage("cat1", 3)).toEqual([note("a")]);
    expect(await loadPage("cat1", 4)).toEqual([]);
    expect(await markedPages("cat1")).toEqual(new Set([3, 7]));

    // Saving an empty page removes it.
    await savePage("cat1", 7, []);
    expect(await markedPages("cat1")).toEqual(new Set([3]));

    await deleteAllForItem("cat1");
    expect(await markedPages("cat1")).toEqual(new Set());
    expect(await loadPage("cat2", 3)).toEqual([note("c")]);
  });
});
