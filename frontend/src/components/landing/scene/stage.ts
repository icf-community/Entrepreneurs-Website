// The scroll stage: the engine that turns scrolling into smooth, queryable state for the whole page.
//
//   const stage = createStage({ root, params });        // finds [data-section] landmarks inside root
//   stage.bindAnchors(); stage.bindNav(navEl);          // #links scroll smoothly, aria-current follows the page
//   stage.onFrame((st, dt) => { ... });                 // runs while scrolling/settling (and ambient ones always)
//   stage.onFrame(draw, { ambient: true });             // needs continuous time (twinkle, drift)
//   await stage.ready;                                  // fonts loaded, sections measured
//   stage.destroy();                                    // every listener, observer and frame, removed
//
// State (`st`, also stage.state): y (raw scroll), ys (smoothed), vel (px/s, smoothed), dir, vh, vw, max, g / gs (raw / smoothed global progress 0..1),
// t (seconds, frozen by ?t), idle (s since the last input), active (id of the section on the reading line), pointer, still, reduced, sections[], byId{}.
//
// Modes: ?still / ?t= / ?p= give no smoothing, no loop, no time: state is a pure function of scrollY (tools rely on this). prefers-reduced-motion: reduce
// is the same, and frame callbacks are NOT called (draw the static composition in stage.onInit).
// Scrolling is always native: this file never listens for wheel or touch and never calls preventDefault() (but for a plain click on an in-page anchor,
// which it turns into a smooth scroll to the same place: the link works without it).

import { clamp, damp, isReduced, trackPointer, type Params } from "./motion";
import type { Pointer, StageSection, StageState } from "./types";

const SETTLE_PX = 0.35;

type FrameFn = (st: StageState, dt: number) => void;
interface Sub {
  fn: FrameFn;
  ambient: boolean;
  runReduced: boolean;
}

export interface Stage {
  state: StageState;
  ready: Promise<void>;
  onFrame(fn: FrameFn, opts?: { ambient?: boolean; reduced?: boolean }): () => void;
  onInit(fn: (st: StageState) => void): void;
  on(type: "active", fn: (id: string | null, st: StageState) => void): () => void;
  goto(target: string | Element, opts?: { focus?: boolean; hash?: boolean }): void;
  measure(): void;
  bindAnchors(): void;
  bindNav(navRoot: Element): void;
  /** Ask for a frame (the state changed outside the scroll). */
  invalidate(): void;
  /** True once the smoothed scroll has caught up and the last render has run (tools wait for this). */
  settled(): boolean;
  sections(): StageSection[];
  destroy(): void;
}

export function createStage({ root, params, smooth = 8, selector = "[data-section]" }: { root: HTMLElement; params: Params; smooth?: number; selector?: string }): Stage {
  const reduced = isReduced();
  const still = params.still || params.frozenT !== null || params.frozenP !== null;
  const instant = still || reduced;
  const pointerTrack = trackPointer(window);
  const pointer: Pointer = pointerTrack.pointer;

  const st: StageState = {
    y: window.scrollY, ys: window.scrollY, vel: 0, dir: 1, vh: 0, vw: 0, max: 0, g: 0, gs: 0,
    t: params.frozenT ?? 0, idle: 0, active: null, sections: [], byId: {},
    still, reduced, pointer,
  };

  const subs = new Set<Sub>();
  const inits = new Set<(st: StageState) => void>();
  const activeListeners = new Set<(id: string | null, st: StageState) => void>();
  let lastY = window.scrollY;
  let lastW = 0;
  let lastH = 0;
  let lastRenderedY = NaN;
  let raf = 0;
  let last = 0;
  let dirty = true;
  let stillRaf = 0;
  let prevActive: string | null = null;
  let navRoot: Element | null = null;
  let dead = false;

  // ── measuring ─────────────────────────────────────────────────────────────
  function measure(): void {
    const de = document.documentElement;
    st.vh = de.clientHeight || window.innerHeight;
    st.vw = de.clientWidth || window.innerWidth;
    st.max = Math.max(0, de.scrollHeight - st.vh);
    const y0 = window.scrollY;
    const prev = st.byId;
    st.sections = [...root.querySelectorAll<HTMLElement>(selector)].map((el, index) => {
      const id = el.dataset.section || el.id;
      const r = el.getBoundingClientRect();
      const s: StageSection = prev[id] ?? { id, el, index, top: 0, h: 0, enter: 0, leave: 0, pass: 0, fill: 0, vis: 0, mid: 0, local: () => 0 };
      s.el = el;
      s.index = index;
      s.top = r.top + y0;
      s.h = r.height;
      s.local = (a, b) => clamp((st.ys - s.top - a * st.vh) / ((b - a) * st.vh));
      return s;
    });
    st.byId = Object.fromEntries(st.sections.map((s) => [s.id, s]));
    dirty = true;
  }

  // ── per-frame state ───────────────────────────────────────────────────────
  function update(dt: number): void {
    const y = window.scrollY;
    st.idle = y !== lastY ? 0 : st.idle + dt;
    if (y !== lastY) st.dir = Math.sign(y - lastY) || st.dir;
    st.y = y;
    if (instant || dt === 0) {
      st.ys = y;
      st.vel = 0;
    } else {
      st.ys = damp(st.ys, y, smooth, dt);
      if (Math.abs(st.ys - y) < SETTLE_PX) st.ys = y;
      st.vel = damp(st.vel, (y - lastY) / dt, 10, dt);
      if (Math.abs(st.vel) < 2) st.vel = 0;
    }
    lastY = y;
    const { ys, vh } = st;
    st.g = st.max ? clamp(y / st.max) : 0;
    st.gs = st.max ? clamp(ys / st.max) : 0;
    const ref = ys + vh * 0.4;
    let active = st.active ?? st.sections[0]?.id ?? null;
    for (const s of st.sections) {
      const { top, h } = s;
      s.enter = clamp((vh - (top - ys)) / vh);
      s.leave = clamp((ys - (top + h - vh)) / vh);
      s.pass = h > 0 ? clamp((ys - top) / h) : 0;
      s.fill = h > vh ? clamp((ys - top) / (h - vh)) : 0;
      s.vis = clamp((Math.min(top + h, ys + vh) - Math.max(top, ys)) / vh);
      s.mid = (top + h / 2 - (ys + vh / 2)) / vh;
      if (ref >= top && ref < top + h) active = s.id;
    }
    if (ref < (st.sections[0]?.top ?? 0)) active = st.sections[0]?.id ?? active;
    st.active = active;
  }

  // compared with the live scrollY, not st.y: a tool that scrolls and asks at once must not see a stale "settled"
  const isSettled = (): boolean => Math.abs(st.ys - window.scrollY) < SETTLE_PX && Math.abs(st.vel) < 2;
  const hasAmbient = (): boolean => !reduced && !still && [...subs].some((s) => s.ambient);

  function render(dt: number): void {
    update(dt);
    if (st.active !== prevActive) {
      prevActive = st.active;
      if (navRoot) markNav();
      activeListeners.forEach((fn) => fn(st.active, st));
    }
    const changed = st.ys !== lastRenderedY || st.vw !== lastW || st.vh !== lastH || dirty;
    lastRenderedY = st.ys;
    lastW = st.vw;
    lastH = st.vh;
    for (const sub of subs) {
      if (reduced && !sub.runReduced) continue;
      if (sub.ambient || changed) sub.fn(st, dt);
    }
    dirty = false;
  }

  // ── loop: demand-driven, sleeps when nothing moves and nothing is ambient ─
  // wake() or onFrame() called from INSIDE a frame callback must not start a second rAF chain: frame() clears `raf` first, so a naive wake() sees
  // "no frame pending" and schedules one, and every chain then re-arms itself. Inside a frame, wake() only records that another frame is wanted.
  let inFrame = false;
  let again = false;
  function frame(now: number): void {
    raf = 0;
    inFrame = true;
    again = false;
    const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
    last = now;
    if (params.frozenT === null) st.t += dt;
    try {
      render(dt);
    } finally {
      inFrame = false;
    }
    if (!dead && (!isSettled() || dirty || again || hasAmbient() || st.idle < 0.6) && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake(): void {
    if (dead) return;
    dirty = true;
    if (instant) {
      if (!stillRaf)
        stillRaf = requestAnimationFrame(() => {
          stillRaf = 0;
          render(0);
        });
      return;
    }
    if (inFrame) {
      again = true;
      return;
    }
    if (!raf && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  const onScroll = (): void => wake();
  const onResize = (): void => {
    measure();
    wake();
  };
  const onPointerMove = (): void => {
    if (!instant) wake();
  };
  const onVisibility = (): void => {
    if (!document.hidden) wake();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    measure();
    wake();
  });
  ro.observe(document.body);

  // ── subscriptions ─────────────────────────────────────────────────────────
  function onFrame(fn: FrameFn, { ambient = false, reduced: runReduced = false } = {}): () => void {
    const sub: Sub = { fn, ambient, runReduced };
    subs.add(sub);
    wake();
    return () => subs.delete(sub);
  }
  const onInit = (fn: (st: StageState) => void): void => {
    inits.add(fn);
  };
  const on = (_type: "active", fn: (id: string | null, st: StageState) => void): (() => void) => {
    activeListeners.add(fn);
    return () => activeListeners.delete(fn);
  };

  // ── navigation: anchors, focus, active link ───────────────────────────────
  function targetY(target: string | Element): { el: Element | null; y: number } {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    const top = el ? el.getBoundingClientRect().top + window.scrollY : 0;
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    return { el, y: clamp(Math.round(top - pad), 0, st.max) };
  }
  function afterScroll(y: number): Promise<void> {
    return new Promise((resolve) => {
      let timer = 0;
      const done = (): void => {
        window.removeEventListener("scrollend", done);
        window.clearTimeout(timer);
        resolve();
      };
      window.addEventListener("scrollend", done, { once: true });
      const poll = (n = 0): void => {
        if (dead) return resolve();
        if (Math.abs(window.scrollY - y) < 2 || n > 40) {
          window.clearTimeout(timer);
          timer = window.setTimeout(done, 90);
        } else window.setTimeout(() => poll(n + 1), 50);
      };
      poll();
    });
  }
  function goto(target: string | Element, { focus = true, hash = false } = {}): void {
    const { el, y } = targetY(target);
    window.scrollTo({ top: y, behavior: instant ? "instant" : "smooth" });
    if (hash && el?.id) window.history.replaceState(null, "", `#${el.id}`);
    if (focus && el) {
      void afterScroll(y).then(() => {
        if (dead) return;
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        (el as HTMLElement).focus({ preventScroll: true });
      });
    }
    wake();
  }
  const onAnchorClick = (e: MouseEvent): void => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = (a.getAttribute("href") ?? "").slice(1);
    if (!id || !document.getElementById(id)) return; // not an anchor on this page: the browser handles it
    e.preventDefault();
    goto(id);
  };
  function bindAnchors(): void {
    root.addEventListener("click", onAnchorClick);
  }
  function markNav(): void {
    navRoot?.querySelectorAll('a[href^="#"]').forEach((a) => {
      const on = a.getAttribute("href") === `#${st.active}`;
      if (on) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
  }
  function bindNav(el: Element): void {
    navRoot = el;
    markNav();
  }

  // ── start ─────────────────────────────────────────────────────────────────
  measure();
  const ready = (async () => {
    try {
      await document.fonts.ready;
    } catch {
      /* the fonts API is optional */
    }
    if (dead) return;
    measure();
    if (params.frozenP !== null) {
      window.scrollTo({ top: Math.round(clamp(params.frozenP) * st.max), behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(r));
      if (dead) return;
    }
    lastY = window.scrollY;
    st.ys = window.scrollY;
    update(0);
    inits.forEach((fn) => fn(st));
    render(0);
    wake();
  })();

  const stage: Stage = {
    state: st, ready, onFrame, onInit, on, goto, measure, bindAnchors, bindNav,
    invalidate: wake,
    settled: () => isSettled() && !dirty && !stillRaf,
    sections: () => st.sections,
    destroy() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(stillRaf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      root.removeEventListener("click", onAnchorClick);
      ro.disconnect();
      pointerTrack.destroy();
      subs.clear();
      inits.clear();
      activeListeners.clear();
      if (window.__stage === stage) delete window.__stage;
    },
  };
  window.__stage = stage;
  return stage;
}
