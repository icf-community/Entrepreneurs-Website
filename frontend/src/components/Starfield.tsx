"use client";

import { useEffect, useRef } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Starfield
//
// The logo is a white roundel on a black starfield. That field is the
// brand's material, so on the hero it is drawn live rather than baked into
// a PNG: the mark sits *in* the sky instead of on a picture of one.
//
// Canvas 2D, not Three.js. This draws a few hundred one-to-two pixel dots
// with a slow drift; WebGL would add ~150 KB of library to do the same
// thing, and there is no geometry, lighting or shader work here to earn it.
// The one thing WebGL would buy — tens of thousands of points — is a
// density this design does not want.
//
// Behaviour that matters:
//   * A static frame is painted synchronously on mount, so the field is
//     never blank while rAF spins up.
//   * prefers-reduced-motion paints that frame and stops. No loop starts.
//   * The loop is suspended when the hero scrolls out of view and when the
//     tab is hidden, so this costs nothing on the rest of the site.
//   * <canvas> is not an LCP candidate element, so this cannot become the
//     largest contentful paint no matter how much of the viewport it covers.
// ════════════════════════════════════════════════════════════════════

type Star = {
  x: number;      // 0..1 of width
  y: number;      // 0..1 of height
  z: number;      // 0..1 depth — drives size, brightness and drift rate
  phase: number;  // twinkle offset, so they don't pulse in unison
  rate: number;   // twinkle rate
};

// One star per ~2600 css px². Sparser than the logo artwork, which is read at
// a few hundred pixels wide; at viewport scale that density becomes noise.
const DENSITY = 1 / 2600;
const MAX_STARS = 520;

function makeStars(w: number, h: number): Star[] {
  const n = Math.min(MAX_STARS, Math.round(w * h * DENSITY));
  return Array.from({ length: n }, () => ({
    x: Math.random(),
    y: Math.random(),
    // Cubed, so most stars sit far away and faint and only a few are near.
    // A uniform distribution reads as evenly-sized confetti.
    z: Math.random() ** 3,
    phase: Math.random() * Math.PI * 2,
    rate: 0.4 + Math.random() * 0.9,
  }));
}

export default function Starfield({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let stars: Star[] = [];
    let w = 0, h = 0;
    let raf = 0;
    let running = false;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Cap DPR at 2: past that this is drawing four times the pixels for a
      // field of 1px dots nobody can resolve.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(w, h);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      // The stars are ring white, the logo's own light: the canvas carries `text-star` (see the return below) and `currentColor` reads it,
      // so the one place the value lives is tokens.css and nothing here names a colour.
      ctx.fillStyle = "currentColor";
      // Drift is deliberately near-imperceptible: a full pass takes minutes.
      // Anything faster reads as a screensaver rather than a sky.
      const drift = reduced.matches ? 0 : t * 0.000004;

      for (const s of stars) {
        const near = s.z;
        const x = s.x * w;
        // Nearer stars drift further — the parallax is the only depth cue
        // a field of white dots has.
        const y = ((s.y + drift * (0.3 + near)) % 1) * h;

        const size = 0.45 + near * 1.15;
        const base = 0.16 + near * 0.62;
        const twinkle = reduced.matches
          ? 1
          : 0.75 + 0.25 * Math.sin(t * 0.0011 * s.rate + s.phase);

        // Fade the field out toward the bottom so the hero dissolves into the
        // page instead of ending on a hard horizon.
        const falloff = 1 - Math.max(0, (y / h - 0.55) / 0.45) ** 1.5;

        ctx.globalAlpha = Math.max(0, base * twinkle * falloff);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduced.matches || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    draw(0); // paint before the first frame, so it is never blank

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(canvas);

    // Only animate while the hero is actually on screen.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    const onReduced = () => { stop(); draw(performance.now()); if (!reduced.matches) start(); };
    reduced.addEventListener("change", onReduced);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReduced);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`text-star ${className}`.trim()} />;
}
