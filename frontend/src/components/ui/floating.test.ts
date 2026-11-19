import { describe, expect, it } from "vitest";
import { parsePlacement, placeFloating, type Box } from "./floating";

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };

describe("parsePlacement", () => {
  it("defaults the alignment to the centre", () => {
    expect(parsePlacement("top")).toEqual({ side: "top", align: "center" });
    expect(parsePlacement("bottom-end")).toEqual({ side: "bottom", align: "end" });
  });
});

describe("placeFloating", () => {
  it("opens below and left-aligned by default", () => {
    const out = placeFloating({ anchor: box(300, 200, 100, 40), size, viewport });
    expect(out).toEqual({ left: 300, top: 248, side: "bottom" });
  });

  it("centres on the anchor for a tooltip above it", () => {
    const out = placeFloating({ anchor: box(400, 400, 100, 40), size, viewport, placement: "top" });
    expect(out).toEqual({ left: 350, top: 292, side: "top" });
  });

  it("flips to the top when there is no room below but more above", () => {
    const out = placeFloating({ anchor: box(300, 720, 100, 40), size, viewport, placement: "bottom-start" });
    expect(out.side).toBe("top");
    expect(out.top).toBe(720 - 8 - 100);
  });

  it("does not flip when the other side has even less room", () => {
    const tall = { width: 200, height: 700 };
    const out = placeFloating({ anchor: box(300, 380, 100, 40), size: tall, viewport, placement: "bottom-start" });
    // 800 - 420 - 8 = 372 below, 380 - 8 = 372 above: equal, so it stays where it was asked to be.
    expect(out.side).toBe("bottom");
  });

  it("flips a tooltip to the bottom near the top edge", () => {
    const out = placeFloating({ anchor: box(400, 10, 100, 40), size, viewport, placement: "top" });
    expect(out.side).toBe("bottom");
    expect(out.top).toBe(58);
  });

  it("slides along the cross axis to stay inside the viewport", () => {
    const right = placeFloating({ anchor: box(950, 200, 40, 40), size, viewport, placement: "bottom-start" });
    expect(right.left).toBe(1000 - 200 - 8);
    const left = placeFloating({ anchor: box(0, 200, 40, 40), size, viewport, placement: "bottom-end" });
    expect(left.left).toBe(8);
  });

  it("aligns to the end of the anchor", () => {
    const out = placeFloating({ anchor: box(600, 200, 100, 40), size, viewport, placement: "bottom-end" });
    expect(out.left).toBe(700 - 200);
  });

  it("places to the side and flips horizontally", () => {
    const right = placeFloating({ anchor: box(100, 300, 40, 40), size, viewport, placement: "right" });
    expect(right).toEqual({ left: 148, top: 270, side: "right" });
    const flipped = placeFloating({ anchor: box(900, 300, 40, 40), size, viewport, placement: "right" });
    expect(flipped.side).toBe("left");
    expect(flipped.left).toBe(900 - 8 - 200);
  });

  it("keeps a surface bigger than the viewport on screen", () => {
    const huge = { width: 1200, height: 900 };
    const out = placeFloating({ anchor: box(400, 400, 100, 40), size: huge, viewport });
    expect(out.left).toBe(8);
    expect(out.top).toBe(8);
  });
});
