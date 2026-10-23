import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Data: "DATA" }, Filesystem: {} }));

const { getItem, listItems, putItem, removeItem, subscribe, updateItem } = await import("./library");
const { webFiles } = await import("./files");

describe("library", () => {
  it("stores, updates, lists most-recent first, and removes with the file", async () => {
    const changes = vi.fn();
    const unsubscribe = subscribe(changes);

    await putItem({ id: "a", title: "Book 1", sizeBytes: 10, addedAt: "2026-09-01T00:00:00Z" });
    await putItem({ id: "b", title: "Book 2", sizeBytes: 10, addedAt: "2026-09-02T00:00:00Z" });
    await webFiles.saveBlob("a", new Blob(["%PDF-1.7 test"]));
    expect((await listItems()).map((i) => i.id)).toEqual(["b", "a"]);

    await updateItem("a", { lastOpenedAt: "2026-09-03T00:00:00Z", lastPage: 12 });
    expect((await listItems()).map((i) => i.id)).toEqual(["a", "b"]);
    expect((await getItem("a"))?.lastPage).toBe(12);

    const src = await webFiles.open("a");
    expect(src.kind === "blob" && (await src.blob.text())).toBe("%PDF-1.7 test");

    await removeItem("a");
    expect(await getItem("a")).toBeUndefined();
    await expect(webFiles.open("a")).rejects.toThrow(/missing/);

    expect(changes).toHaveBeenCalledTimes(4);
    unsubscribe();
  });
});
