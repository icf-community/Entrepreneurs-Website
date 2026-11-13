import type { Pointer } from "./types";

// Motion helpers for the scene, and the test hooks.
//
// The mock's URL parameters survive because they let the port be compared with it frame by frame. They are read here, once, at start, in client
// code only (never in a server component, never through Next's searchParams), and every one of them is inert when absent:
//   ?still        render the settled composition (no entrance animation, no smoothing, no loop)
//   ?t=<seconds>  freeze the page clock at that time (0.3 empty, 1 converging, 1.8 forming, 2.8 arrived; the nav's entrance follows it)
//   ?p=<0..1>     scroll to that fraction of the page, still
//   ?who=<0-5>    select an audience glyph (lights its orbit)
//   ?joined       show the finished orbit insertion, the button included
//   ?prof         per-frame timing in window.__prof

export interface Params {
  still: boolean;
  frozenT: number | null;
  frozenP: number | null;
  who: number | null;
  joined: boolean;
  prof: boolean;
}

const num = (v: string | null): number | null => {
  if (v === null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function readParams(search: string = window.location.search): Params {
  const q = new URLSearchParams(search);
  return { still: q.has("still"), frozenT: num(q.get("t")), frozenP: num(q.get("p")), who: num(q.get("who")), joined: q.has("joined"), prof: q.has("prof") };
}

export const isReduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (cur: number, target: number, lambda: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

export const ease = {
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/** Smoothstep between a and b. */
export const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};


/** Smoothed pointer in -1..1 (nx, ny) and px (x, y). On touch it eases back to centre. `destroy` removes its listeners. */
export function trackPointer(el: Window = window): { pointer: Pointer; destroy: () => void } {
  const p: Pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    nx: 0,
    ny: 0,
    sx: 0,
    sy: 0,
    active: false,
    down: false,
    step(dt, lambda = 6) {
      const tx = p.active ? (p.x / window.innerWidth - 0.5) * 2 : 0;
      const ty = p.active ? (p.y / window.innerHeight - 0.5) * 2 : 0;
      p.nx = tx;
      p.ny = ty;
      p.sx = damp(p.sx, tx, lambda, dt);
      p.sy = damp(p.sy, ty, lambda, dt);
    },
  };
  const onMove = (e: PointerEvent) => {
    p.x = e.clientX;
    p.y = e.clientY;
    p.active = true;
  };
  const onDown = () => {
    p.down = true;
  };
  const onUp = () => {
    p.down = false;
  };
  el.addEventListener("pointermove", onMove, { passive: true });
  el.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  return {
    pointer: p,
    destroy() {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    },
  };
}
