// Lumen. One page, one scene (Orbit's), lit in Aperture's colours, with Ascent's nav. Live mode (WebGL, motion allowed): a fixed three.js scene that the
// director moves as the stations scroll past. Static mode (reduced motion, or no WebGL): the same content with one painted poster per station.
//
// This is the lazily loaded part of the landing page: scene/boot.ts imports it once the page has painted and the browser is idle. It attaches to the
// markup the server already sent (every word is in the HTML), builds the world, and returns when it is running. Everything it starts is registered the
// moment it exists, so `signal` aborting (the page unmounted, React StrictMode's second mount) releases whatever has been made so far: the renderer, its
// geometries, materials and textures, every listener, observer, timer and animation frame. A second start on the same markup works.
import { MARK } from "@/design-system/logo/logo-data";
import { AUD_GLYPHS, ENTRY_SEL, GATE_GLYPHS, MEMBER_GLYPHS, MOON_GLYPHS, SAT_GLYPHS, STATIONS, createDirector } from "./director";
import { mountCta } from "./cta";
import { readGlyphArt } from "./glyph-art";
import { clamp, ease, readParams, sstep, isReduced } from "./motion";
import { mountNav, type Nav } from "./nav";
import { createStage } from "./stage";
import { mountPicker } from "./ui";
import { mountWho } from "./who";
import { buildWorld, densityFor } from "./world";
import type { GL } from "./gl";
import type { Posters } from "./poster";
import type { Frame, Masked, StageState } from "./types";

const ALL_GLYPHS = [...new Set([...AUD_GLYPHS, ...MEMBER_GLYPHS, ...SAT_GLYPHS, ...MOON_GLYPHS, ...GATE_GLYPHS, "ring"])];

/** The way the mock's inline script decided, before first paint, between the scene and the painted page: a context can be made. */
function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export async function startEngine(root: HTMLElement, { signal }: { signal: AbortSignal }): Promise<void> {
  if (signal.aborted) return;
  const cleanups: (() => void)[] = [];
  const own = (fn: () => void): void => {
    cleanups.push(fn);
  };
  const destroy = (): void => {
    for (let fn = cleanups.pop(); fn; fn = cleanups.pop()) {
      try {
        fn();
      } catch {
        /* one failed release must not stop the rest */
      }
    }
  };
  signal.addEventListener("abort", destroy, { once: true });
  const dead = (): boolean => signal.aborted;

  const params = readParams();
  let isStatic = isReduced();
  const frozen = params.still || params.frozenT !== null;
  const nowSeconds = (): number => params.frozenT ?? (params.still ? 4 : stage.state.t);

  // the stylesheet's safety net for the nav is over once the scene has the nav; a frozen frame must not be changed by a transition
  root.dataset.engine = "1";
  if (frozen || params.frozenP !== null) root.dataset.frozen = "";
  own(() => {
    delete root.dataset.engine;
    delete root.dataset.frozen;
  });
  window.__ready = false;
  own(() => {
    delete window.__ready;
    delete window.__stops;
    delete window.__mark;
  });

  const setVh = (): void => root.style.setProperty("--vh", `${window.innerHeight}px`);
  setVh();
  window.addEventListener("resize", setVh);
  own(() => {
    window.removeEventListener("resize", setVh);
    root.style.removeProperty("--vh");
  });

  const stage = createStage({ root, params, smooth: 8 }); // before the audience row: ?who=<n> selects a glyph while the row mounts, and that asks the stage to redraw
  own(stage.destroy);
  stage.bindAnchors();
  const navEl = root.querySelector<HTMLElement>(".nav");
  if (navEl) stage.bindNav(navEl);
  const st = stage.state;

  let focusAud = -1;
  let posterApi: Posters | null = null;
  const who = mountWho(root, {
    initial: params.who,
    onSelect: (i) => {
      focusAud = i == null ? -1 : i;
      if (posterApi) posterApi.setAud(focusAud);
      else stage.invalidate();
    },
  });
  own(who.destroy);

  // ── the world and the director ─────────────────────────────────────────────────────────────────────────────────
  const art = readGlyphArt(root); // the bodies wear the drawings of the glyphs on the page
  const world = buildWorld(densityFor(window.innerWidth, window.innerHeight));
  let nav: Nav | null = null; // the nav is mounted once the mode is known; the director asks it where the satellites take off
  const director = createDirector(root, { launch: () => nav?.launchPoint() });

  let gl: GL | null = null;
  if (!isStatic && !webglAvailable()) isStatic = true;
  if (!isStatic) {
    const stageEl = root.querySelector<HTMLElement>(".stage");
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    stageEl?.appendChild(canvas);
    own(() => canvas.remove());
    try {
      const { createGL } = await import("./gl");
      if (dead()) return;
      gl = await createGL(canvas, world, ALL_GLYPHS, art, root, own);
    } catch {
      isStatic = true; // WebGL failed: the painted page
      canvas.remove();
    }
    if (dead()) return;
  }
  if (isStatic) root.dataset.mode = "static";
  else root.dataset.mode = "live";

  // ── the nav (ticks, gauge, cursor) and the closing action's ring ──────────────────────────────────────────────────
  const navApi = mountNav({ root, isStatic });
  nav = navApi;
  own(navApi.destroy);
  const cta = mountCta(root); // the closing action's orbit ring (the button's own path) and its pressed state
  if (cta) own(cta.destroy);
  if (params.joined) cta?.join(); // ?joined shows the finished orbit insertion, the button included

  const joinBtn = root.querySelector<HTMLElement>("#join");
  /** A plain press of Join Foundry: the animation plays, and the link goes on to /login as it would anyway (nothing is delayed or prevented). */
  const plainPress = (e: MouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  /** The page's contract with the comparison tools: set when the first frame is drawn. */
  const markReady = (): void => {
    window.__ready = true;
    root.dataset.ready = "1";
    own(() => delete root.dataset.ready);
  };

  // ═════════════════════════════════════════════════ static mode ═══════════════════════════════════════════════════
  async function runStatic(): Promise<void> {
    const { mountPosters } = await import("./poster");
    if (dead()) return;
    const posters = await mountPosters({ root, world, director, glyphs: ALL_GLYPHS, art });
    posterApi = posters;
    own(posters.destroy);
    if (dead()) return;
    window.__mark = () => posters.markNow();
    posters.setAud(focusAud);
    own(mountPicker(root, { onChange: (m) => posters.setMatches(m) }));
    // a hovered, focused or pressed entry lights its body on its station's poster
    STATIONS.forEach((id, k) => {
      const sel = ENTRY_SEL[id];
      const sec = root.querySelector<HTMLElement>(`#${id}`);
      if (!sel || !sec) return;
      let pinned = -0.5;
      [...sec.querySelectorAll<HTMLElement>(sel)].forEach((el, i) => {
        const on = (): void => {
          el.classList.add("on");
          posters.setFocus(k, i);
        };
        const off = (): void => {
          el.classList.remove("on");
          posters.setFocus(k, pinned);
        };
        const enter = (e: PointerEvent): void => {
          if (e.pointerType === "mouse") on();
        };
        const leave = (e: PointerEvent): void => {
          if (e.pointerType === "mouse") off();
        };
        const click = (): void => {
          pinned = pinned === i ? -0.5 : i;
          el.classList.toggle("on", pinned === i);
          posters.setFocus(k, pinned);
        };
        el.addEventListener("pointerenter", enter);
        el.addEventListener("pointerleave", leave);
        el.addEventListener("focusin", on);
        el.addEventListener("focusout", off);
        const evBtn = el.querySelector("button.ev");
        evBtn?.addEventListener("click", click);
        own(() => {
          el.removeEventListener("pointerenter", enter);
          el.removeEventListener("pointerleave", leave);
          el.removeEventListener("focusin", on);
          el.removeEventListener("focusout", off);
          evBtn?.removeEventListener("click", click);
          el.classList.remove("on");
        });
      });
    });
    const press = (e: MouseEvent): void => {
      if (!plainPress(e)) return;
      posters.setJoin({ p: 1, pulse: 0, flash: 0 });
      navApi.flash();
      cta?.join();
    };
    joinBtn?.addEventListener("click", press);
    own(() => joinBtn?.removeEventListener("click", press));
    if (params.joined) posters.setJoin({ p: 1, pulse: 0, flash: 0 });
    const drawNav = (): void => navApi.drawStatic(STATIONS.indexOf(stage.state.active ?? "hero"));
    own(stage.on("active", drawNav));
    stage.onInit(() => {
      navApi.layout();
      drawNav();
    });
    const onResize = (): void => {
      navApi.layout();
      drawNav();
    };
    window.addEventListener("resize", onResize);
    own(() => window.removeEventListener("resize", onResize));
    await stage.ready;
    if (dead()) return;
    navApi.layout();
    drawNav();
    markReady();
  }

  // ═════════════════════════════════════════════════ live mode ═════════════════════════════════════════════════════
  async function runLive(glx: GL): Promise<void> {
    const entryEls: Record<string, HTMLElement[]> = {};
    STATIONS.forEach((id) => {
      const sec = root.querySelector<HTMLElement>(`#${id}`);
      const sel = ENTRY_SEL[id];
      if (sec && sel) entryEls[id] = [...sec.querySelectorAll<HTMLElement>(sel)];
    });

    const onState = new Map<Element, boolean>(); // entry el → last .on
    const onVal: number[] = [];
    let extras: { el: Masked; top: number; bottom: number }[] = [];
    let extrasKey = "";
    const mState = new Map<Element, number>();
    // a block of words is on while its centre is inside the band (lower part of the viewport); a flip, eased by CSS for 180 ms
    function flip(el: Masked, yc: number): void {
      // the closing action is switched on a little higher (0.92): its arrival is a staged piece of motion (the light, the ring drawing, the pill, the small print), so it should play where it is seen
      el._cta ??= el.classList.contains("cta") ? 0.92 : 1.02;
      const m = yc > 0.55 && yc < el._cta ? 1 : 0;
      if (mState.get(el) !== m) {
        mState.set(el, m);
        el._m = m;
        el.style.setProperty("--m", String(m));
      }
    }
    const heroEls = [...root.querySelectorAll<HTMLElement>(".hero-copy, .cue")] as (HTMLElement & Masked)[];
    let heroM = 1;
    // Which blocks of words are switched on is decided from THIS frame's scroll, before the director reads it (the director keeps the
    // bodies clear of words that are on): a frame must be a pure function of the scroll, however the reader got there.
    // Phones keep every block of words in the lower band: blocks fade in as they enter it and out as they climb into the scene.
    function drawMasks(s: StageState): void {
      const G = director.G;
      if (!G) return;
      for (const [k, sid] of STATIONS.entries()) {
        const els = entryEls[sid];
        if (!els || !G.band[k]) continue;
        els.forEach((el, i) => flip(el, (G.entries[sid][i].cy - s.y) / G.vh));
      }
      // phones keep every block in the band; on a desktop only the one action does (it must never cross the mark on its way out)
      const key = `${G.vw}x${G.vh}:${G.rects.length}:${G.compact}`;
      if (key !== extrasKey) {
        for (const r of extras) {
          r.el.style.removeProperty("--m");
          r.el._m = 1;
          mState.delete(r.el);
        }
        extrasKey = key;
        const pick = G.compact ? ".head, .access, .ex, .picker, .cta" : ".cta";
        extras = G.rects.filter((r) => (r.el as Element).matches?.(pick)).map((r) => ({ el: r.el as Masked, top: r.top, bottom: r.bottom }));
      }
      for (const r of extras) flip(r.el, ((r.top + r.bottom) / 2 - s.y) / G.vh);
      // the hero's words leave early on a phone, before they climb over the mark
      const ha = G.compact ? (s.y / G.vh > 0.1 ? 0 : 1) : 1;
      if (ha !== heroM) {
        heroM = ha;
        for (const el of heroEls) {
          el._m = ha;
          if (ha === 1) el.style.removeProperty("--m");
          else el.style.setProperty("--m", "0");
        }
      }
    }
    /** The station's entries: the one on the reading line is lit (.on, a warm colour) and the rest sit back (--a). */
    function drawEntries(Fr: Frame): void {
      const id = STATIONS[Fr.k];
      for (const sid of STATIONS) {
        const els = entryEls[sid];
        if (!els) continue;
        const active = sid === id && Fr.w < 0.6;
        els.forEach((el, i) => {
          const on = active && Fr.c >= -0.2 ? clamp(1 - Math.abs(Fr.c - i) * 2) : 0;
          if (sid === id) onVal[i] = on;
          el.style.setProperty("--a", (0.8 + 0.2 * on).toFixed(3));
          const flag = on > 0.5;
          if (onState.get(el) !== flag) {
            onState.set(el, flag);
            el.classList.toggle("on", flag);
          }
        });
      }
    }

    // leader lines: a hairline from the entry's text to its body in the scene; it draws as the entry takes the reading line
    const LEADER_SIDE: Record<string, string> = { "who-we-are": "left", community: "top", opportunities: "right", events: "left", apply: "top" };
    const leaderEls = new Map<Element, HTMLElement | null>();
    const leadersOn = new Set<HTMLElement>();
    function drawLeaders(Fr: Frame, s: StageState): void {
      const G = director.G;
      if (!G) return;
      const id = STATIONS[Fr.k];
      const list = G.entries[id] ?? [];
      const live = new Set<HTMLElement>();
      list.forEach((e, i) => {
        const tg = Fr.tg[i];
        let ld = leaderEls.get(e.el);
        if (ld === undefined) {
          ld = e.el.querySelector<HTMLElement>(".leader");
          leaderEls.set(e.el, ld);
        }
        if (!ld) return;
        // the leader belongs to words that are on the reading line: once the last entry's words have climbed away from it the line lets go
        // (otherwise it would run from the body to words that have left the screen)
        const near = 1 - sstep(0.12, 0.26, Math.abs(e.cy - s.y - G.RLs[Fr.k] * G.vh) / G.vh);
        const on = (onVal[i] ?? 0) * near;
        if (!tg || on < 0.02) return;
        live.add(ld);
        const side = G.compact ? "top" : LEADER_SIDE[id];
        const ax = side === "left" ? e.left - 8 : side === "right" ? e.right + 8 : (e.txLeft + e.txRight) / 2;
        const ay = side === "top" ? e.txTop - s.y - 14 : e.cy - s.y;
        const dx = tg.x - ax;
        const dy = tg.y - ay;
        const dist = Math.hypot(dx, dy);
        const L = Math.max(0, dist - tg.r - 12) * ease.outCubic(on);
        ld.style.transform = `translate(${(ax - e.left).toFixed(1)}px, ${(ay - (e.top - s.y)).toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(4)}rad) scaleX(${L.toFixed(1)})`;
        ld.style.opacity = (0.85 * clamp(on * 1.6) * (tg.a ?? 1)).toFixed(3);
      });
      for (const ld of leadersOn) if (!live.has(ld)) ld.style.opacity = "0";
      leadersOn.clear();
      for (const ld of live) leadersOn.add(ld);
    }

    // the signal: a hairline from the closing action to the visitor waiting in the scene (a desktop), and one small light that runs along it when the action is pressed
    const sig = root.querySelector<HTMLElement>(".cta .leader.sig");
    const spark = root.querySelector<HTMLElement>(".cta .spark");
    function drawSignal(Fr: Frame, s: StageState, jt: number): void {
      const G = director.G;
      if (!sig || !spark || !G) return;
      const v = Fr.visitor;
      const box = G.ctaBox;
      const host = G.ctaHost;
      const hide = (): void => {
        sig.style.opacity = "0";
        spark.style.opacity = "0";
      };
      if (G.compact || !v || !box || !host || v.a < 0.04) return hide();
      const ax = (box.left + box.right) / 2;
      const ay = box.top - s.y - 16;
      const dx = v.x - ax;
      const dy = v.y - ay;
      const dist = Math.hypot(dx, dy);
      // continuous in the scroll (no hysteresis): it draws as the action rises into the lower band, and lets go once the visitor is taken into orbit
      const yc = ((box.top + box.bottom) / 2 - s.y) / G.vh;
      const on = sstep(0.97, 0.84, yc) * (1 - sstep(0.1, 0.55, v.p));
      if (on < 0.02 || dist < v.r + 40) sig.style.opacity = "0";
      else {
        const L = Math.max(0, dist - v.r - 12) * ease.outCubic(on);
        sig.style.transform = `translate(${(ax - host.left).toFixed(1)}px, ${(ay - (host.top - s.y)).toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(4)}rad) scaleX(${L.toFixed(1)})`;
        sig.style.opacity = (0.6 * clamp(on * 1.6)).toFixed(3);
      }
      // the light leaves the pill when it is pressed and reaches the visitor in 0.8 s (a pure function of the page clock, like the join itself)
      const u = jt < 0 ? -1 : jt / 0.8;
      if (u >= 0 && u <= 1.25) {
        const e = ease.inOutCubic(clamp(u));
        const sx = ax + (v.x - ax) * e;
        const sy = ay + (v.y - ay) * e;
        spark.style.transform = `translate(${(sx - host.left).toFixed(1)}px, ${(sy - (host.top - s.y)).toFixed(1)}px)`;
        spark.style.opacity = String(clamp(1 - Math.max(0, u - 1) / 0.25));
      } else spark.style.opacity = "0";
    }

    // ── the clock, the entrance and the frame ────────────────────────────────────────────────────────────────────
    let joinStart: number | null = params.joined ? -99 : null; // ?joined shows the finished orbit insertion; pressing the main button plays it
    let markState: { cx: number; cy: number; r: number } | null = null;
    let matches: number[] | null = null;
    window.__mark = () => markState;
    const maxDpr = (): number => (window.innerWidth < 900 ? 1.5 : 2);

    // idle life needs 15 frames a second, not 60: when nothing has scrolled or moved for 1.5 s, three of every four frames are skipped
    let acc = 0;
    let tick = 0;
    let lpx = -1;
    let lpy = -1;
    let lastMove = 0;
    function frame(s: StageState, dt0: number): void {
      let dt = dt0;
      if (s.pointer.x !== lpx || s.pointer.y !== lpy) {
        lpx = s.pointer.x;
        lpy = s.pointer.y;
        lastMove = s.t;
      }
      if (!frozen && dt > 0 && s.idle > 1.5 && s.t - lastMove > 1.5) {
        acc += dt;
        if (++tick % 4) return;
        dt = acc;
        acc = 0;
      } else {
        acc = 0;
        tick = 0;
      }
      const G = director.G;
      if (!G || G.vw !== s.vw || G.vh !== s.vh || Math.abs((G.T[STATIONS.length - 1] ?? 0) - (s.byId.footer?.top ?? 0)) > 1) {
        navApi.layout();
        director.measure(s);
      }
      const T = nowSeconds();
      const entrance = frozen && params.frozenT === null ? 1 : clamp(T / 2.8);
      const build = frozen && params.frozenT === null ? 1 : clamp((T - 0.15) / 2.4);
      if (!frozen) s.pointer.step(dt || 0.016, 5);
      else {
        s.pointer.sx = 0;
        s.pointer.sy = 0;
      }
      const jt = joinStart === null ? -1 : T - joinStart;
      const join = jt < 0 ? { p: 0, pulse: 0, flash: 0 } : { p: clamp(jt / 1.6), pulse: jt > 0.9 && jt < 3.2 ? clamp((jt - 0.9) / 2.3) : 0, flash: Math.exp(-Math.max(0, jt - 1.3) * 1.1) };
      drawMasks(s);
      const p0 = performance.now();
      const Fr = director.frame(s, T, { build, entrance, focusAud, drift: frozen ? 0 : 1, flowOn: !frozen, join, matches }, glx.cam);
      const p1 = performance.now();
      glx.render(Fr, s.vw, s.vh, maxDpr());
      const p2 = performance.now();
      drawEntries(Fr);
      drawLeaders(Fr, s);
      drawSignal(Fr, s, jt);
      navApi.entrance(T);
      navApi.press(Fr.dock);
      navApi.draw(Fr.S);
      if (params.prof) {
        window.__F = Fr;
        const p3 = performance.now();
        const a = (window.__prof ??= { n: 0, dir: 0, gl: 0, dom: 0 });
        a.n++;
        a.dir += p1 - p0;
        a.gl += p2 - p1;
        a.dom += p3 - p2;
      }
      const settled = Fr.w === 0 && build >= 1 && entrance >= 1 && Fr.loose < 0.002;
      markState = settled ? { cx: Fr.cam.cx, cy: Fr.cam.cy - MARK.c * Fr.cam.R, r: MARK.rho * Fr.cam.R } : null; // the circle that holds the whole mark: the rocket breaks out of the ring
      if (!canvasShown) {
        canvasShown = true;
        canvasEl?.setAttribute("data-ready", "");
      }
    }
    const canvasEl = root.querySelector<HTMLCanvasElement>(".stage canvas");
    let canvasShown = false;
    stage.onInit((s) => {
      navApi.layout();
      director.measure(s);
    });
    own(stage.onFrame(frame, { ambient: true }));
    const remeasure = (): void => {
      if (stage.state.vw) {
        navApi.layout();
        director.measure(stage.state);
        stage.invalidate();
      }
    };
    let remeasureFrame = 0;
    const onLayout = (): void => {
      cancelAnimationFrame(remeasureFrame);
      remeasureFrame = requestAnimationFrame(remeasure);
    };
    window.addEventListener("resize", remeasure);
    root.addEventListener("orbit:layout", onLayout);
    own(() => {
      window.removeEventListener("resize", remeasure);
      root.removeEventListener("orbit:layout", onLayout);
      cancelAnimationFrame(remeasureFrame);
    });

    // the picker lights the example members who share the picks
    own(
      mountPicker(root, {
        onChange: (m) => {
          matches = m;
          stage.invalidate();
        },
      }),
    );

    const press = (e: MouseEvent): void => {
      if (!plainPress(e)) return;
      if (joinStart === null || joinStart === -99) {
        joinStart = nowSeconds();
        stage.invalidate();
        navApi.flash();
        cta?.join();
      }
    };
    joinBtn?.addEventListener("click", press);
    own(() => joinBtn?.removeEventListener("click", press));

    // focus brings its words to the reading line: a focused control is never left in a faded or off-screen part of the band
    const onFocusIn = (e: FocusEvent): void => {
      const G = director.G;
      const t = e.target;
      if (!G || !(t instanceof Element)) return;
      const host = t.closest(".event, .picker, .cta");
      if (!host || (!G.compact && !host.matches(".event"))) return;
      const sec = host.closest("[data-section]");
      const k = STATIONS.indexOf(sec?.id ?? "");
      if (k < 0) return;
      const r = host.getBoundingClientRect();
      const RL = G.RLs[k];
      const want = Math.round(window.scrollY + r.top + r.height / 2 - RL * G.vh);
      if (Math.abs(want - window.scrollY) > 0.12 * G.vh) window.scrollTo({ top: Math.max(0, want), behavior: "smooth" });
    };
    document.addEventListener("focusin", onFocusIn);
    own(() => document.removeEventListener("focusin", onFocusIn));

    // what the page leaves behind when it goes: no words switched off, no inline state of ours
    own(() => {
      for (const el of [...mState.keys(), ...heroEls]) (el as HTMLElement).style.removeProperty("--m");
      for (const els of Object.values(entryEls)) for (const el of els) { el.style.removeProperty("--a"); el.classList.remove("on"); }
      for (const ld of leaderEls.values()) ld?.removeAttribute("style");
      sig?.removeAttribute("style");
      spark?.removeAttribute("style");
    });

    await stage.ready;
    if (dead()) return;
    navApi.layout();
    director.measure(st);
    frame(st, 0);
    window.__stops = () => {
      const G = director.G;
      if (!G) return [];
      const ys: number[] = [];
      STATIONS.forEach((id, k) => {
        for (const e of G.entries[id] ?? []) ys.push(Math.round(e.cy - G.RLs[k] * G.vh));
        if (k < STATIONS.length - 1) ys.push(Math.round(G.s0[k] + 0.5 * (G.T[k + 1] - G.s0[k]))); // the middle of each handoff
        if (id === "apply" && G.ctaCy != null) ys.push(Math.round(G.ctaCy - G.RLs[k] * G.vh)); // the one action
        if (id === "community" && G.pickerCy != null) ys.push(Math.round(G.pickerCy - G.RLs[k] * G.vh)); // the picker
        if (G.compact && id === "community") for (const cy of G.exCy ?? []) ys.push(Math.round(cy - 0.8 * G.vh)); // a phone's "Example" markers (each is in the band only near its own stop)
      });
      return ys;
    };
    // the first settled frame (the entrance takes 2.8 s in live mode; the tools wait for it, scrolling is never blocked)
    if (frozen) markReady();
    else {
      const timer = window.setTimeout(markReady, 3000);
      own(() => window.clearTimeout(timer));
    }
  }

  if (isStatic) await runStatic();
  else if (gl) await runLive(gl);
}
