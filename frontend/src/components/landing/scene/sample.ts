// Turn a traced SVG path into a field of points ("stars"). The path is rasterised with Path2D, so the point cloud is built from the same
// vector the logo is drawn with.

import { rng as makeRng } from "./rand";

export interface Mask {
  w: number;
  h: number;
  alpha: Uint8Array;
}

type Ctx2D = Pick<CanvasRenderingContext2D, "scale" | "fill" | "getImageData" | "fillStyle">;

/** Rasterise a path (evenodd) into an alpha mask of `width` px, aspect from the viewBox. */
export function maskFromPath(d: string, vbW: number, vbH: number, width = 1024): Mask {
  const w = width;
  const h = Math.round(width * (vbH / vbW));
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = cv.getContext("2d", { willReadFrequently: true }) as unknown as Ctx2D;
  g.scale(w / vbW, h / vbH);
  g.fillStyle = "#fff";
  g.fill(new Path2D(d), "evenodd");
  const px = g.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
  return { w, h, alpha };
}

/** True for lit pixels that touch an unlit pixel within `r` px (the silhouette edge). */
function isEdge(mask: Mask, x: number, y: number, r = 2): boolean {
  const { w, h, alpha } = mask;
  for (let dy = -r; dy <= r; dy += r) {
    for (let dx = -r; dx <= r; dx += r) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || alpha[yy * w + xx] < 128) return true;
    }
  }
  return false;
}

export interface Points {
  x: Float32Array;
  y: Float32Array;
  edge: Uint8Array;
  aspect: number;
  count: number;
  spacing?: number;
}

/**
 * Poisson-disc-ish sampling restricted to the mask (dart throwing on a grid). Returns about `n` points as {x, y} in 0..1 of the viewBox, plus `edge`
 * flags. `edgeBias` (0..1) is the share of candidate darts thrown at edge pixels, so the silhouette reads crisply even with few points.
 */
export function pointsFromMask(mask: Mask, n: number, { seed = 7, edgeBias = 0.25, minGap = 0.82 } = {}): Points {
  const rand = makeRng(seed);
  const { w, h, alpha } = mask;
  const lit: number[] = [];
  const edge: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] >= 128) {
        lit.push(y * w + x);
        if (isEdge(mask, x, y)) edge.push(y * w + x);
      }
    }
  }
  if (!lit.length) return { x: new Float32Array(0), y: new Float32Array(0), edge: new Uint8Array(0), aspect: w / h, count: 0 };

  let r = Math.sqrt(lit.length / (n * 0.9)) * minGap; // pixels
  const out: [number, number][] = [];
  for (let pass = 0; pass < 6 && out.length < n * 0.97; pass++) {
    out.length = 0;
    const cell = r / Math.SQRT2;
    const gw = Math.ceil(w / cell);
    const gh = Math.ceil(h / cell);
    const grid = new Int32Array(gw * gh).fill(-1);
    const tries = n * 14;
    for (let k = 0; k < tries && out.length < n; k++) {
      const pool = edge.length && rand() < edgeBias ? edge : lit;
      const p = pool[(rand() * pool.length) | 0];
      const px = (p % w) + rand();
      const py = ((p / w) | 0) + rand();
      const gx = (px / cell) | 0;
      const gy = (py / cell) | 0;
      let ok = true;
      for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2) && ok; yy++) {
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const j = grid[yy * gw + xx];
          if (j >= 0) {
            const dx = out[j][0] - px;
            const dy = out[j][1] - py;
            if (dx * dx + dy * dy < r * r) {
              ok = false;
              break;
            }
          }
        }
      }
      if (!ok) continue;
      grid[gy * gw + gx] = out.length;
      out.push([px, py]);
    }
    if (out.length < n * 0.97) r *= 0.9; // not enough room: tighten the spacing and retry
  }
  const xs = new Float32Array(out.length);
  const ys = new Float32Array(out.length);
  const ed = new Uint8Array(out.length);
  out.forEach(([px, py], i) => {
    xs[i] = px / w;
    ys[i] = py / h;
    ed[i] = isEdge(mask, Math.min(w - 1, px | 0), Math.min(h - 1, py | 0)) ? 1 : 0;
  });
  return { x: xs, y: ys, edge: ed, aspect: w / h, count: out.length, spacing: r / w };
}
