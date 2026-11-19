// The world as data: point clouds for the mark, the sky and every ring, and the orbital geometry the director and both painters share.
// Units: the mark's ring radius is 1. The mark sits at the origin and is a billboard (it never rotates). It is the 2026 logo: the rocket breaks out of
// the ring, so the stars reach 1.23 radii above the origin (MARK in the logo data) and 1.0 below it.
import { Euler, Quaternion, Vector3 } from "three";
import { ROUNDEL } from "@/design-system/logo/logo-data";
import { maskFromPath, pointsFromMask } from "./sample";
import { rng } from "./rand";

export const TAU = Math.PI * 2;
const D = Math.PI / 180;

/** Point-count scale by viewport area: clamp(vw·vh / (1440·900), .35, 1.2). */
export const densityFor = (w: number, h: number): number => Math.min(1.2, Math.max(0.35, (w * h) / (1440 * 900)));

// ── the six audience orbits (an ordered family, 16° to 33° of tilt, 3.4° apart) ─────────────────────────────────
export interface Orbit {
  r: number;
  incl: number;
  node: number;
}
export const ORBITS: Orbit[] = Array.from({ length: 6 }, (_, i) => ({
  r: 1.62 + i * 0.32,
  incl: (16 + i * 3.4) * D,
  node: (-22 + i * 8.6) * D,
}));

// ── the other rings ─────────────────────────────────────────────────────────────────────────────────────────────
export interface Ring {
  r: number;
  q: Quaternion;
}
/** Community: four members on a wide tilted ring outside the six. */
export const COMM: Ring = { r: 4.35, q: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0.38, "ZXY")) };
/** Opportunities: three satellites on a steeper ring. */
export const SAT: Ring = { r: 3.9, q: new Quaternion().setFromEuler(new Euler(0, 1.05, 0.15, "ZYX")) };
/** Events: the calendar dial lies flat (xz plane) and is read from above. */
export const DIAL: Ring = { r: 4.05, q: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)) };
/** Apply: the visitor's ring (the 7th orbit, between the third and fourth) and the three gates it flies through. */
export const SEVENTH: Orbit = { r: 2.42, incl: 24.6 * D, node: 2.5 * D };

const qOrbit = (o: Orbit, flat: number, out: Quaternion): Quaternion => out.setFromEuler(new Euler(o.incl * (1 - flat), 0, o.node, "ZXY"));

const _q = new Quaternion();
const _g = new Quaternion();
const _e = new Euler();
/** Quaternion that carries orbit i's local frame to the world: group tilt after the orbit's own inclination. */
export function orbitQuat(i: number, flat: number, tilt: number, out: Quaternion = new Quaternion()): Quaternion {
  qOrbit(ORBITS[i], flat, _q);
  _g.setFromEuler(_e.set(tilt, 0, 0));
  return out.copy(_g).multiply(_q);
}
export function seventhQuat(flat: number, tilt: number, out: Quaternion = new Quaternion()): Quaternion {
  qOrbit(SEVENTH, flat, _q);
  _g.setFromEuler(_e.set(tilt, 0, 0));
  return out.copy(_g).multiply(_q);
}
/** A point on orbit i at angle th (local circle, then the quaternion). */
export function orbitPoint(i: number, th: number, flat: number, tilt: number, out: Vector3 = new Vector3()): Vector3 {
  const o = ORBITS[i];
  return out.set(Math.cos(th) * o.r, Math.sin(th) * o.r, 0).applyQuaternion(orbitQuat(i, flat, tilt));
}
export function ringPoint(ring: Ring, th: number, out: Vector3 = new Vector3()): Vector3 {
  return out.set(Math.cos(th) * ring.r, Math.sin(th) * ring.r, 0).applyQuaternion(ring.q);
}

// ── point clouds ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Cloud {
  n: number;
  pos: Float32Array;
  start: Float32Array;
  size: Float32Array;
  phase: Float32Array;
  delay: Float32Array;
}

function cloud(n: number): Cloud {
  return { n, pos: new Float32Array(n * 3), start: new Float32Array(n * 3), size: new Float32Array(n), phase: new Float32Array(n), delay: new Float32Array(n) };
}
const put = (c: Cloud, i: number, x: number, y: number, z: number, size: number, ph: number, delay = 0, sx = x, sy = y, sz = z): void => {
  c.pos[i * 3] = x;
  c.pos[i * 3 + 1] = y;
  c.pos[i * 3 + 2] = z;
  c.start[i * 3] = sx;
  c.start[i * 3 + 1] = sy;
  c.start[i * 3 + 2] = sz;
  c.size[i] = size;
  c.phase[i] = ph;
  c.delay[i] = delay;
};

/** A dust ring in the local xy plane. spread: how far the points start from home when the ring condenses. */
function ringCloud(R: () => number, n: number, r: number, { jr = 0.014, jz = 0.015, s0 = 2.2, s1 = 3.3, spread = 0, jitterAngle = 0.006 } = {}): Cloud {
  const c = cloud(n);
  for (let k = 0; k < n; k++) {
    const th = (k / n) * TAU + (R() - 0.5) * jitterAngle * (900 / n);
    const rr = r + (R() - 0.5) * 2 * jr;
    const z = (R() - 0.5) * 2 * jz;
    const x = Math.cos(th) * rr;
    const y = Math.sin(th) * rr;
    let sx = x;
    let sy = y;
    let sz = z;
    if (spread) {
      const a = R() * TAU;
      const b = Math.acos(2 * R() - 1);
      const d = spread * (0.5 + R());
      sx = x + Math.sin(b) * Math.cos(a) * d;
      sy = y + Math.sin(b) * Math.sin(a) * d;
      sz = z + Math.cos(b) * d;
    }
    put(c, k, x, y, z, s0 + R() * (s1 - s0), R(), spread ? R() : 0, sx, sy, sz);
  }
  return c;
}

/** The calendar dial: a dust ring plus graduations like a clock face (60 minute ticks, 12 hour ticks), local xy plane. */
function dialCloud(R: () => number, density: number): Cloud {
  const ring = Math.round(520 * density);
  const pts: [number, number, number, number][] = [];
  for (let k = 0; k < ring; k++) {
    const th = (k / ring) * TAU + (R() - 0.5) * 0.004;
    pts.push([Math.cos(th) * DIAL.r, Math.sin(th) * DIAL.r, 0, 2.1 + R() * 0.8]);
  }
  for (let m = 0; m < 60; m++) {
    const th = (m / 60) * TAU;
    const hour = m % 5 === 0;
    const len = hour ? 6 : 3;
    const step = hour ? 0.075 : 0.06;
    for (let j = 1; j <= len; j++) {
      const rr = DIAL.r - j * step;
      pts.push([Math.cos(th) * rr, Math.sin(th) * rr, 0, hour ? 2.9 - j * 0.12 : 2.0]);
    }
  }
  const c = cloud(pts.length);
  pts.forEach(([x, y, z, s], i) => put(c, i, x, y, z, s, R(), 0));
  return c;
}

/** Apply: the visitor's approach is a spiral in the 7th orbit's plane; three gates (identity, your work, visibility) hang across it. */
export const GATE = { r: 0.84, u: [0.2, 0.5, 0.8] };
export const SPIRAL = { rHold: 3.5, rFar: 9, turn: 3.0 };
/** A phone sees about 4.2 mark radii either side of the mark (a desktop sees 9 or more): its path is shorter and the first gate sits nearer, so all three stay on screen. */
export const GATE_C = { r: 0.84, u: [0.28, 0.5, 0.8] };
export const SPIRAL_C = { rHold: 3.5, rFar: 5.4, turn: 3.0 };

export interface World {
  density: number;
  mark: Cloud;
  orbits: Cloud[];
  seventh: Cloud;
  comm: Cloud;
  sat: Cloud;
  dial: Cloud;
  sky: Cloud;
  gates: Cloud[];
}

/** Everything the painters need, built once per density. */
export function buildWorld(density: number): World {
  const R = rng(77);
  const mask = maskFromPath(ROUNDEL.d, ROUNDEL.w, ROUNDEL.h, 1024);
  const mk = pointsFromMask(mask, Math.round(16000 * density), { seed: 21, edgeBias: 0.4 });
  const mark = cloud(mk.count);
  for (let i = 0; i < mk.count; i++) {
    const x = (mk.x[i] * ROUNDEL.w - ROUNDEL.cx) / ROUNDEL.outerR;
    const y = -(mk.y[i] * ROUNDEL.h - ROUNDEL.cy) / ROUNDEL.outerR;
    const a = R() * TAU;
    const b = Math.acos(2 * R() - 1);
    const d = 7 + R() * 9;
    put(mark, i, x, y, 0, mk.edge[i] ? 3.1 : 2.7, R(), Math.min(1, Math.hypot(x, y) * 0.55) * 0.7 + R() * 0.3, Math.sin(b) * Math.cos(a) * d, Math.sin(b) * Math.sin(a) * d, Math.cos(b) * d);
  }
  const orbitN = Math.round(900 * density);
  const orbits = ORBITS.map((o) => ringCloud(R, orbitN, o.r, { spread: 9, s0: 2.1, s1: 3.2 }));
  const seventh = ringCloud(R, Math.round(760 * density), SEVENTH.r, { spread: 0, s0: 2.1, s1: 3.2 });
  const comm = ringCloud(R, Math.round(1100 * density), COMM.r, { spread: 8, jr: 0.03, jz: 0.03, s0: 2.1, s1: 3.3 });
  const sat = ringCloud(R, Math.round(820 * density), SAT.r, { spread: 8, jr: 0.025, jz: 0.025, s0: 2.1, s1: 3.2 });
  const dial = dialCloud(R, density);
  // the sky: three shells, sparse and tiny, plus a milky band for large-scale structure
  const skyN = Math.round(2300 * density);
  const sky = cloud(skyN);
  for (let i = 0; i < skyN; i++) {
    const a = R() * TAU;
    const b = Math.acos(2 * R() - 1);
    const band = i % 4 === 0;
    let bb = b;
    if (band) bb = Math.PI / 2 + (R() + R() + R() - 1.5) * 0.28; // concentrated near a great circle
    const d = 9 + R() * 24;
    const x = Math.sin(bb) * Math.cos(a) * d;
    const y = Math.cos(bb) * d * 0.9;
    const z = Math.sin(bb) * Math.sin(a) * d;
    // tilt the band so it crosses the sky diagonally
    const ct = Math.cos(0.5);
    const st = Math.sin(0.5);
    put(sky, i, band ? x * ct - y * st : x, band ? x * st + y * ct : y, z, (band ? 0.7 : 0.9) + R() * (band ? 0.7 : 1.5), R(), 0);
  }
  const gates = [0, 1, 2].map(() => ringCloud(R, Math.round(520 * density), GATE.r, { jr: 0.012, jz: 0.012, s0: 2.3, s1: 3.5, spread: 3.2 }));
  return { density, mark, orbits, seventh, comm, sat, dial, sky, gates };
}
