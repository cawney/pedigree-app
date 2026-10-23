import { describe, expect, it } from "vitest";
import { capScale, clampView, fitSize, IDENTITY, zoomAround } from "./geometry";

const stage = { w: 1000, h: 800 };
const box = { w: 600, h: 800 }; // portrait page fitted by height

describe("fitSize", () => {
  it("fits by the tighter side", () => {
    expect(fitSize({ w: 612, h: 792 }, stage)).toMatchObject({ h: 800, scale: 800 / 792 });
    expect(fitSize({ w: 2000, h: 500 }, stage)).toMatchObject({ w: 1000, h: 250 });
  });
});

describe("clampView", () => {
  it("keeps an unzoomed page in place", () => {
    expect(clampView({ zoom: 1, x: 50, y: -30 }, box, stage)).toEqual(IDENTITY);
  });

  it("stops edges from pulling inside the screen", () => {
    // Zoom 2: page is 1200x1600 and sits at offset (200, 0).
    const v = clampView({ zoom: 2, x: 500, y: 500 }, box, stage);
    expect(v.x).toBe(-200); // left edge at screen left
    expect(v.y).toBeCloseTo(0); // top edge at screen top
    const w = clampView({ zoom: 2, x: -5000, y: -5000 }, box, stage);
    expect(200 + w.x + 1200).toBe(1000); // right edge at screen right
    expect(w.y + 1600).toBe(800); // bottom edge at screen bottom
  });

  it("limits zoom", () => {
    expect(clampView({ zoom: 0.2, x: 0, y: 0 }, box, stage).zoom).toBe(1);
    expect(clampView({ zoom: 50, x: 0, y: 0 }, box, stage).zoom).toBe(6);
  });
});

describe("zoomAround", () => {
  it("keeps the pinched point under the fingers", () => {
    const p = { x: 500, y: 400 }; // page center
    const v = zoomAround(IDENTITY, 2, p, p, box, stage);
    // Content at the page center (300, 400 in page coordinates) is still at p.
    expect(200 + v.x + 2 * 300).toBeCloseTo(500);
    expect(0 + v.y + 2 * 400).toBeCloseTo(400);
  });

  it("zooming back out recenters", () => {
    const zoomed = zoomAround(IDENTITY, 3, { x: 300, y: 100 }, { x: 300, y: 100 }, box, stage);
    expect(zoomAround(zoomed, 1, { x: 10, y: 10 }, { x: 10, y: 10 }, box, stage)).toEqual(IDENTITY);
  });
});

describe("capScale", () => {
  it("caps huge renders", () => {
    const s = capScale({ w: 612, h: 792 }, 20, 16_000_000);
    expect(612 * s * 792 * s).toBeCloseTo(16_000_000, -2);
    expect(capScale({ w: 612, h: 792 }, 2)).toBe(2);
  });
});
