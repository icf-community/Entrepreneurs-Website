// The static page (reduced motion, or no WebGL): one still composition per station, painted once. It is the same world and the same director as the
// live scene (the director is asked for station k settled, focus c), drawn by a small 2D painter that mirrors the shader: nothing moves and nothing is
// tied to the scroll. A poster repaints only when the viewer acts (hover, press) or resizes.
//
// The posters are canvases the server already placed (the first child of each station), so the layout never moves when they are drawn.
import { Color, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { MARK } from "@/design-system/logo/logo-data";
import { Cam } from "./cam";
import type { GlyphArt } from "./glyph-art";
import { STATIONS, tightText, type Director } from "./director";
import { CORE_PEAK, CORE_SPAN, cssColor, rawColor, srgb } from "./palette";
import { ORBITS, SEVENTH, COMM, SAT, DIAL, TAU, orbitQuat, seventhQuat, type Cloud, type World } from "./world";
import type { Frame, FrameInput, JoinState, Pose } from "./types";

const REACH: Record<string, number> = { "who-we-are": 3.5, community: 4.8, opportunities: 4.3, events: 4.4, apply: 4.1 }; // outermost ring, in mark radii
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const VP = new Matrix4();
const MV = new Matrix4();
const ROT = new Matrix4();
const eul = new Euler();
const unit = new Vector3(1, 1, 1);

function glyphImage(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

interface Poster {
  k: number;
  sec: HTMLElement;
  canvas: HTMLCanvasElement;
  c: number;
  mark: { cx: number; cy: number; r: number } | null;
}

export interface Posters {
  posters: Poster[];
  paintAll(): void;
  setFocus(k: number, c: number): void;
  setMatches(m: number[] | null): void;
  setJoin(j: JoinState): void;
  setAud(i: number): void;
  markNow(): { cx: number; cy: number; r: number } | null;
  destroy(): void;
}

export async function mountPosters({ root, world, director, glyphs, art, dprMax = 2 }: { root: HTMLElement; world: World; director: Director; glyphs: string[]; art: GlyphArt; dprMax?: number }): Promise<Posters> {
  const cam = new Cam();
  const css = (n: string): Color => cssColor(root, n);
  const void_ = css("--void");
  const warm = css("--warm");
  const warmRaw = rawColor(root, "--warm");
  const sun = css("--sun");
  const cool = css("--cool");
  const white = css("--star");
  // the shader hands these linear numbers to the screen as they are (a ShaderMaterial does no colour conversion), so the painter does too
  const raw = (c: Color): number[] => [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
  const shade = (c: Color, a = 1): string => {
    const [r, g, b] = raw(c);
    return srgb(r, g, b, a);
  };
  const col = { sky: cool.clone().lerp(white, 0.45), orbit: cool, comm: cool.clone().lerp(warmRaw, 0.35), sat: cool.clone().lerp(warmRaw, 0.18), dial: cool.clone().lerp(white, 0.2), gate: cool.clone().lerp(white, 0.3), trail: cool.clone().lerp(white, 0.5) };
  const hexOf = (c: Color): string => `#${c.getHexString()}`;
  // the guide hairlines: the cool token, a shade darker (gl.ts draws the same hairlines in the same colour)
  const guideHex = cool.clone().multiplyScalar(0.9).getHex();
  const guideRGB = [(guideHex >> 16) & 255, (guideHex >> 8) & 255, guideHex & 255];
  const sunHex = hexOf(sun);
  const wh = warm.getHex();
  const warmRGB = [(wh >> 16) & 255, (wh >> 8) & 255, wh & 255]; // sRGB bytes, for the core's light (gl.ts adds it as a sprite)

  // glyph sprites in white and in cream (a lit glyph)
  const imgs: Record<string, { w: HTMLImageElement | null; a: HTMLImageElement | null }> = {};
  await Promise.all(
    glyphs
      .filter((n) => art.has(n))
      .map(async (n) => {
        imgs[n] = { w: await glyphImage(art.svg(n, "white")), a: await glyphImage(art.svg(n, sunHex)) };
      }),
  );

  const posters: Poster[] = STATIONS.map((id, k) => {
    const sec = root.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
    return { k, sec, canvas: sec.querySelector<HTMLCanvasElement>(":scope > canvas.poster") as HTMLCanvasElement, c: -0.5, mark: null };
  });
  const view: { matches: number[] | null; aud: number; join: JoinState } = { matches: null, aud: -1, join: { p: 0, pulse: 0, flash: 0 } };
  const fakeSt = { ys: 0, y: 0, vel: 0, pointer: { sx: 0, sy: 0 } };

  // ── the 2D painter ────────────────────────────────────────────────────────────────────────────────────────────
  function paintScene(ctx: CanvasRenderingContext2D, F: Frame, W: number, H: number, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = hexOf(void_);
    ctx.fillRect(0, 0, W, H);
    const cm = cam.camera;
    VP.multiplyMatrices(cm.projectionMatrix, cm.matrixWorldInverse);
    const minPx = 1 / dpr;
    const uMid = cam.dist;
    const mcx = F.cam.cx;
    const mcy = F.cam.cy;
    const mR = F.cam.R;
    const hcy = mcy - MARK.c * mR;
    const hR = MARK.rho * mR; // the circle that holds the whole mark: the rocket breaks out of the ring, so dust and hairlines keep off that, not off the ring alone

    // a point group: world transform M (group quaternion and position), colour, alpha, kind (1 = dust that fades with depth and keeps off the mark)
    const dust = (c: Cloud, q: Quaternion, pos: Vector3 | null, color: Color, a: number, hi: number, kind: number): void => {
      if (a < 0.003) return;
      ROT.compose(pos ?? new Vector3(), q, unit);
      MV.multiplyMatrices(VP, ROT);
      const e = MV.elements;
      const cc = hi > 0 ? color.clone().lerp(warmRaw, hi) : color;
      ctx.fillStyle = shade(cc, 1);
      const base = 0.9 * a * 0.93;
      for (let i = 0; i < c.n; i++) {
        const x = c.pos[i * 3];
        const y = c.pos[i * 3 + 1];
        const z = c.pos[i * 3 + 2];
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        if (w <= 0.01) continue;
        const sx = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * W;
        const sy = (1 - (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 + 0.5)) * H;
        if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
        let al = base * Math.min(1, Math.max(0.3, 1 - (0.9 * (w - uMid)) / uMid));
        if (kind === 1 || kind === 2) al *= sstep(1.02, 1.5, Math.hypot(sx - mcx, sy - hcy) / Math.max(1, hR));
        if (al < 0.02) continue;
        const s = Math.max(minPx, c.size[i] * (8 / w)) * 0.82;
        ctx.globalAlpha = al;
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    };
    const proj = (x: number, y: number, z: number, e: ArrayLike<number>, out: { x: number; y: number; w: number }): { x: number; y: number; w: number } => {
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      out.x = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * W;
      out.y = (1 - (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 + 0.5)) * H;
      out.w = w;
      return out;
    };
    const tp = { x: 0, y: 0, w: 1 };
    const tq = new Quaternion();
    const Q = new Quaternion();
    const zero = new Vector3();
    const guide = (r: number, q: Quaternion, a: number): void => {
      if (a < 0.003) return;
      ROT.compose(zero, q, unit);
      MV.multiplyMatrices(VP, ROT);
      ctx.strokeStyle = srgb(guideRGB[0], guideRGB[1], guideRGB[2], a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 160; k++) {
        const th = (k / 160) * TAU;
        proj(Math.cos(th) * r, Math.sin(th) * r, 0, MV.elements, tp);
        if (k) ctx.lineTo(tp.x, tp.y);
        else ctx.moveTo(tp.x, tp.y);
      }
      ctx.stroke();
    };

    // far field: the sky, turned a little with the camera
    eul.set(F.skyPitch ?? 0, F.skyYaw ?? 0, 0);
    dust(world.sky, tq.setFromEuler(eul), null, col.sky, F.sky ?? 1, 0, 2);
    // guide lines, then the rings
    ORBITS.forEach((o, i) => guide(o.r, orbitQuat(i, F.flat, F.tilt, Q), F.orbits[i].line));
    guide(SEVENTH.r, seventhQuat(F.flat, F.tilt, Q), F.seventh.line ?? 0);
    guide(COMM.r, COMM.q, F.comm.line);
    guide(SAT.r, SAT.q, F.sat.line);
    guide(DIAL.r, DIAL.q, F.dial.line);
    // nothing is drawn over or through the roundel: the hairlines stop at its ground, solid out to 1.02 mark radii, gone by 1.5
    {
      const r1 = hR * 1.5;
      const vh = void_.getHex();
      const [vr, vg, vb] = [(vh >> 16) & 255, (vh >> 8) & 255, vh & 255];
      const gr = ctx.createRadialGradient(mcx, hcy, 0, mcx, hcy, r1);
      gr.addColorStop(0, srgb(vr, vg, vb, 1));
      gr.addColorStop(1.02 / 1.5, srgb(vr, vg, vb, 1));
      gr.addColorStop(1, srgb(vr, vg, vb, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(mcx - r1, hcy - r1, r1 * 2, r1 * 2);
    }
    // the warm core: the same two ramps gl.ts draws, added to the ground (a bloom past the ring and a peak low inside it, behind the exhaust)
    if ((F.core ?? 0) > 0.004) {
      const cs = F.coreSwell ?? 0;
      const a = Math.min(1, F.core * CORE_PEAK * (1 + cs * 0.6));
      const k = mR * (1 + cs * 0.12);
      const wc = (x: number): string => srgb(warmRGB[0], warmRGB[1], warmRGB[2], x);
      const h = CORE_SPAN / 2;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const b = ctx.createRadialGradient(mcx, mcy, 0, mcx, mcy, h * k);
      b.addColorStop(0, wc(0.36 * a));
      b.addColorStop(1 / h, wc(0.26 * a));
      b.addColorStop(0.6, wc(0.09 * a));
      b.addColorStop(1, wc(0));
      ctx.fillStyle = b;
      ctx.fillRect(mcx - h * k, mcy - h * k, 2 * h * k, 2 * h * k);
      const cy = mcy + 0.34 * k;
      const i = ctx.createRadialGradient(mcx, cy, 0, mcx, cy, 1.15 * k);
      i.addColorStop(0, wc(0.78 * a));
      i.addColorStop(0.55, wc(0.43 * a));
      i.addColorStop(1, wc(0));
      ctx.fillStyle = i;
      ctx.fillRect(mcx - 1.15 * k, cy - 1.15 * k, 2.3 * k, 2.3 * k);
      ctx.restore();
    }
    ORBITS.forEach((o, i) => dust(world.orbits[i], orbitQuat(i, F.flat, F.tilt, Q), null, col.orbit, F.orbits[i].a, F.orbits[i].hi, 1));
    dust(world.seventh, seventhQuat(F.flat, F.tilt, Q), null, col.orbit, F.seventh.a, F.seventh.hi, 1);
    dust(world.comm, COMM.q, null, col.comm, F.comm.a, F.comm.hi, 1);
    dust(world.sat, SAT.q, null, col.sat, F.sat.a, F.sat.hi, 1);
    dust(world.dial, DIAL.q, null, col.dial, F.dial.a, F.dial.hi, 1);
    world.gates.forEach((g, i) => {
      const o = F.gates[i];
      dust(g, tq.set(o.qx, o.qy, o.qz, o.qw), new Vector3(o.x, o.y, o.z), col.gate, o.a, o.hi, 1);
    });
    // the visitor's dust trail (world positions)
    if (F.trail?.n) {
      const e = VP.elements;
      ctx.fillStyle = shade(col.trail.clone().lerp(warmRaw, F.trail.hi ?? 0), 1);
      for (let i = 0; i < F.trail.n; i++) {
        proj(F.trail.pos[i * 3], F.trail.pos[i * 3 + 1], F.trail.pos[i * 3 + 2], e, tp);
        const s = Math.max(minPx, (F.trail.size?.[i] ?? 2.4) * (8 / tp.w)) * 0.82;
        ctx.globalAlpha = 0.9 * (F.trail.a ?? 1) * 0.93;
        ctx.fillRect(tp.x - s / 2, tp.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // the mark: stars in the camera plane, white, whole
    {
      const m = world.mark;
      const k = mR;
      const s0 = 8 / cam.dist;
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < m.n; i++) {
        const sx = mcx + m.pos[i * 3] * k;
        const sy = mcy - m.pos[i * 3 + 1] * k;
        const s = Math.max(minPx, m.size[i] * s0) * 0.62; // a hard square covers about 1.8x what the shader's soft point does: 0.62 gives the live mark's grain
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // bodies: a halo, then the glyph (white, with the warm accent laid over it by `hi`)
    for (const b of F.bodies) {
      if (b.a < 0.004) continue;
      const e = VP.elements;
      proj(b.x, b.y, b.z, e, tp);
      const px = cam.pxPerUnit(tp.w);
      const size = b.size * px;
      if (b.halo > 0.004) {
        const r = (size * (b.haloK ?? 3)) / 2;
        const g = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, r);
        const hc = cool.clone().lerp(warm, b.hi);
        const hx = hc.getHex();
        const rc = [(hx >> 16) & 255, (hx >> 8) & 255, hx & 255]; // a halo is a sprite in the live scene: colour-managed, so its sRGB bytes
        g.addColorStop(0, srgb(rc[0], rc[1], rc[2], 0.9 * b.halo * b.a));
        g.addColorStop(0.35, srgb(rc[0], rc[1], rc[2], 0.28 * b.halo * b.a));
        g.addColorStop(1, srgb(rc[0], rc[1], rc[2], 0));
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = g;
        ctx.fillRect(tp.x - r, tp.y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = "source-over";
      }
      const im = imgs[b.glyph];
      if (!im?.w) continue;
      ctx.globalAlpha = b.a;
      ctx.drawImage(im.w, tp.x - size / 2, tp.y - size / 2, size, size);
      if (b.hi > 0.01 && im.a) {
        ctx.globalAlpha = b.a * Math.min(1, b.hi);
        ctx.drawImage(im.a, tp.x - size / 2, tp.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── one poster ───────────────────────────────────────────────────────────────────────────────────────────────
  function rectsFor(p: Poster): { left: number; right: number; top: number; bottom: number }[] {
    const o = p.canvas.getBoundingClientRect();
    const pick = p.k === 0 ? ".hero-copy h1, .hero-copy .actions, .hero-copy .who-wrap" : p.k === STATIONS.length - 1 ? ".strip" : null;
    if (!pick) return [];
    return [...p.sec.querySelectorAll(pick)].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top };
    });
  }
  function paint(p: Poster): void {
    const r = p.canvas.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < 8 || h < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 900 ? Math.min(1.5, dprMax) : dprMax);
    if (p.canvas.width !== Math.round(w * dpr) || p.canvas.height !== Math.round(h * dpr)) {
      p.canvas.width = Math.round(w * dpr);
      p.canvas.height = Math.round(h * dpr);
    }
    // the hero's words end at the real width of the lines (not the width of their column): the mark keeps its clear space from that
    let copyRight = 0;
    if (p.k === 0) {
      const o = p.canvas.getBoundingClientRect();
      const h1 = p.sec.querySelector(".hero-copy h1");
      const t = h1 && tightText(h1);
      if (t) copyRight = t.right - o.left;
      for (const q of [".hero-copy .btn", ".hero-copy .who-row"]) {
        const e = p.sec.querySelector(q);
        if (e) copyRight = Math.max(copyRight, e.getBoundingClientRect().right - o.left);
      }
    }
    // the hero and the footer posters run full-bleed under the nav: their scene keeps clear of the rail's zone on the right (a desktop)
    const railR = (p.k === 0 || p.k === STATIONS.length - 1) && window.innerWidth >= 900 ? (root.querySelector("#rail")?.getBoundingClientRect().width ?? 0) : 0;
    director.measureStatic(w, h, rectsFor(p), copyRight, railR);
    const id = STATIONS[p.k];
    const interior = p.k > 0 && p.k < STATIONS.length - 1;
    let pose: Partial<Pose> | null = null;
    if (interior) pose = { cx: w / 2, cy: h / 2, R: (0.47 * Math.min(w, h * 1.15)) / REACH[id] };
    const inp: FrameInput = { build: 1, entrance: 1, drift: 0, flowOn: false, focusAud: view.aud, force: { k: p.k, c: p.c, pose }, matches: view.matches, join: view.join };
    const F = director.frame(fakeSt, 4, inp, cam);
    const ctx = p.canvas.getContext("2d") as CanvasRenderingContext2D;
    paintScene(ctx, F, w, h, dpr);
    p.mark = { cx: F.cam.cx, cy: F.cam.cy - MARK.c * F.cam.R, r: MARK.rho * F.cam.R }; // the circle that holds the whole mark (see MARK in the logo data)
  }
  const paintAll = (): void => posters.forEach(paint);
  const setFocus = (k: number, c: number): void => {
    const p = posters[k];
    if (p && p.c !== c) {
      p.c = c;
      paint(p);
    }
  };
  const setMatches = (m: number[] | null): void => {
    view.matches = m;
    paint(posters[2]);
  };
  const setJoin = (j: JoinState): void => {
    view.join = j;
    paint(posters[5]);
  };
  const setAud = (i: number): void => {
    if (view.aud !== i) {
      view.aud = i;
      paint(posters[0]);
    }
  };

  let t = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(t);
    t = window.setTimeout(paintAll, 120);
  });
  posters.forEach((p) => ro.observe(p.canvas));
  paintAll();

  /** The circle that holds the whole mark (ring and rocket) of the poster that shows it inside the viewport (the page contract's __mark). */
  function markNow(): { cx: number; cy: number; r: number } | null {
    let best: { cx: number; cy: number; r: number } | null = null;
    let bv = 0;
    for (const p of posters) {
      if (!p.mark) continue;
      const r = p.canvas.getBoundingClientRect();
      const cx = r.left + p.mark.cx;
      const cy = r.top + p.mark.cy;
      const R = p.mark.r;
      if (cx - R < 0 || cx + R > window.innerWidth || cy - R < 0 || cy + R > window.innerHeight) continue;
      const v = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (v > bv) {
        bv = v;
        best = { cx, cy, r: R };
      }
    }
    return best;
  }
  return {
    posters, paintAll, setFocus, setMatches, setJoin, setAud, markNow,
    destroy() {
      window.clearTimeout(t);
      ro.disconnect();
      for (const p of posters) p.canvas.getContext("2d")?.clearRect(0, 0, p.canvas.width, p.canvas.height);
    },
  };
}
