// The director (Lumen: Orbit's, with the rail on the right edge and the satellites taking off from its Opportunities tick).
// Turns scroll position into a frame of the one scene. Nothing here moves text. Every station is a native column of entries; the director reads where
// those entries are (the reading line passes through them as you scroll) and moves the camera, the rings and the bodies to meet them. Everything is a
// pure function of (smoothed scroll, geometry, clock): no hysteresis.
import { Quaternion, Vector3 } from "three";
import { AUDIENCES } from "@/design-system/icons/glyphs";
import { MARK } from "@/design-system/logo/logo-data";
import { APPLY, AUDIENCE_GLYPH, COMMUNITY, EVENTS, EVENT_GLYPH, KIND_GLYPH, OPPORTUNITIES, STEP_GLYPH } from "@/lib/landing/content";
import { clamp, ease, lerp, sstep } from "./motion";
import { COMM, DIAL, GATE, GATE_C, ORBITS, SAT, SEVENTH, SPIRAL, SPIRAL_C, TAU, orbitPoint, ringPoint, seventhQuat, type Ring } from "./world";
import type { Cam } from "./cam";
import type { Body, Dock, Entry, Frame, FrameInput, FrameScroll, Geometry, Masked, Pose, Rect4, StageState, TextRect } from "./types";

const D = Math.PI / 180;
const lerpAngle = (a: number, b: number, t: number): number => a + ((((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI) * t;
const wrapPi = (a: number): number => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

export const STATIONS = ["hero", "who-we-are", "community", "opportunities", "events", "apply", "footer"];
export const ENTRY_SEL: Record<string, string> = { "who-we-are": ".role", community: ".member", opportunities: ".listing", events: ".event", apply: ".step" };
const HOST_SEL = ".role, .member, .listing, .step, .event, .head, .access, .ex, .picker, .cta, .hero-copy"; // the block whose mask (_m = 0) hides a rectangle
const RECT_SEL = ".hero-copy h1, .hero-copy .actions, .hero-copy .who-wrap, .head, .tx, .ev-tx, .access, .ex, .picker, .cta, .strip";

// The bodies in the scene wear the drawings of the words they stand for: the audiences, the four example members (an audience each), the three listings (a briefcase
// or a coin), the four events (their type), the three sign-up steps. They come from the same mappings the markup uses, so they cannot drift apart.
export const AUD_GLYPHS: string[] = AUDIENCES.map((a) => a.glyph);
export const MEMBER_GLYPHS: string[] = COMMUNITY.profiles.map((p) => AUDIENCE_GLYPH[p.audience]);
export const SAT_GLYPHS: string[] = OPPORTUNITIES.items.map((o) => KIND_GLYPH[o.kind]);
export const MOON_GLYPHS: string[] = EVENTS.items.map((e) => EVENT_GLYPH[e.type]);
export const GATE_GLYPHS: string[] = APPLY.steps.map((s) => STEP_GLYPH[s.id]);

const WHO_TILT = -112 * D; // the six orbit planes lie within ±12° of the horizontal
const WHO_YAW = 0.42; // the camera holds still through the six; the formation turns past it
const WHO_PHI = 72 * D; // the body in focus stands this far round from the camera's forward axis (front-right)
const WHO_PHI_C = 60 * D; // on a phone the orrery fills the width, so the body in focus stands nearer the front
const WHO_K = 1.25; // rad of formation turn per entry
const COMM_YAW = 0.42;
const COMM_K = Math.PI / 2;
const SAT_YAW = 0.2;
const SAT_K = TAU / 3;
const MOON_YAW = 0;
const MOON_K = Math.PI / 2;
const JOIN_SWEEP = 2.7; // rad the visitor travels along the seventh orbit when it is locked in (Join Foundry)
const CORE = [1, 0.78, 0.58, 0.54, 0.5, 0.86, 0.92]; // the warm core's strength at each settled station
const LT0 = [2.4, 2.48, 2.56]; // lift-off of the three satellites, in station coordinates
const LT1 = [2.86, 2.91, 2.96]; // and their landing
const Z = new Vector3(0, 0, 1);
const Y = new Vector3(0, 1, 0);
const gq = new Quaternion();

/** The real left/right extent of the words inside an element (blocks span their column, text does not). */
export function tightText(root: Element): { left: number; right: number } | null {
  let l = 1e9;
  let r = -1e9;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rg = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\S/.test(n.nodeValue ?? "")) continue;
    rg.selectNodeContents(n);
    for (const b of rg.getClientRects()) {
      if (b.width < 1) continue;
      l = Math.min(l, b.left);
      r = Math.max(r, b.right);
    }
  }
  return l < r ? { left: l, right: r } : null;
}

export interface DirectorEnv {
  /** Where the three satellites take off: the Opportunities tick of the rail (a point on the gauge on a phone). */
  launch?: () => { x: number; y: number; w: number } | undefined;
}

interface Spot {
  th: number;
  sign: number;
}

export interface Director {
  measure(st: StageState): Geometry;
  measureStatic(w: number, h: number, rects?: { left: number; right: number; top: number; bottom: number }[], copyRight?: number, railR?: number): Geometry;
  frame(st: FrameScroll, t: number, inp: FrameInput, camObj: Cam): Frame;
  readonly G: Geometry | null;
  focusIndex(list: Entry[], yr: number): number;
}

export function createDirector(root: HTMLElement, env: DirectorEnv = {}): Director {
  const v1 = new Vector3();
  const v2 = new Vector3();
  const tmpP = { x: 0, y: 0 };
  const trailPos = new Float32Array(96 * 3);
  const trailSize = new Float32Array(96);
  let G: Geometry | null = null; // measured geometry
  const g = (): Geometry => G as Geometry;

  // ── geometry from the DOM: entry centres, text rectangles, section tops ─────────────────────────────────────────
  function measure(st: StageState): Geometry {
    const vw = st.vw;
    const vh = st.vh;
    const compact = vw < 900;
    const sy = window.scrollY;
    const secTop = STATIONS.map((id) => st.byId[id]?.top ?? 0);
    const entries: Record<string, Entry[]> = {};
    for (const id of Object.keys(ENTRY_SEL)) {
      const sec = st.byId[id]?.el;
      entries[id] = sec
        ? [...sec.querySelectorAll<HTMLElement>(ENTRY_SEL[id])].map((el) => {
            const r = el.getBoundingClientRect();
            const txEl = el.querySelector<HTMLElement>(".tx, .ev-tx") ?? el;
            const tx = txEl.getBoundingClientRect();
            const tt = tightText(txEl);
            return { el, cy: r.top + sy + r.height / 2, top: r.top + sy, bottom: r.bottom + sy, left: r.left, right: r.right, txTop: tx.top + sy, txBottom: tx.bottom + sy, txLeft: tt ? tt.left : tx.left, txRight: tt ? tt.right : tx.right };
          })
        : [];
    }
    const rects: TextRect[] = [...root.querySelectorAll<HTMLElement>(RECT_SEL)]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, host: el.closest(HOST_SEL) as Masked | null, top: r.top + sy, bottom: r.bottom + sy, left: r.left, right: r.right };
      })
      .filter((r) => r.right - r.left > 8 && r.bottom - r.top > 8);
    // the rail is on the right edge: its width is what the scene gives up (a phone's is a 40 px gauge), and a phone's header is a bar the scene sits under
    const railR = root.querySelector("#rail")?.getBoundingClientRect().width ?? 0;
    const hdr = compact ? (root.querySelector("#nav")?.getBoundingClientRect().height ?? 0) : 0;
    const uw = vw - railR;
    // reading line per station (fraction of the viewport height) and whether the station's text lives in the bottom band
    const band = STATIONS.map((id) => compact || id === "community" || id === "apply");
    const RLs = STATIONS.map((id, k) => (band[k] ? 0.8 : 0.46));
    const hold = 0.12 * vh;
    // where each handoff starts: the reading line leaves the last entry's dwell (hero: after a short anticipation)
    const s0 = STATIONS.map((id, k) => {
      if (k === 0) return 0.16 * vh;
      const list = entries[id];
      if (id === "apply") {
        const cta = root.querySelector(".cta")?.getBoundingClientRect();
        if (cta) return cta.top + sy + cta.height / 2 - 0.7 * vh + hold;
      }
      if (list?.length) return list[list.length - 1].cy - RLs[k] * vh + hold;
      return secTop[k] + 0.2 * vh;
    });
    const ctaEl = root.querySelector(".cta")?.getBoundingClientRect();
    const ctaCy = ctaEl ? ctaEl.top + sy + ctaEl.height / 2 : null;
    const pk = root.querySelector(".picker")?.getBoundingClientRect();
    const pickerCy = pk ? pk.top + sy + pk.height / 2 : null;
    // the one action: its pill and its block, in page coordinates (the signal to the waiting visitor starts above the pill)
    const jb = root.querySelector("#join")?.getBoundingClientRect();
    const ch = root.querySelector(".cta")?.getBoundingClientRect();
    const ctaBox = jb ? { left: jb.left, right: jb.right, top: jb.top + sy, bottom: jb.bottom + sy } : null;
    const ctaHost = ch ? { left: ch.left, top: ch.top + sy } : null;
    // the small "Example" markers: on a phone each is a block of words that is only on while it is in the lower band, so each gets a stop of its own
    const exCy = [...root.querySelectorAll(".ex")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + sy + r.height / 2;
    });
    // where the three satellites take off: the Opportunities tick of the rail (a point on the gauge on a phone), fanned 8 px apart
    const lp = env.launch?.();
    const dock: Dock[] = lp ? [0, 1, 2].map((j) => ({ x: lp.x, y: lp.y + (j - 1) * 8, w: lp.w })) : [];
    // where the hero's words end (the real width of the lines, the button and the audience row): the hero's mark keeps its clear space from it
    let copyRight = 0;
    let copyTop = 0;
    {
      const h1 = root.querySelector(".hero-copy h1");
      const t = h1 && tightText(h1);
      if (h1) copyTop = h1.getBoundingClientRect().top + sy;
      if (t) copyRight = t.right;
      for (const q of [".hero-copy .btn", ".hero-copy .who-row"]) {
        const e = root.querySelector(q);
        if (e) copyRight = Math.max(copyRight, e.getBoundingClientRect().right);
      }
    }
    G = { vw, vh, compact, railR, uw, hdr, RLs, band, hold, T: secTop, entries, rects, s0, sy, dock, ctaCy, pickerCy, exCy, ctaBox, ctaHost, copyRight, copyTop };
    // the hero's formation and the rings' spotlights are solved against this geometry (where the words are, how wide the screen is): a new measurement, such as the one
    // after the web fonts settle, may move the words without changing the size of the screen, so they are solved again
    heroThetaCache.key = "";
    spot.key = "";
    return G;
  }

  /** The static page (reduced motion, no WebGL): geometry for one poster of w x h px, no DOM entries. rects: text the bodies keep clear of. */
  function measureStatic(w: number, h: number, rects: { left: number; right: number; top: number; bottom: number }[] = [], copyRight = 0, railR = 0): Geometry {
    const copyTop = rects.length && w < 900 ? Math.min(...rects.map((r) => r.top)) : 0; // a phone's hero: where its words start (the poster is full-bleed behind them)
    G = {
      vw: w, vh: h, compact: w < 900, railR, uw: w - railR, hdr: 0, RLs: STATIONS.map(() => 0.5), band: STATIONS.map(() => false), hold: 0.12 * h, T: STATIONS.map((_, i) => i * h), entries: {},
      rects: rects.map((r) => ({ el: { closest: () => true }, host: null, ...r })), s0: STATIONS.map(() => 0), sy: 0, dock: [], ctaCy: null, pickerCy: null, exCy: [], ctaBox: null, ctaHost: null, copyRight, copyTop,
    };
    return G;
  }

  // ── focus index: where the reading line sits among a station's entries; integer = dwelling on that entry ───────
  function focusIndex(list: Entry[], yr: number): number {
    const n = list.length;
    if (!n) return 0;
    const e0 = list[0].cy;
    if (yr <= e0) return -0.5 * clamp((e0 - yr) / (0.95 * g().vh));
    if (yr >= list[n - 1].cy) return n - 1;
    for (let k = 0; k < n - 1; k++) {
      const a = list[k].cy;
      const b = list[k + 1].cy;
      if (yr < b) {
        const lo = a + g().hold;
        const hi = b - g().hold;
        const w = hi > lo ? clamp((yr - lo) / (hi - lo)) : yr > (a + b) / 2 ? 1 : 0;
        return k + w;
      }
    }
    return n - 1;
  }

  // ── bodies on rings: each has a "spotlight" angle (the azimuth the camera likes) and the ring turns K per entry ───────
  const azimuth = (p: Vector3): number => Math.atan2(p.x, p.z);
  /** angle at which `at(th)` has azimuth `target`, and the sign of d(azimuth)/d(th) */
  function solveAz(at: (th: number, out: Vector3) => Vector3, target: number): Spot {
    let best = 0;
    let bd = 1e9;
    for (let s = 0; s < 1440; s++) {
      const th = (s / 1440) * TAU;
      const d = Math.abs(wrapPi(azimuth(at(th, v1)) - target));
      if (d < bd) {
        bd = d;
        best = th;
      }
    }
    const sign = Math.sign(wrapPi(azimuth(at(best + 0.05, v1)) - azimuth(at(best, v2)))) || 1;
    return { th: best, sign };
  }
  const whoSpot = ORBITS.map((_, i) => solveAz((th, o) => orbitPoint(i, th, 0, WHO_TILT, o), WHO_YAW + WHO_PHI));
  const whoSpotC = ORBITS.map((_, i) => solveAz((th, o) => orbitPoint(i, th, 0, WHO_TILT, o), WHO_YAW + WHO_PHI_C));
  const whoAt = (j: number, c: number): number => {
    const sp = g().compact ? whoSpotC[j] : whoSpot[j];
    return sp.th + sp.sign * WHO_K * (j - c);
  };
  // the other rings are steeper or wider: their spotlight is found on screen, at the station's own camera (see solveSpots())
  const spot = { comm: { th: 0, sign: 1 } as Spot, sat: { th: 0, sign: 1 } as Spot, moon: { th: 0, sign: 1 } as Spot, hold: 0, key: "" };
  const commAt = (m: number, c: number): number => spot.comm.th + spot.comm.sign * COMM_K * (m - c);
  const satAt = (j: number, c: number): number => spot.sat.th + spot.sat.sign * SAT_K * (j - c);
  const moonAt = (j: number, c: number): number => spot.moon.th + spot.moon.sign * MOON_K * (j - c);
  /** angle of the ring point that is extreme on screen: pick(sx, sy) returns the score to MAXIMISE. */
  function solveScreen(ring: Ring, cam: Cam, pose: Pose, pick: (x: number, y: number) => number): Spot {
    cam.set(pose, g().vw, g().vh);
    const tmp = { x: 0, y: 0 };
    const at = (th: number) => cam.toScreen(ringPoint(ring, th, v1), tmp);
    let best = 0;
    let bs = -1e9;
    for (let s = 0; s < 1440; s++) {
      const th = (s / 1440) * TAU;
      const p = at(th);
      const sc = pick(p.x, p.y);
      if (sc > bs) {
        bs = sc;
        best = th;
      }
    }
    return { th: best, sign: 1 };
  }
  function solveSpots(cam: Cam): void {
    const key = `${g().vw}x${g().vh}`;
    if (spot.key === key) return;
    const pc = POSES.community();
    const po = POSES.opportunities();
    const pe = POSES.events();
    // community: the front of the ring (lowest on screen); opportunities: its left ansa (nearest the text column); events: the right ansa
    spot.comm = solveScreen(COMM, cam, pc, (x, y) => y);
    spot.sat = solveScreen(SAT, cam, po, (x) => -x);
    spot.moon = solveScreen(DIAL, cam, pe, (x) => x);
    // direction: bodies must arrive from the far side and leave through the near side, i.e. the ring turns so the next body comes round the back
    spot.comm.sign = travel(COMM, cam, pc, spot.comm.th);
    spot.sat.sign = travel(SAT, cam, po, spot.sat.th);
    spot.moon.sign = travel(DIAL, cam, pe, spot.moon.th);
    // apply: the visitor waits at the right of the system, just outside the outermost orbit
    {
      const pa = POSES.apply();
      const q = seventhQuat(0, WHO_TILT);
      const tmp = { x: 0, y: 0 };
      cam.set(pa, g().vw, g().vh);
      let best = 0;
      let bs = -1e9;
      for (let s2 = 0; s2 < 720; s2++) {
        const th = (s2 / 720) * TAU;
        const p = cam.toScreen(v1.set(Math.cos(th) * SPIRAL.rHold, Math.sin(th) * SPIRAL.rHold, 0).applyQuaternion(q), tmp);
        const sc = p.x - 0.5 * Math.abs(p.y - pa.cy);
        if (sc > bs) {
          bs = sc;
          best = th;
        }
      }
      spot.hold = best;
    }
    spot.key = key;
  }
  /** +1 if increasing the angle moves the point so that the *next* body arrives from the back/top of the screen, else -1. */
  function travel(ring: Ring, cam: Cam, pose: Pose, th: number): number {
    cam.set(pose, g().vw, g().vh);
    const a = cam.toScreen(ringPoint(ring, th - 0.05, v1), { x: 0, y: 0 });
    const b = cam.toScreen(ringPoint(ring, th + 0.05, v2), { x: 0, y: 0 });
    // convention: bodies pass the spotlight moving "down" or "left→right" along the ring front; we want the successor to come from above/back, so it should
    // be located above (smaller y) the spotlight when it is one step behind. Evaluate where the point one step ahead in theta lies.
    return b.y < a.y ? 1 : -1;
  }

  const heroThetaCache: { key: string; th: number[] | null } = { key: "", th: null };
  /** Hero formation: the Phase 1 search, so all six sit clear of the words, the mark and the rail at the settled pose. */
  function heroTheta(cam: Cam, pose: Pose): number[] {
    const key = `${g().vw}x${g().vh}`;
    if (heroThetaCache.key === key && heroThetaCache.th) return heroThetaCache.th;
    cam.set(pose, g().vw, g().vh);
    const copy = g().rects.filter((r) => r.el.closest(".st-hero")).map((r) => [r.left - 50, r.top - 56, r.right + 40, r.bottom + 40]);
    const placed: [number, number][] = [];
    const out: number[] = [];
    const tmp = { x: 0, y: 0 };
    ORBITS.forEach((o, i) => {
      let best = 0;
      let bs = -1e9;
      for (let k = 0; k < 96; k++) {
        const th = (k / 96) * TAU;
        const s = cam.toScreen(orbitPoint(i, th, 0, 0, v1), tmp);
        const dm = Math.hypot(s.x - pose.cx, s.y - pose.cy);
        const nearMark = 1 - clamp((dm - pose.R * 1.18) / (pose.R * 0.5));
        const inCopy = copy.some((r) => s.x > r[0] && s.x < r[2] && s.y > r[1] && s.y < r[3]) ? 1 : 0;
        const margin = g().compact ? 90 : 70;
        const inView = s.x > 46 && s.x < g().uw - 30 && s.y > margin && s.y < g().vh - 52 ? 1 : 0;
        const nearCue = g().compact ? 0 : s.x < 200 && s.y > g().vh - 150 ? 1 : 0;
        let score = (1 - nearMark) * (1 - inCopy) * (1 - nearCue) * inView * 10;
        let nearest = 1e9;
        for (const q of placed) nearest = Math.min(nearest, Math.hypot(s.x - q[0], s.y - q[1]));
        score += 0.08 * Math.min(170, nearest);
        if (score > bs) {
          bs = score;
          best = th;
        }
      }
      out.push(best);
      const s = cam.toScreen(orbitPoint(i, best, 0, 0, v1), tmp);
      placed.push([s.x, s.y]);
    });
    heroThetaCache.key = key;
    heroThetaCache.th = out;
    return out;
  }

  // ── poses: camera and ring orientation at the settled state of each station ────────────────────────────────────
  const POSE_ID = ["hero", "who", "community", "opportunities", "events", "apply", "footer"] as const;
  type PoseFn = (c?: number) => Pose;
  const POSE_KEYS = ["yaw", "pitch", "R", "cx", "cy", "tilt", "flat"] as const;
  const mix = (A: Pose, B: Pose, t: number, out: Pose): Pose => {
    for (const k of POSE_KEYS) out[k] = lerp(A[k], B[k], t);
    return out;
  };
  // phones: the scene lives in the band between the header and the text band; R is capped by the height and the width
  const cpose = (o: Omit<Pose, "R" | "cx" | "cy">, Rv: number, Rw: number, f: number): Pose => {
    const R = Math.min(Rv * g().vh, Rw * g().uw);
    return { ...o, R, cx: 0.5 * g().uw, cy: Math.max(g().hdr + R * (MARK.top + 0.05) + 14, g().hdr + (0.55 * g().vh - g().hdr) * f) }; // the rocket rises MARK.top radii above the ring's centre: keep it under the header
  };
  const POSES: Record<(typeof POSE_ID)[number], PoseFn> = {
    hero: (): Pose => {
      const G_ = g();
      if (!G_.compact) {
        // the mark sits right of the words with at least a quarter of its diameter between them (measured from the circle that holds ring and rocket: 1.11 radii wide at the ring's
        // middle, 2.23 tall, so a quarter of that is 0.56 radii): at narrow desktop widths it slides right, and shrinks only when there is no room left
        let R = 0.2 * G_.vh;
        let cx = 0.7 * G_.uw - 38;
        if (G_.copyRight) {
          R = Math.min(R, (G_.uw - 20 - G_.copyRight) / 3.9);
          cx = Math.min(Math.max(cx, G_.copyRight + 1.72 * R), G_.uw - 1.3 * R - 20);
        }
        return { yaw: 0.42, pitch: 0.24, R, cx, cy: 0.5 * G_.vh, tilt: 0, flat: 0 };
      }
      // a landscape phone (short and wide): words left, the mark right, as on a desktop
      if (G_.vw > G_.vh * 1.25 && G_.vh < 560) {
        const R = Math.min(0.21 * G_.vh, 0.16 * G_.uw);
        return { yaw: 0.42, pitch: 0.24, R, cx: 0.72 * G_.uw, cy: 0.5 * G_.vh, tilt: 0, flat: 0 };
      }
      // a phone: the mark (ring and rocket, 2.23 radii tall) keeps a quarter of its own height clear above the hero's words, so on a short screen it shrinks and moves up under the pills
      const R0 = Math.min(0.13 * G_.vh, 0.28 * G_.uw);
      const R = G_.copyTop ? Math.min(R0, Math.max(30, (G_.copyTop - G_.hdr - 22) / 2.95)) : R0;
      const cy = R < R0 ? G_.hdr + 10 + R * (MARK.top + 0.03) : Math.max(G_.hdr + R * (MARK.top + 0.05) + 16, 0.33 * G_.vh);
      return { yaw: 0.42, pitch: 0.24, R, cx: 0.5 * G_.uw, cy, tilt: 0, flat: 0 };
    },
    who: (c = 0): Pose => {
      const yaw = WHO_YAW + Math.sin(c * 0.9) * 0.04;
      return g().compact
        ? cpose({ yaw, pitch: 0.5, tilt: WHO_TILT, flat: 0 }, 0.07, 0.135, 0.5)
        : { yaw, pitch: 0.3, R: 0.115 * g().vh, cx: 0.33 * g().uw, cy: 0.5 * g().vh, tilt: WHO_TILT, flat: 0 };
    },
    community: (): Pose =>
      g().compact
        ? cpose({ yaw: COMM_YAW, pitch: 0.62, tilt: WHO_TILT, flat: 0 }, 0.056, 0.11, 0.5)
        : { yaw: COMM_YAW, pitch: 0.56, R: 0.082 * g().vh, cx: 0.5 * g().uw, cy: 0.4 * g().vh, tilt: WHO_TILT, flat: 0 },
    opportunities: (): Pose =>
      g().compact
        ? cpose({ yaw: SAT_YAW, pitch: 0.34, tilt: WHO_TILT, flat: 0 }, 0.06, 0.12, 0.5)
        : { yaw: SAT_YAW, pitch: 0.34, R: 0.092 * g().vh, cx: 0.68 * g().uw, cy: 0.5 * g().vh, tilt: WHO_TILT, flat: 0 },
    events: (): Pose =>
      g().compact
        ? cpose({ yaw: MOON_YAW, pitch: 1.34, tilt: -Math.PI / 2, flat: 1 }, 0.055, 0.11, 0.5)
        : { yaw: MOON_YAW, pitch: 1.34, R: 0.082 * g().vh, cx: 0.36 * g().uw, cy: 0.5 * g().vh, tilt: -Math.PI / 2, flat: 1 },
    apply: (): Pose =>
      g().compact
        ? cpose({ yaw: 0.6, pitch: 0.4, tilt: WHO_TILT, flat: 0 }, 0.06, 0.12, 0.5)
        : { yaw: 0.6, pitch: 0.4, R: 0.085 * g().vh, cx: 0.5 * g().uw, cy: 0.34 * g().vh, tilt: WHO_TILT, flat: 0 },
    footer: (): Pose =>
      g().compact
        ? cpose({ yaw: 0.8, pitch: 0.3, tilt: WHO_TILT, flat: 0 }, 0.06, 0.13, 0.6)
        : { yaw: 0.8, pitch: 0.3, R: 0.09 * g().vh, cx: 0.5 * g().uw, cy: 0.4 * g().vh, tilt: WHO_TILT, flat: 0 },
  };
  const startC = (k: number): number => (k >= 1 && k <= 5 ? -0.5 : 0);
  const endC = (k: number, n: number): number => (k >= 1 && k <= 5 ? Math.max(0, n - 1) : 0);
  const poseOf = (k: number, c: number): Pose => POSES[POSE_ID[k]](c);

  // ── the frame ────────────────────────────────────────────────────────────────────────────────────────────────
  const F: Frame = {
    cam: { yaw: 0, pitch: 0, R: 100, cx: 0, cy: 0 }, tilt: 0, flat: 0, time: 0, build: 1, flow: 0, loose: 0, streak: 0, sdx: 0, sdy: 1, pulse: 0, sky: 1, markA: 1, skyYaw: 0, skyPitch: 0, core: 0, coreSwell: 0, railX: 0,
    k: 0, w: 0, c: 0, S: 0, n: 0,
    orbits: ORBITS.map(() => ({ a: 1, hi: 0, line: 0.1 })), seventh: { a: 0, hi: 0, line: 0, build: 1 }, comm: { a: 0, hi: 0, build: 0, line: 0 }, sat: { a: 0, hi: 0, build: 0, line: 0 }, dial: { a: 0, hi: 0, line: 0, build: 1 },
    bodies: [], trail: null, rects: [], tg: [], gates: [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, a: 0, hi: 0, build: 1 })), dock: [{ gone: false, press: 0 }, { gone: false, press: 0 }, { gone: false, press: 0 }], visitor: null,
  };
  const pA = {} as Pose;
  const pB = {} as Pose;
  const pM = {} as Pose;
  const bodyPool: Body[] = Array.from({ length: 48 }, () => ({ key: "", glyph: "", x: 0, y: 0, z: 0, size: 0.3, a: 0, hi: 0, halo: 0, haloK: 3, order: 0 }));
  const tmpS = { x: 0, y: 0, depth: 1 };
  let pooled = 0;
  const body = (key: string, glyph: string): Body => {
    const b = bodyPool[pooled++];
    b.key = key;
    b.glyph = glyph;
    b.haloK = 3;
    b.order = 0;
    b.hi = 0;
    b.halo = 0;
    b.a = 0;
    return b;
  };

  /** Where the viewport meets the cached text rectangles, in viewport px. */
  function visibleRects(sy: number): Rect4[] {
    const out: Rect4[] = [];
    for (const r of g().rects) {
      const t = r.top - sy;
      const b = r.bottom - sy;
      if (b < -40 || t > g().vh + 40) continue;
      if (r.host && r.host._m === 0) continue; // words that are switched off keep nothing clear
      out.push([r.left - 8, t - 6, r.right + 8, b + 6]);
    }
    return out;
  }

  /** Compute the frame. st: scroll state; t: clock (s); inp: { focusAud, build, entrance, drift, flowOn }. */
  function frame(st: FrameScroll, t: number, inp: FrameInput, camObj: Cam): Frame {
    pooled = 0;
    F.tg = [];
    F.trail = null;
    F.visitor = null;
    const { vw, vh } = g();
    const ys = st.ys;
    const last = STATIONS.length - 1;
    const force = inp.force; // a poster: station k settled, focus c, pose placed by the caller (the static page)
    let k = 0;
    let w = 0;
    let c = 0;
    if (force) {
      k = force.k;
      c = force.c;
    } else {
      for (let i = 0; i < g().T.length; i++) if (ys >= g().T[i] - 1) k = i;
      if (k < last && ys > g().s0[k]) w = clamp((ys - g().s0[k]) / Math.max(1, g().T[k + 1] - g().s0[k]));
    }
    const S = k + w;
    const RL = g().RLs[k];
    const yr = ys + RL * vh;
    const list = g().entries[STATIONS[k]] ?? [];
    if (!force) c = focusIndex(list, yr);
    F.k = k;
    F.w = w;
    F.c = c;
    F.S = S;
    F.n = list.length;

    // pose
    let P: Pose;
    if (w > 0 && k < last) {
      const Aend = Object.assign(pA, poseOf(k, endC(k, list.length)));
      const Bp = Object.assign(pB, poseOf(k + 1, startC(k + 1)));
      P = mix(Aend, Bp, ease.inOutCubic(w), pM);
    } else P = Object.assign(pA, poseOf(k, c));
    if (force?.pose) Object.assign(P, force.pose);

    const build = inp.build;
    const dolly = lerp(1 / 1.5, 1, ease.outCubic(clamp(inp.entrance)));
    const parX = st.pointer.sx;
    const parY = st.pointer.sy;
    F.cam.yaw = P.yaw + parX * 0.06 + inp.drift * 0.07 * Math.sin(t * 0.19);
    F.cam.pitch = P.pitch - parY * 0.035 + inp.drift * 0.03 * Math.sin(t * 0.15 + 1);
    F.cam.R = P.R * dolly;
    F.cam.cx = P.cx;
    F.cam.cy = P.cy;
    F.tilt = P.tilt;
    F.flat = P.flat;
    F.time = t;
    F.build = build;
    F.flow = inp.flowOn ? t * 0.012 : 0.4;
    F.railX = g().compact ? 1e5 : g().uw; // dust dims over the rail's zone (a desktop); a phone's rail is a hairline gauge and keeps nothing clear
    const speed = Math.min(1, Math.abs(st.vel) / 3200);
    F.streak = speed * speed;
    F.sdx = 0;
    F.sdy = 1;
    F.loose = speed > 0.12 ? (speed - 0.12) * (speed - 0.12) * 1.4 : 0;
    F.loose = Math.max(F.loose, 0.55 * sstep(4.9, 5.25, S) * (1 - sstep(5.55, 5.95, S))); // the stars of the mark stir as the visitor arrives and settle again by the footer
    F.skyYaw = -F.cam.yaw * 0.08;
    F.skyPitch = 0;
    // the warm core: the mark's own light behind the ring. Brightest where the page is about the mark (hero, apply, footer), quieter while the rings
    // carry the story; it ignites as the stars condense, breathes on a slow clock (11 s) and swells when Join locks the visitor in.
    F.core = lerp(CORE[k], CORE[Math.min(k + 1, last)], sstep(0, 1, w)) * sstep(0.3, 1, inp.build) * (1 + inp.drift * 0.05 * Math.sin(t * 0.57));
    F.coreSwell = inp.join?.flash ?? 0;
    camObj.set({ yaw: F.cam.yaw, pitch: F.cam.pitch, R: F.cam.R, cx: F.cam.cx, cy: F.cam.cy }, vw, vh);
    const rr = visibleRects(st.y);
    F.rects = rr;

    // ── ring visibility by station coordinate S ─────────────────────────────────────────────────────────────
    const inWho = k === 1 && w < 0.5 && c >= 0;
    for (let i = 0; i < 6; i++) {
      const o = F.orbits[i];
      let hi = 0;
      let a = 1;
      if (inWho) {
        const on = clamp(1 - Math.abs(c - i));
        hi = on;
        a = lerp(0.42, 1, on);
      } else if (S < 1 && inp.focusAud >= 0) {
        hi = inp.focusAud === i ? 1 : 0;
        a = inp.focusAud === i ? 1 : 0.35;
      } else if (S > 1.5) a = lerp(1, 0.5, sstep(1.5, 2.2, S));
      if (S > 3.6) a = lerp(a, 0.9, sstep(3.6, 4.3, S)); // events: the orbits become the dial's tracks
      if (S > 4.7) a = lerp(a, 0.55, sstep(4.7, 5.4, S));
      o.a = a;
      o.hi = hi;
      o.line = S < 1 ? (inp.focusAud >= 0 ? (inp.focusAud === i ? 0.5 : 0.04) : 0.1) : 0.07 + hi * 0.4;
    }
    // community ring condenses out of the dust as the camera arrives, then recedes
    const commA = sstep(1.35, 1.95, S) * (1 - sstep(2.5, 3.1, S) * 0.62) * (1 - sstep(4.1, 4.6, S));
    F.comm.a = commA;
    F.comm.build = sstep(1.3, 1.95, S);
    F.comm.hi = k === 2 && w < 0.5 && c >= 0 ? 0.25 : 0;
    F.comm.line = 0.1 * commA;
    // satellites ring: three bodies launched from the rail's Opportunities tick
    const satA = sstep(2.4, 2.8, S) * (1 - sstep(3.55, 4.2, S) * 0.85);
    F.sat.a = satA;
    F.sat.build = sstep(2.45, 2.98, S);
    F.sat.hi = 0;
    F.sat.line = 0.1 * satA;
    // the dial
    const dialA = sstep(3.45, 4.0, S) * (1 - sstep(4.4, 4.95, S));
    F.dial.a = dialA;
    F.dial.hi = 0;
    F.dial.line = 0.14 * dialA;
    F.dial.build = 1;
    F.seventh.a = 0;
    F.seventh.line = 0;

    // ── bodies ─────────────────────────────────────────────────────────────────────────────────────────────────
    const hero = heroTheta(camObj, POSES.hero());
    solveSpots(camObj);
    camObj.set({ yaw: F.cam.yaw, pitch: F.cam.pitch, R: F.cam.R, cx: F.cam.cx, cy: F.cam.cy }, vw, vh);
    const appear = ease.outCubic(clamp((build - 0.55) / 0.35));
    // bodies and labels give way to the whole mark: the circle that holds ring and rocket (MARK.rho radii, MARK.c above the ring's centre)
    const markDisc = (sc: { x: number; y: number }, pad = 1.0): number => 1 - clamp((Math.hypot(sc.x - F.cam.cx, sc.y - (F.cam.cy - MARK.c * F.cam.R)) - MARK.rho * F.cam.R * pad) / (F.cam.R * 0.55));
    const keepClear = (sc: { x: number; y: number }, nearMark: number): number => {
      let keep = lerp(1, 0.06, nearMark);
      for (const r of rr) if (sc.x > r[0] - 34 && sc.x < r[2] + 34 && sc.y > r[1] - 34 && sc.y < r[3] + 34) keep *= 0.04;
      if (!g().compact && sc.x > g().uw - 50) keep *= clamp((g().uw - sc.x) / 50);
      // nothing is left half-cut by the edge of the screen (or sitting under a phone's pills): a body fades over the last 20 px before it
      const em = 20;
      const top = g().compact ? g().hdr - 6 : 0;
      keep *= clamp((sc.x - em * 0.5) / em) * clamp((g().vw - em * 0.5 - sc.x) / em) * clamp((sc.y - top - em * 0.5) / em) * clamp((g().vh - em * 0.5 - sc.y) / em);
      return keep;
    };
    const target = (i: number, sc: { x: number; y: number; depth: number }, b: Body, keep: number): void => {
      F.tg[i] = { x: sc.x, y: sc.y, r: (b.size * camObj.pxPerUnit(sc.depth)) / 2, a: keep };
    };

    // the six audience bodies
    for (let i = 0; i < 6; i++) {
      const b = body(`aud${i}`, AUD_GLYPHS[i]);
      let th = k === 0 ? lerpAngle(hero[i], whoAt(i, startC(1)), ease.inOutCubic(w)) : whoAt(i, k === 1 ? Math.min(c, 5) : 5);
      // idle life in the hero: each body swings a few degrees along its own orbit (31 s period, out of step with its neighbours) and settles as the page scrolls away
      if (k === 0) th += (1 - w) * inp.drift * 0.09 * Math.sin(t * 0.2 + i * 1.7);
      orbitPoint(i, th, F.flat, F.tilt, v2);
      b.x = v2.x;
      b.y = v2.y;
      b.z = v2.z;
      const sc = camObj.toScreen(v2, tmpS);
      let size = g().compact ? 0.4 : 0.36;
      let a = 0.95;
      let on = 0;
      if (inWho) {
        on = clamp(1 - Math.abs(c - i) * 1.4);
        size *= 1 + on * 0.55;
        a = lerp(0.4, 1, on);
      }
      if (S < 1 && inp.focusAud === i) {
        on = 1;
        size *= 1.28;
      }
      if (S > 1.5) a = lerp(a, 0.42, sstep(1.5, 2.1, S));
      const keep = keepClear(sc, markDisc(sc));
      b.size = size * lerp(1, 0.78, sstep(1.5, 2.2, S));
      b.a = a * keep * appear;
      b.hi = on;
      b.halo = 0.18 + on * 0.3;
      if (k === 1) target(i, sc, b, keep);
    }
    // the four example members on their own tilted ring
    if (commA > 0.01) {
      const cc = k === 2 ? Math.max(c, -0.5) : k < 2 ? -0.5 : 3;
      for (let m = 0; m < 4; m++) {
        const b = body(`mem${m}`, MEMBER_GLYPHS[m]);
        ringPoint(COMM, commAt(m, cc), v2);
        b.x = v2.x;
        b.y = v2.y;
        b.z = v2.z;
        const sc = camObj.toScreen(v2, tmpS);
        const on = k === 2 && w < 0.5 ? clamp(1 - Math.abs(c - m) * 1.4) : 0;
        const keep = keepClear(sc, markDisc(sc));
        const mt = inp.matches?.[m] ?? 0;
        b.size = (g().compact ? 0.46 : 0.44) * (1 + on * 0.5 + mt * 0.1);
        b.a = commA * lerp(0.5 + 0.3 * mt, 1, on) * keep;
        b.hi = Math.max(lerp(0.35, 1, on), 0.35 + 0.55 * mt);
        b.halo = 0.2 + on * 0.35 + mt * 0.22;
        b.haloK = 3.2;
        if (k === 2) target(m, sc, b, keep);
      }
    }
    // the three listing satellites: they lift off the rail's Opportunities tick (S 2.4 to 2.96), arc across the scene and take their ring
    {
      const cc = k === 3 ? Math.max(c, -0.5) : k < 3 ? -0.5 : 2;
      let tn = 0;
      for (let j = 0; j < 3; j++) {
        const u = clamp((S - LT0[j]) / (LT1[j] - LT0[j]));
        const dk = g().dock[j];
        F.dock[j].gone = u > 0 && !!dk;
        F.dock[j].sock = u > 0 ? 1 - sstep(LT1[j] + 0.1, LT1[j] + 0.7, S) : 0; // the empty socket shows for the launch, then goes
        F.dock[j].press = u > 0 ? 0 : sstep(LT0[j] - 0.18, LT0[j], S);
        if (u <= 0 && satA <= 0.01) continue;
        const b = body(`sat${j}`, SAT_GLYPHS[j]);
        ringPoint(SAT, satAt(j, cc), v2);
        b.x = v2.x;
        b.y = v2.y;
        b.z = v2.z;
        const sc = camObj.toScreen(v2, tmpS);
        const on = k === 3 && w < 0.5 ? clamp(1 - Math.abs(c - j) * 1.4) : 0;
        const keep = keepClear(sc, markDisc(sc));
        const sizeRing = (g().compact ? 0.46 : 0.42) * (1 + on * 0.5);
        const aRing = satA * lerp(0.55, 1, on) * keep;
        b.size = sizeRing;
        b.a = aRing;
        b.hi = lerp(0.2, 1, on);
        b.halo = 0.2 + on * 0.3;
        if (u > 0 && u < 1 && dk) {
          const e = ease.outCubic(u);
          const Ax = dk.x;
          const Ay = dk.y;
          const Bx = sc.x;
          const By = sc.y;
          const dx = Bx - Ax;
          const dy = By - Ay;
          const L = Math.max(1, Math.hypot(dx, dy));
          let nx = dy / L;
          let ny = -dx / L;
          if (ny > 0 || (Math.abs(ny) < 0.3 && nx < 0)) {
            nx = -nx;
            ny = -ny;
          }
          const bulge = 0.26 * L * (j === 1 ? 0.7 : 1);
          const Cx = Ax + dx * 0.28 + nx * bulge;
          const Cy = Ay + dy * 0.28 + ny * bulge;
          const at = (ee: number, out: { x: number; y: number }) => {
            const m = 1 - ee;
            out.x = m * m * Ax + 2 * m * ee * Cx + ee * ee * Bx;
            out.y = m * m * Ay + 2 * m * ee * Cy + ee * ee * By;
            return out;
          };
          const p = at(e, tmpP);
          const depth = lerp(camObj.dist, sc.depth, e);
          camObj.fromScreen(p.x, p.y, depth, v2);
          b.x = v2.x;
          b.y = v2.y;
          b.z = v2.z;
          b.size = lerp(dk.w / camObj.pxPerUnit(camObj.dist), sizeRing, e);
          const land = sstep(0.82, 1, u);
          b.a = lerp(1, aRing, land);
          b.hi = lerp(0.12, b.hi, land);
          b.halo = lerp(0.34, b.halo, land);
          b.haloK = 3.6;
          // the comet tail: earlier moments of the same flight
          for (let q = 1; q <= 14 && tn < 96; q++) {
            const ee = ease.outCubic(clamp(u - q * 0.03));
            if (ee <= 0) break;
            const tp = at(ee, tmpP);
            camObj.fromScreen(tp.x, tp.y, lerp(camObj.dist, sc.depth, ee), v2);
            trailPos[tn * 3] = v2.x;
            trailPos[tn * 3 + 1] = v2.y;
            trailPos[tn * 3 + 2] = v2.z;
            trailSize[tn] = (9 - q * 0.5) * (1 - sstep(0.72, 1, u) * 0.85);
            tn++;
          }
        } else if (u <= 0 && dk) {
          // not yet launched: the sprite waits under the rail's tick (hidden until lift-off)
          b.a = 0;
        }
        if (k === 3) target(j, sc, b, keep);
      }
      if (tn) F.trail = { n: tn, pos: trailPos, size: trailSize, a: 0.85, hi: 0.25 };
    }
    // the four event moons on the dial
    if (dialA > 0.01) {
      const cc = k === 4 ? Math.max(c, -0.5) : k < 4 ? -0.5 : 3;
      for (let j = 0; j < 4; j++) {
        const b = body(`moon${j}`, MOON_GLYPHS[j]);
        ringPoint(DIAL, moonAt(j, cc), v2);
        b.x = v2.x;
        b.y = v2.y;
        b.z = v2.z;
        const sc = camObj.toScreen(v2, tmpS);
        const on = k === 4 && w < 0.5 ? clamp(1 - Math.abs(c - j) * 1.4) : 0;
        const keep = keepClear(sc, markDisc(sc));
        b.size = (g().compact ? 0.46 : 0.44) * (1 + on * 0.5);
        b.a = dialA * lerp(0.55, 1, on) * keep;
        b.hi = lerp(0.15, 1, on);
        b.halo = 0.2 + on * 0.3;
        if (k === 4) target(j, sc, b, keep);
      }
    }

    // ── apply: the visitor spirals in through three gates, then waits for the one action; "joined" locks it beside the six ──
    {
      const j = inp.join ?? { p: 0, pulse: 0, flash: 0 };
      const enter = sstep(4.72, 4.98, S);
      const q7 = seventhQuat(F.flat, F.tilt);
      const SP = g().compact ? SPIRAL_C : SPIRAL;
      const GT = g().compact ? GATE_C : GATE;
      const gu = GT.u;
      const pathAt = (u: number, out: Vector3): Vector3 => {
        const e = Math.max(0, 1 - u);
        const r = SP.rHold + (SP.rFar - SP.rHold) * Math.pow(e, 1.5);
        const th = spot.hold - SP.turn * Math.pow(e, 1.2);
        return out.set(Math.cos(th) * r, Math.sin(th) * r, 0).applyQuaternion(q7);
      };
      let u: number;
      if (k === 5 && w < 1) {
        const lastDwell = list.length ? list[list.length - 1].cy - g().RLs[5] * vh + g().hold : 0;
        const qq = g().s0[5] > lastDwell ? clamp((ys - lastDwell) / (g().s0[5] - lastDwell)) : 1;
        // the visitor stands inside gate g while step g has the reading line, and travels between gates in between
        const base = c <= 0 ? lerp(gu[0] - 0.15, gu[0], clamp((c + 0.5) / 0.5)) : c <= 1 ? lerp(gu[0], gu[1], c) : lerp(gu[1], gu[2], clamp(c - 1));
        u = base + (1 - gu[2]) * qq;
      } else if (k >= 6) u = 1;
      else u = lerp(-0.22, gu[0] - 0.15, enter);
      const joinedP = j.p;
      const showApply = S > 4.7;
      const gA = enter * (1 - sstep(5.25, 5.9, S));
      // the seventh orbit: a faint cool path until the visitor takes it, then a warm flash that settles
      F.seventh.a = showApply ? (joinedP > 0 ? 1 : 0.5 * enter * (1 - 0.55 * sstep(5.5, 5.95, S))) : 0;
      F.seventh.hi = joinedP > 0 ? 0.25 + 0.75 * j.flash : 0;
      F.seventh.line = showApply ? (joinedP > 0 ? 0.22 : 0.08 * enter) : 0;
      // gates
      for (let gi = 0; gi < 3; gi++) {
        const o = F.gates[gi];
        pathAt(gu[gi], v1);
        pathAt(gu[gi] + 0.012, v2);
        o.x = v1.x;
        o.y = v1.y;
        o.z = v1.z;
        v2.sub(v1).normalize();
        gq.setFromUnitVectors(Z, v2);
        o.qx = gq.x;
        o.qy = gq.y;
        o.qz = gq.z;
        o.qw = gq.w;
        const passed = joinedP > 0 ? 1 : sstep(gu[gi] - 0.035, gu[gi] + 0.035, u);
        const on = k === 5 && w < 0.5 ? clamp(1 - Math.abs(c - gi) * 1.4) : 0;
        o.a = gA * lerp(0.5, 0.95, Math.max(passed, on));
        o.hi = Math.max(passed * 0.85, on);
        o.build = sstep(4.68, 5.0, S);
        if (!showApply) {
          o.a = 0;
          continue;
        }
        // the step's glyph rides the gate's rim at its highest point on screen
        let top: Vector3 | null = null;
        let ty = 1e9;
        for (let n = 0; n < 24; n++) {
          const a = (n / 24) * TAU;
          v2.set(Math.cos(a) * GATE.r, Math.sin(a) * GATE.r, 0).applyQuaternion(gq).add(v1.set(o.x, o.y, o.z));
          const sc2 = camObj.toScreen(v2, tmpS);
          if (sc2.y < ty) {
            ty = sc2.y;
            top = v2.clone();
          }
        }
        const rim = top as Vector3;
        const b = body(`gate${gi}`, GATE_GLYPHS[gi]);
        b.x = rim.x;
        b.y = rim.y;
        b.z = rim.z;
        const sc = camObj.toScreen(rim, tmpS);
        const keep = keepClear(sc, markDisc(sc));
        b.size = (g().compact ? 0.5 : 0.46) * (1 + on * 0.45);
        b.a = gA * lerp(0.6, 1, Math.max(passed, on)) * keep;
        b.hi = Math.max(passed * 0.9, on);
        b.halo = 0.18 + on * 0.3;
        if (k === 5) target(gi, sc, b, keep);
      }
      // the visitor: a plain ring
      if (showApply) {
        const b = body("visitor", "ring");
        if (joinedP > 0) {
          const e = ease.inOutCubic(joinedP);
          const r = lerp(SPIRAL.rHold, SEVENTH.r, e);
          const th = spot.hold + JOIN_SWEEP * e; // a long sweep inward, ending on the side of the orbit that is clear of the mark
          v1.set(Math.cos(th) * r, Math.sin(th) * r, 0).applyQuaternion(q7);
        } else {
          pathAt(u, v1);
          if (u >= 1) v1.applyAxisAngle(Y, Math.sin(t * 0.33) * 0.05);
        }
        b.x = v1.x;
        b.y = v1.y;
        b.z = v1.z;
        const sc = camObj.toScreen(v1, tmpS);
        b.size = (g().compact ? 0.5 : 0.46) * (1 + (joinedP > 0 ? 0.12 * (1 - joinedP) : 0));
        b.a = enter * keepClear(sc, markDisc(sc));
        b.hi = 1;
        b.halo = 0.4 + 0.5 * j.flash;
        b.haloK = 4;
        b.order = 3;
        F.visitor = { x: sc.x, y: sc.y, r: (b.size * camObj.pxPerUnit(sc.depth)) / 2, a: b.a, p: joinedP }; // where the visitor is on screen: the closing action points at it
        // the dust it sheds along the spiral
        if (joinedP <= 0) {
          let n2 = 0;
          for (let q = 0; q < 90; q++) {
            const uu = u - q * 0.0085;
            if (uu < -0.25) break;
            pathAt(uu, v2);
            trailPos[n2 * 3] = v2.x;
            trailPos[n2 * 3 + 1] = v2.y;
            trailPos[n2 * 3 + 2] = v2.z;
            trailSize[n2] = (6.8 - q * 0.05) * (0.35 + 0.65 * (1 - q / 90));
            n2++;
          }
          F.trail = { n: n2, pos: trailPos, size: trailSize, a: 0.7 * enter, hi: 0.5 };
        }
      }
    }
    // declutter: the body the words are about is never shared with a dim body that happens to pass behind it
    {
      const items: { b: Body; x: number; y: number; d: number }[] = [];
      for (let i = 0; i < pooled; i++) {
        const b = bodyPool[i];
        if (b.a < 0.02) continue;
        const sc = camObj.toScreen(v1.set(b.x, b.y, b.z), tmpS);
        items.push({ b, x: sc.x, y: sc.y, d: b.size * camObj.pxPerUnit(sc.depth) });
      }
      for (const L of items) {
        if (L.b.hi < 0.85) continue;
        for (const O of items) {
          if (O === L || O.b.hi >= 0.6) continue;
          const reach = (L.d + O.d) * 0.5;
          const dist = Math.hypot(L.x - O.x, L.y - O.y);
          if (dist < reach * 1.6) O.b.a *= 0.03 + 0.97 * sstep(0.8, 1.6, dist / reach);
        }
      }
    }
    F.bodies = bodyPool.slice(0, pooled);
    F.pulse = inp.join?.pulse ?? 0;
    return F;
  }

  return {
    measure,
    measureStatic,
    frame,
    get G() {
      return G;
    },
    focusIndex,
  };
}
