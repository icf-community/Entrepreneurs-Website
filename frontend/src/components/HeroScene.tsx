"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// ════════════════════════════════════════════════════════════════════
// Foundry · HeroScene
//
// The mark, made of stars.
//
// The roundel is not drawn as an image here. /logo-roundel.png is decoded,
// its alpha channel is sampled, and every sampled pixel becomes a point in a
// GPU point cloud — so the rocket and its ring are literally built out of the
// same material as the sky behind them. That is the one idea in this scene,
// and it is the logo's own idea: a mark on a starfield.
//
// One WebGL context does both layers, which is the reason this is Three.js
// and the earlier canvas-2D field was not. Two layers in one perspective
// camera means the mark and the sky parallax against each other for real
// when the pointer moves — depth that is computed, not faked with two
// translated divs.
//
// Behaviour:
//   * The cloud is positioned from a DOM anchor, so it tracks the hero's
//     grid cell at every breakpoint instead of guessing at world units.
//   * prefers-reduced-motion renders exactly one frame and starts no loop.
//   * No WebGL, or a context loss, falls back to the flat PNG underneath.
//   * The loop suspends off-screen and when the tab is hidden.
//   * Shaders are not scripts, so none of this needs a CSP nonce.
// ════════════════════════════════════════════════════════════════════

const MARK_POINTS = 20000;
const SKY_POINTS = 2400;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aBright;
  uniform float uTime;
  uniform float uDpr;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Each point keeps its own phase so the field shimmers rather than pulsing
    // in unison, which is the tell of a cheap twinkle.
    float tw = 0.80 + 0.20 * sin(uTime * 0.9 + aPhase);
    vAlpha = aBright * tw;
    gl_PointSize = aSize * uDpr * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  void main() {
    // Round points with a soft edge. Without the discard these are squares,
    // which is the single most recognisable "default WebGL" artefact.
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    // smoothstep(edge0, edge1, x) is undefined per spec when edge0 >= edge1,
    // so the soft inward fade is written as 1 - smoothstep(0.10, 0.25, d)
    // (ascending edges) rather than smoothstep(0.25, 0.10, d) — mathematically
    // identical (smoothstep's cubic is point-symmetric about t=0.5) but
    // spec-compliant.
    gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * (1.0 - smoothstep(0.10, 0.25, d)));
  }
`;

type Cloud = { pos: Float32Array; size: Float32Array; phase: Float32Array; bright: Float32Array };

/** Reads the mark's alpha channel and turns lit pixels into points. */
async function sampleMark(src: string, count: number): Promise<Cloud | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Collect every opaque pixel, then take an even stride through it. Random
  // rejection would clump; a stride keeps the ring's edge continuous.
  const lit: number[] = [];
  for (let i = 3; i < data.length; i += 4) if (data[i] > 110) lit.push((i - 3) / 4);
  if (lit.length === 0) return null;

  const n = Math.min(count, lit.length);
  const stride = lit.length / n;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  const bright = new Float32Array(n);

  for (let k = 0; k < n; k++) {
    const p = lit[Math.floor(k * stride)];
    const px = p % w, py = (p / w) | 0;
    pos[k * 3]     = (px / w - 0.5);
    pos[k * 3 + 1] = -(py / h - 0.5);
    // A shallow z-shell. Enough that rotating the cloud reads as a solid
    // object rather than a decal; not so much that the mark stops being legible.
    pos[k * 3 + 2] = (Math.random() - 0.5) * 0.055;
    size[k]   = 0.9 + Math.random() * 0.7;
    phase[k]  = Math.random() * Math.PI * 2;
    bright[k] = 0.55 + Math.random() * 0.45;
  }
  return { pos, size, phase, bright };
}

function makeSky(count: number): Cloud {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const bright = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 34;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 22;
    // Behind the mark, spread deep so size attenuation does the work.
    pos[i * 3 + 2] = -2 - Math.random() * 16;
    size[i]   = 0.7 + Math.random() * 1.5;
    phase[i]  = Math.random() * Math.PI * 2;
    bright[i] = 0.22 + Math.random() * 0.66;
  }
  return { pos, size, phase, bright };
}

function toGeometry(c: Cloud): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(c.pos, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(c.size, 1));
  g.setAttribute("aPhase", new THREE.BufferAttribute(c.phase, 1));
  g.setAttribute("aBright", new THREE.BufferAttribute(c.bright, 1));
  return g;
}

export default function HeroScene({
  anchorRef,
  className = "",
}: {
  /** The element the mark should sit on top of, at every breakpoint. */
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const hostRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      return; // no WebGL — the PNG fallback stays visible
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scene = new THREE.Scene();
    const FOV = 45;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.z = 8;

    // uScale sets the on-screen size of one point. See the note in VERT.
    const uniforms = { uTime: { value: 0 }, uDpr: { value: 1 }, uScale: { value: 8.5 } };
    const material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
    });

    const sky = new THREE.Points(toGeometry(makeSky(SKY_POINTS)), material);
    scene.add(sky);

    let mark: THREE.Points | null = null;
    let disposed = false;

    // Place the cloud over its DOM anchor by projecting the anchor's rect into
    // world units at z=0. Cheaper and far more robust than hand-tuning world
    // coordinates per breakpoint.
    const placeMark = () => {
      if (!mark) return;
      const anchor = anchorRef.current;
      const host = canvas.getBoundingClientRect();
      if (!anchor || host.width === 0) return;
      const a = anchor.getBoundingClientRect();
      const visibleH = 2 * camera.position.z * Math.tan((FOV * Math.PI) / 360);
      const visibleW = visibleH * (host.width / host.height);
      const cx = a.left + a.width / 2 - host.left;
      const cy = a.top + a.height / 2 - host.top;
      mark.position.x = (cx / host.width - 0.5) * visibleW;
      mark.position.y = -(cy / host.height - 0.5) * visibleH;
      const s = (a.width / host.width) * visibleW;
      mark.scale.setScalar(s);
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(r.width, r.height, false);
      uniforms.uDpr.value = dpr;
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      placeMark();
    };

    // Pointer parallax. The two layers move by different amounts, which is the
    // whole reason they share one perspective camera.
    let targetX = 0, targetY = 0, curX = 0, curY = 0;
    const onPointer = (e: PointerEvent) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    let raf = 0, running = false;
    const start = performance.now();

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      uniforms.uTime.value = t;
      curX += (targetX - curX) * 0.045;
      curY += (targetY - curY) * 0.045;
      if (mark) {
        mark.rotation.y = Math.sin(t * 0.13) * 0.20 + curX * 0.26;
        mark.rotation.x = Math.cos(t * 0.10) * 0.07 - curY * 0.13;
      }
      sky.position.x = -curX * 0.32;
      sky.position.y = curY * 0.20;
      sky.rotation.z = t * 0.004;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };

    const play = () => {
      if (running || reduced.matches || document.hidden || disposed) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const pause = () => { running = false; cancelAnimationFrame(raf); };

    resize();
    renderer.render(scene, camera);

    sampleMark("/logo-roundel.png", MARK_POINTS).then((cloud) => {
      if (disposed || !cloud) return;
      mark = new THREE.Points(toGeometry(cloud), material);
      scene.add(mark);
      placeMark();
      setLive(true);           // hides the PNG fallback
      renderer.render(scene, camera);
      play();
    });

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (anchorRef.current) ro.observe(anchorRef.current);

    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : pause()), { threshold: 0 });
    io.observe(canvas);

    const onVis = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onPointer, { passive: true });

    const onLost = (e: Event) => { e.preventDefault(); pause(); setLive(false); };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      disposed = true;
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onLost);
      sky.geometry.dispose();
      mark?.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [anchorRef]);

  return (
    <canvas
      ref={hostRef}
      aria-hidden
      data-live={live || undefined}
      className={className}
    />
  );
}
