// The WebGL painter (Lumen: Orbit's, lit in Aperture's colours: amber core behind the mark, amber halos, cream on a lit glyph).
// One canvas, one renderer, a handful of draw calls. It owns no story logic: the director hands it a frame (camera pose, per-group alpha and
// highlight, body list) and it draws exactly that. Colours are read from the CSS tokens. Everything it creates is released by `dispose()`.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, LineBasicMaterial, LineLoop, Points, Quaternion, SRGBColorSpace, Scene, ShaderMaterial,
  Sprite, SpriteMaterial, Vector2, Vector3, Vector4, WebGLRenderer, type Material, type Texture,
} from "three";
import { MARK } from "@/design-system/logo/logo-data";
import { Cam } from "./cam";
import type { GlyphArt } from "./glyph-art";
import { CORE_PEAK, CORE_SPAN, cssColor, rawColor, srgb } from "./palette";
import { ORBITS, SEVENTH, COMM, SAT, DIAL, TAU, orbitQuat, seventhQuat, type Cloud, type World } from "./world";
import type { Frame } from "./types";

const N_RECTS = 6;

const VERT = /* glsl */ `
  attribute vec3 aStart; attribute float aSize, aPhase, aDelay;
  uniform float uTime, uPR, uRef, uBuild, uAlpha, uHiAmt, uKind, uFlow, uStreak, uLoose, uPulse, uPulseW, uMarkR, uMid, uRailX;
  uniform vec3 uCol, uHi; uniform vec2 uRes, uMarkC; uniform vec4 uCopy[${N_RECTS}];
  varying vec3 vCol; varying float vA, vS;
  float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  void main() {
    float t = clamp(uBuild * 1.6 - aDelay * 0.6, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - t, 3.0);
    vec3 p = mix(aStart, position, e);
    if (abs(uKind - 1.0) < 0.5) { float c = cos(uFlow), s = sin(uFlow); p.xy = vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
    if (uKind < 0.5 && uLoose > 0.001) p += (vec3(h11(aPhase * 91.7), h11(aPhase * 37.3), h11(aPhase * 11.9)) - 0.5) * uLoose * 0.07;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    float pulse = 0.0;
    if (uPulse > 0.0 && uKind > 0.5) {
      float d = length(wp.xyz), front = uPulse * 34.0;
      float q = (d - front) / uPulseW;
      pulse = exp(-q * q);
      wp.xyz += normalize(wp.xyz + vec3(0.0001)) * pulse * 0.16;
    }
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    float stretch = uKind > 0.5 ? 1.0 + uStreak * 2.6 : 1.0;
    vS = stretch;
    gl_PointSize = max(1.0, aSize * uPR * (uRef / depth) * stretch * (1.0 + pulse * 0.9));
    float tw = 0.86 + 0.14 * sin(uTime * 0.72 + aPhase * 6.2832);
    float fade = clamp(1.0 - 0.9 * (depth - uMid) / uMid, 0.3, 1.0);
    vec2 sp = (gl_Position.xy / gl_Position.w * 0.5 + 0.5) * uRes; sp.y = uRes.y - sp.y;
    float mask = 1.0;
    if (uKind > 0.5) {
      mask *= smoothstep(1.02, 1.5, length(sp - uMarkC) / max(uMarkR, 1.0));
      mask *= mix(1.0, 0.2, smoothstep(uRailX - 6.0, uRailX + 26.0, sp.x));  // the rail is on the right edge: the dust gives way to it
      for (int i = 0; i < ${N_RECTS}; i++) {
        vec4 r = uCopy[i];
        float ax = smoothstep(r.x - 26.0, r.x + 26.0, sp.x) * (1.0 - smoothstep(r.z - 26.0, r.z + 26.0, sp.x));
        float ay = smoothstep(r.y - 26.0, r.y + 26.0, sp.y) * (1.0 - smoothstep(r.w - 26.0, r.w + 26.0, sp.y));
        mask *= mix(1.0, 0.08, ax * ay);
      }
    }
    vCol = mix(uCol, uHi, uHiAmt);
    float base = uKind < 0.5 ? 0.97 : 0.9;
    vA = base * uAlpha * tw * (uKind < 0.5 ? 1.0 : fade) * mask * (1.0 + pulse * 1.6) * smoothstep(0.0, 0.25, t);
  }`;
const FRAG = /* glsl */ `
  precision highp float; varying vec3 vCol; varying float vA, vS; uniform vec2 uSDir;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float along = dot(c, uSDir), across = dot(c, vec2(-uSDir.y, uSDir.x));
    float d = length(vec2(along, across * vS));
    if (d > 0.5) discard;
    // smoothstep() is undefined when edge0 >= edge1, so the soft edge is 1 - smoothstep(0.18, 0.5, d): the same curve (smoothstep is point-symmetric about its middle)
    gl_FragColor = vec4(vCol, vA * (1.0 - smoothstep(0.18, 0.5, d)));
  }`;

/** The roundel's own ground: the void colour, solid out to 1.02 mark radii, fading to nothing at 1.5 (the same band the dust is masked in). */
function groundCanvas(color: Color): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  const h = color.getHex();
  const [r, gr, b] = [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  grd.addColorStop(0, srgb(r, gr, b, 1));
  grd.addColorStop(1.02 / 1.5, srgb(r, gr, b, 1));
  grd.addColorStop(1, srgb(r, gr, b, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return cv;
}

function haloCanvas(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, srgb(255, 255, 255, 0.9));
  grd.addColorStop(0.35, srgb(255, 255, 255, 0.28));
  grd.addColorStop(1, srgb(255, 255, 255, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return cv;
}

/** The warm core as light: a grey ramp (the material tints it amber and sets its strength). The peak sits low in the disc, behind the exhaust; a faint bloom reaches past the ring.
 *  The texture spans CORE_SPAN mark radii. A whisper of noise breaks up 8-bit banding in the dark ramp. */
function coreCanvas(): HTMLCanvasElement {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const u = S / CORE_SPAN;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "lighter";
  const bloom = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  bloom.addColorStop(0, srgb(255, 255, 255, 0.36));
  bloom.addColorStop((1 / CORE_SPAN) * 2, srgb(255, 255, 255, 0.26));
  bloom.addColorStop(0.6, srgb(255, 255, 255, 0.09));
  bloom.addColorStop(1, srgb(255, 255, 255, 0));
  g.fillStyle = bloom;
  g.fillRect(0, 0, S, S);
  const cy = S / 2 + 0.34 * u;
  const inner = g.createRadialGradient(S / 2, cy, 0, S / 2, cy, 1.15 * u);
  inner.addColorStop(0, srgb(255, 255, 255, 0.78));
  inner.addColorStop(0.55, srgb(255, 255, 255, 0.43));
  inner.addColorStop(1, srgb(255, 255, 255, 0));
  g.fillStyle = inner;
  g.fillRect(0, 0, S, S);
  const d = g.getImageData(0, 0, S, S);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * 2.2;
    px[i] = Math.max(0, px[i] + n);
    px[i + 1] = Math.max(0, px[i + 1] + n);
    px[i + 2] = Math.max(0, px[i + 2] + n);
    px[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return cv;
}

export interface GL {
  render(F: Frame, w: number, h: number, dprMax: number): void;
  cam: Cam;
  dispose(): void;
}

type Pts = Points<BufferGeometry, ShaderMaterial>;

/**
 * Create the renderer on `canvas`. `own` is told how to release it the moment it exists, so an abort at any point of the (asynchronous) setup
 * frees whatever has been made so far. `scope` is the element the colour tokens are defined on.
 */
export async function createGL(canvas: HTMLCanvasElement, world: World, glyphNames: string[], art: GlyphArt, scope: Element, own: (dispose: () => void) => void): Promise<GL> {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  const geoms: BufferGeometry[] = [];
  const mats: Material[] = [];
  const texs: Texture[] = [];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const x of [...geoms, ...mats, ...texs]) x.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  own(dispose);

  const tex = (cv: HTMLCanvasElement, anisotropy = 1): CanvasTexture => {
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = anisotropy;
    texs.push(t);
    if (disposed) t.dispose();
    return t;
  };
  const scene = new Scene();
  const cam = new Cam();
  const cool = cssColor(scope, "--cool");
  const warm = cssColor(scope, "--warm");
  const sun = cssColor(scope, "--sun");
  const white = cssColor(scope, "--star");
  const warmRaw = rawColor(scope, "--warm");
  renderer.setClearColor(cssColor(scope, "--void"), 1);

  // uniforms every points material shares
  const shared = {
    uTime: { value: 0 }, uPR: { value: 1 }, uRef: { value: 8 }, uMid: { value: 8 }, uRes: { value: new Vector2(1, 1) },
    uMarkC: { value: new Vector2() }, uMarkR: { value: 1 }, uRailX: { value: 0 }, uStreak: { value: 0 }, uSDir: { value: new Vector2(0, 1) },
    uLoose: { value: 0 }, uPulse: { value: 0 }, uPulseW: { value: 1.6 },
    uCopy: { value: Array.from({ length: N_RECTS }, () => new Vector4(-999, -999, -999, -999)) },
  };
  const makeMat = (kind: number, col: Color): ShaderMaterial => {
    const m = new ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...shared, uKind: { value: kind }, uBuild: { value: 1 }, uAlpha: { value: 1 }, uHiAmt: { value: 0 }, uFlow: { value: 0 }, uCol: { value: col.clone() }, uHi: { value: warmRaw.clone() } },
    });
    mats.push(m);
    return m;
  };
  const geo = (c: Cloud): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(c.pos, 3));
    g.setAttribute("aStart", new BufferAttribute(c.start, 3));
    g.setAttribute("aSize", new BufferAttribute(c.size, 1));
    g.setAttribute("aPhase", new BufferAttribute(c.phase, 1));
    g.setAttribute("aDelay", new BufferAttribute(c.delay, 1));
    geoms.push(g);
    return g;
  };
  const points = (c: Cloud, kind: number, col: Color, order: number): Pts => {
    const p = new Points(geo(c), makeMat(kind, col));
    p.frustumCulled = false;
    p.renderOrder = order;
    scene.add(p);
    return p;
  };

  const sky = points(world.sky, 2, cool.clone().lerp(white, 0.45), 0);
  const orbits = world.orbits.map((c) => points(c, 1, cool, 1));
  const seventh = points(world.seventh, 1, cool, 1);
  const comm = points(world.comm, 1, cool.clone().lerp(warmRaw, 0.35), 1);
  const sat = points(world.sat, 1, cool.clone().lerp(warmRaw, 0.18), 1);
  const dial = points(world.dial, 1, cool.clone().lerp(white, 0.2), 1);
  const gates = world.gates.map((c) => points(c, 1, cool.clone().lerp(white, 0.3), 1));
  const mark = points(world.mark, 0, white, 3);
  mark.material.uniforms.uKind.value = 0;

  // faint guide lines so a body's path reads even where the dust is sparse
  const circle = (r: number, n = 160): BufferGeometry => {
    const a: Vector3[] = [];
    for (let k = 0; k < n; k++) a.push(new Vector3(Math.cos((k / n) * TAU) * r, Math.sin((k / n) * TAU) * r, 0));
    const g = new BufferGeometry().setFromPoints(a);
    geoms.push(g);
    return g;
  };
  const guide = cool.clone().multiplyScalar(0.9); // the cool token, a shade darker (poster.ts draws the same hairlines in the same colour)
  const lineMat = (): LineBasicMaterial => {
    const m = new LineBasicMaterial({ color: guide, transparent: true, opacity: 0.1, depthWrite: false, depthTest: false });
    mats.push(m);
    return m;
  };
  const mkLine = (r: number): LineLoop => {
    const l = new LineLoop(circle(r), lineMat());
    l.renderOrder = 1;
    l.frustumCulled = false;
    scene.add(l);
    return l;
  };
  // nothing is drawn over or through the roundel: the hairlines (which the dust mask cannot reach) stop at its ground. The rocket breaks out of the ring, so the ground is
  // the circle that holds the whole mark (MARK.rho radii, centred MARK.c radii above the ring's centre along the camera's up), not the ring's own circle.
  const groundMat = new SpriteMaterial({ map: tex(groundCanvas(cssColor(scope, "--void"))), transparent: true, depthTest: false, depthWrite: false });
  mats.push(groundMat);
  const ground = new Sprite(groundMat);
  ground.renderOrder = 1.5;
  ground.scale.setScalar(3 * MARK.rho);
  scene.add(ground);
  const UP = new Vector3();
  // the warm core: Aperture's amber, lit from inside the ring. Added light only (never darkens), under the mark's stars and over the ground.
  const coreMat = new SpriteMaterial({ map: tex(coreCanvas()), color: warm, transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false });
  mats.push(coreMat);
  const core = new Sprite(coreMat);
  core.renderOrder = 1.6;
  core.scale.setScalar(CORE_SPAN);
  scene.add(core);
  const orbitLines = ORBITS.map((o) => mkLine(o.r));
  const seventhLine = mkLine(SEVENTH.r);
  const commLine = mkLine(COMM.r);
  const satLine = mkLine(SAT.r);
  const dialLine = mkLine(DIAL.r);

  // the dynamic dust (comet tails, the visitor's spiral): positions are rewritten every frame by the director
  const TRAIL_MAX = 480;
  const trailC: Cloud = { n: TRAIL_MAX, pos: new Float32Array(TRAIL_MAX * 3), start: new Float32Array(TRAIL_MAX * 3), size: new Float32Array(TRAIL_MAX).fill(2.4), phase: new Float32Array(TRAIL_MAX).map((_, i) => (i * 0.618) % 1), delay: new Float32Array(TRAIL_MAX) };
  const trail = points(trailC, 1, cool.clone().lerp(white, 0.5), 2);
  trail.material.uniforms.uKind.value = 3; // dust shading without the ring-flow rotation
  trail.geometry.setDrawRange(0, 0);

  // bodies: glyph sprites and their halos
  const halo = tex(haloCanvas());
  const glyphTex: Record<string, Texture> = {};
  await Promise.all(
    glyphNames.map(
      (n) =>
        new Promise<void>((resolve) => {
          const svg = art.svg(n, "white");
          if (!svg) return resolve();
          const img = new Image();
          const cv = document.createElement("canvas");
          cv.width = cv.height = 256;
          img.onload = () => {
            (cv.getContext("2d") as CanvasRenderingContext2D).drawImage(img, 0, 0, 256, 256);
            glyphTex[n] = tex(cv, 8);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        }),
    ),
  );
  const bodies = new Map<string, { s: Sprite; h: Sprite }>();
  const getBody = (key: string, glyph: string) => {
    let b = bodies.get(key);
    if (b) return b;
    if (!glyphTex[glyph]) return null; // no drawing on the page for it: nothing to show
    const m = new SpriteMaterial({ map: glyphTex[glyph], transparent: true, depthTest: false, depthWrite: false, color: 0xffffff });
    const s = new Sprite(m);
    s.renderOrder = 12;
    const hm = new SpriteMaterial({ map: halo, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, color: 0xffffff });
    const h = new Sprite(hm);
    h.renderOrder = 11;
    mats.push(m, hm);
    scene.add(h, s);
    b = { s, h };
    bodies.set(key, b);
    return b;
  };

  // ── per-frame ───────────────────────────────────────────────────────────────────────────────────────────────
  const tmpC = new Color();
  const q = new Quaternion();
  const size = new Vector2();
  function setGroup(obj: Pts, a: number, hi = 0, build = 1, flow = 0): void {
    const u = obj.material.uniforms;
    u.uAlpha.value = a;
    u.uHiAmt.value = hi;
    u.uBuild.value = build;
    u.uFlow.value = flow;
    obj.visible = a > 0.002;
  }
  const setLine = (l: LineLoop, a: number): void => {
    (l.material as LineBasicMaterial).opacity = a;
    l.visible = a > 0.003;
  };

  function render(F: Frame, w: number, h: number, dprMax: number): void {
    if (disposed) return;
    const pr = Math.min(window.devicePixelRatio || 1, dprMax);
    if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
    renderer.getSize(size);
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    cam.set(F.cam, w, h);
    ground.position.copy(UP.set(0, 1, 0).applyQuaternion(cam.camera.quaternion)).multiplyScalar(MARK.c);
    shared.uPR.value = pr;
    shared.uRes.value.set(w, h);
    shared.uMid.value = cam.dist;
    shared.uTime.value = F.time;
    shared.uMarkC.value.set(F.cam.cx, F.cam.cy - MARK.c * F.cam.R);
    shared.uMarkR.value = MARK.rho * F.cam.R; // the circle that holds the whole mark (screen px)
    shared.uRailX.value = F.railX ?? 0;
    shared.uStreak.value = F.streak;
    shared.uSDir.value.set(F.sdx ?? 0, F.sdy ?? 1);
    shared.uLoose.value = F.loose;
    shared.uPulse.value = F.pulse;
    shared.uPulseW.value = F.pulseW ?? 1.6;
    for (let i = 0; i < N_RECTS; i++) {
      const r = F.rects?.[i];
      shared.uCopy.value[i].set(r ? r[0] : -999, r ? r[1] : -999, r ? r[2] : -999, r ? r[3] : -999);
    }

    // sky: a slow turn about the vertical axis (the far layer), the whole sphere never moves relative to the mark's frame otherwise
    sky.rotation.y = F.skyYaw ?? 0;
    sky.rotation.x = F.skyPitch ?? 0;
    setGroup(sky, F.sky ?? 1, 0, F.build);
    // the warm core (a billboard at the mark's centre, so it follows the camera's placement of the mark)
    const cs = F.coreSwell ?? 0;
    core.visible = (F.core ?? 0) > 0.004;
    core.material.opacity = Math.min(1, (F.core ?? 0) * CORE_PEAK * (1 + cs * 0.6));
    core.scale.setScalar(CORE_SPAN * (1 + cs * 0.12));
    // the mark: a billboard
    mark.quaternion.copy(cam.camera.quaternion);
    setGroup(mark, F.markA ?? 1, 0, F.build);
    for (let i = 0; i < 6; i++) {
      const o = F.orbits[i];
      orbitQuat(i, F.flat, F.tilt, q);
      orbits[i].quaternion.copy(q);
      orbitLines[i].quaternion.copy(q);
      setGroup(orbits[i], o.a, o.hi, F.build, F.flow * (i % 2 ? -1 : 1) * (0.6 + i * 0.1));
      setLine(orbitLines[i], o.line);
    }
    seventhQuat(F.flat, F.tilt, q);
    seventh.quaternion.copy(q);
    seventhLine.quaternion.copy(q);
    setGroup(seventh, F.seventh.a, F.seventh.hi, F.seventh.build ?? 1, F.flow * 0.5);
    setLine(seventhLine, F.seventh.line ?? 0);
    comm.quaternion.copy(COMM.q);
    commLine.quaternion.copy(COMM.q);
    setGroup(comm, F.comm.a, F.comm.hi, F.comm.build ?? 1, F.flow * 0.4);
    setLine(commLine, F.comm.line);
    sat.quaternion.copy(SAT.q);
    satLine.quaternion.copy(SAT.q);
    setGroup(sat, F.sat.a, F.sat.hi, F.sat.build ?? 1, F.flow * -0.5);
    setLine(satLine, F.sat.line);
    dial.quaternion.copy(DIAL.q);
    dialLine.quaternion.copy(DIAL.q);
    setGroup(dial, F.dial.a, F.dial.hi, F.dial.build ?? 1, 0);
    setLine(dialLine, F.dial.line);

    // the three gates the visitor flies through
    gates.forEach((gt, i) => {
      const o = F.gates[i];
      gt.position.set(o.x, o.y, o.z);
      gt.quaternion.set(o.qx, o.qy, o.qz, o.qw);
      setGroup(gt, o.a, o.hi, o.build ?? 1, F.flow * 2);
    });
    // dynamic dust
    const tr = F.trail;
    const n = Math.min(tr?.n ?? 0, TRAIL_MAX);
    if (tr && n) {
      trailC.pos.set(tr.pos.subarray(0, n * 3));
      trail.geometry.attributes.position.needsUpdate = true;
      if (tr.size) {
        trailC.size.set(tr.size.subarray(0, n));
        trail.geometry.attributes.aSize.needsUpdate = true;
      }
    }
    trail.geometry.setDrawRange(0, n);
    trail.visible = n > 0;
    trail.material.uniforms.uAlpha.value = tr?.a ?? 1;
    trail.material.uniforms.uHiAmt.value = tr?.hi ?? 0;
    trail.material.uniforms.uBuild.value = 1;

    // bodies
    const seen = new Set<string>();
    for (const b of F.bodies) {
      seen.add(b.key);
      const o = getBody(b.key, b.glyph);
      if (!o) continue;
      const on = b.a > 0.004;
      o.s.visible = on;
      o.h.visible = on && b.halo > 0.004;
      if (!on) continue;
      o.s.position.set(b.x, b.y, b.z);
      o.h.position.set(b.x, b.y, b.z);
      o.s.scale.setScalar(b.size);
      o.h.scale.setScalar(b.size * (b.haloK ?? 3));
      tmpC.copy(white).lerp(sun, b.hi);
      o.s.material.color.copy(tmpC);
      o.s.material.opacity = b.a;
      tmpC.copy(cool).lerp(warm, b.hi);
      o.h.material.color.copy(tmpC);
      o.h.material.opacity = b.halo * b.a;
      o.s.renderOrder = 12 + (b.order ?? 0);
      o.h.renderOrder = 11 + (b.order ?? 0);
    }
    for (const [key, o] of bodies) {
      if (!seen.has(key)) {
        o.s.visible = false;
        o.h.visible = false;
      }
    }
    renderer.render(scene, cam.camera);
  }

  return { render, cam, dispose };
}
