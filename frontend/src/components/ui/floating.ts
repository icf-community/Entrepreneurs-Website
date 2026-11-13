// ════════════════════════════════════════════════════════════════════
// Foundry · floating geometry (Lumen)
//
// Where an anchored surface (a Tooltip, a Popover, a Menu) goes, given the
// anchor's rectangle, the surface's size and the viewport. Pure arithmetic and
// no DOM access, so it is unit-tested (floating.test.ts) and the same maths
// serves all three.
//
// It does not use CSS anchor positioning: that is not in Firefox or Safari
// yet, and a tooltip that sits in the wrong place in one browser is worse than
// a few lines of JavaScript. The rules:
//
//   1. Start on the side asked for.
//   2. Flip to the opposite side only when the asked-for side lacks room AND
//      the opposite side has more of it.
//   3. Slide along the cross axis to stay inside the viewport (with `pad`).
//   4. If it still cannot fit on the main axis (a very tall menu on a short
//      screen), clamp it on-screen rather than let it leave the viewport.
// ════════════════════════════════════════════════════════════════════

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-${Align}`;

export type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number };
export type Size = { width: number; height: number };

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function parsePlacement(placement: Placement): { side: Side; align: Align } {
  const [side, align = "center"] = placement.split("-") as [Side, Align | undefined];
  return { side, align };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function placeFloating({
  anchor,
  size,
  viewport,
  placement = "bottom-start",
  gap = 8,
  pad = 8,
}: {
  /** The trigger's rectangle in viewport coordinates (getBoundingClientRect). */
  anchor: Box;
  /** The surface's own size, measured at its natural width. */
  size: Size;
  viewport: Size;
  placement?: Placement;
  /** Space between the anchor and the surface. */
  gap?: number;
  /** The least space kept between the surface and the viewport's edge. */
  pad?: number;
}): { left: number; top: number; side: Side } {
  const { side: wanted, align } = parsePlacement(placement);

  const room: Record<Side, number> = {
    top: anchor.top - pad,
    bottom: viewport.height - anchor.bottom - pad,
    left: anchor.left - pad,
    right: viewport.width - anchor.right - pad,
  };
  const needed = (side: Side) => (side === "top" || side === "bottom" ? size.height : size.width) + gap;

  let side = wanted;
  if (room[side] < needed(side) && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];

  let left: number;
  let top: number;
  if (side === "top" || side === "bottom") {
    top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - size.height;
    left =
      align === "start" ? anchor.left : align === "end" ? anchor.right - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = side === "right" ? anchor.right + gap : anchor.left - gap - size.width;
    top =
      align === "start" ? anchor.top : align === "end" ? anchor.bottom - size.height : anchor.top + anchor.height / 2 - size.height / 2;
  }

  return {
    left: clamp(left, pad, Math.max(pad, viewport.width - size.width - pad)),
    top: clamp(top, pad, Math.max(pad, viewport.height - size.height - pad)),
    side,
  };
}
