// Lumen · the nav. Ascent's altitude rail on the right edge, driven by Orbit's station coordinate S (0 hero .. 6 footer): five glyph ticks, a gauge
// (dim above the cursor, amber below it, the part already travelled) and the real roundel as the cursor. The cursor is level with a tick when that
// station is settled. It is brought in as the big mark in the scene recedes (S 0.12 to 0.5), so the first screen shows one logo. Live mode moves it with
// the scroll (transform only). The static page (reduced motion, no WebGL) places it at the current station's tick, once per station change.
//
// The markup is the server's (components/landing/Nav.tsx) and the ticks are placed by landing.css with the same arithmetic as `yRail` here; this module
// only moves the gauge and the cursor, fades the nav in on the page clock, and runs the phone's menu.
import { MARK } from "@/design-system/logo/logo-data";
import { clamp } from "./motion";

const oc = (x: number): number => 1 - Math.pow(1 - x, 3);
const sm = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface Nav {
  layout(): void;
  launchPoint(): { x: number; y: number; w: number };
  entrance(T: number): void;
  draw(S: number): void;
  press(dock: { press: number }[]): void;
  drawStatic(index: number): void;
  flash(): void;
  destroy(): void;
}

export function mountNav({ root, isStatic }: { root: HTMLElement; isStatic: boolean }): Nav {
  const nav = root.querySelector<HTMLElement>(".nav") as HTMLElement;
  const links = [...nav.querySelectorAll<HTMLElement>(".rail-links li")];
  const segUp = nav.querySelector<HTMLElement>(".seg-up") as HTMLElement;
  const segDown = nav.querySelector<HTMLElement>(".seg-down") as HTMLElement;
  const cursor = nav.querySelector<HTMLElement>(".cursor") as HTMLElement;
  const navEnd = nav.querySelector<HTMLElement>(".nav-end") as HTMLElement;
  const menuBtn = nav.querySelector<HTMLElement>(".menu-btn") as HTMLElement;
  const geo = { W: 0, H: 0, mobile: false, top: 128, pad: 504, bottom: 560, cx: 0, d: 56 };
  const yRail = (a: number): number => geo.pad - (geo.pad - geo.top) * clamp(a / 5, 0, 1);
  let entranceDone = isStatic;
  let cursorEnt = isStatic ? 1 : 0;
  let lastA = -1;
  let lastPress = "";
  let flashTimer = 0;

  /** The rail's geometry for this viewport. Call before the director measures (it reads the Opportunities tick). */
  function layout(): void {
    // fixed elements sit against the layout viewport (the stage's width): with a classic scrollbar that is narrower than innerWidth; the phone breakpoint is the CSS one
    const W = document.documentElement.clientWidth || window.innerWidth;
    const H = window.innerHeight;
    const mobile = window.innerWidth < 900;
    const top = mobile ? 112 : 128;
    const pad = clamp(Math.max(H * 0.56, top + 5 * 54), top + 5 * 54, H - 110);
    // the cursor's size is the CSS one (--cd on the rail): 56 px, 46 px on a phone (the roundel is never shown under 45)
    const rail = nav.querySelector<HTMLElement>(".rail") as HTMLElement;
    const d = parseFloat(getComputedStyle(rail).getPropertyValue("--cd")) || (mobile ? 46 : 56);
    Object.assign(geo, { W, H, mobile, top, pad, bottom: pad + 56, cx: W - (mobile ? 26 : 40), d });
    lastA = -1;
  }

  /** Where the three satellites take off: the Opportunities tick on a desktop, the gauge at that altitude on a phone (the five ticks are in the menu there). */
  function launchPoint(): { x: number; y: number; w: number } {
    if (!geo.mobile) {
      const r = links[2]?.querySelector(".tick")?.getBoundingClientRect();
      if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    }
    return { x: geo.cx, y: yRail(3), w: geo.d };
  }

  function setSeg(el: HTMLElement, y0: number, y1: number, o = 1): void {
    const len = Math.max(0, y1 - y0);
    el.style.transform = `translate3d(0, ${y0.toFixed(1)}px, 0) scaleY(${(len / 100).toFixed(4)})`;
    el.style.opacity = len < 2 ? "0" : o >= 0.999 ? "1" : o.toFixed(3);
  }
  // the stylesheet holds Sign in and the ticks back (opacity 0) in live mode so they never flash before the entrance: an explicit value always wins
  function put(el: HTMLElement | undefined, o: number): void {
    if (el) el.style.opacity = o >= 0.999 ? "1" : o.toFixed(3);
  }

  /** The entrance rides the page clock (T seconds), so ?t= and ?still show it as it is at that time: Sign in, then the ticks one by one, then the cursor (when the scene allows). */
  function entrance(T: number): void {
    if (entranceDone) return;
    const win = (a: number, b: number): number => clamp((T - a) / (b - a));
    put(navEnd, oc(win(0.2, 0.8)));
    links.forEach((li, i) => put(li, oc(win(0.9 + i * 0.07, 1.5 + i * 0.07))));
    cursorEnt = oc(win(1.4, 2.0));
    if (T >= 2.2) {
      entranceDone = true;
      cursorEnt = 1;
      put(navEnd, 1);
      links.forEach((li) => put(li, 1));
    }
  }

  /** The cursor and the gauge for altitude y at visibility vis (0 hidden .. 1): the gauge opens a gap around the cursor, as Ascent's does. */
  function place(y: number, vis: number): void {
    cursor.style.transform = `translate3d(${(geo.cx - geo.d / 2).toFixed(2)}px, ${(y - geo.d / 2 + (1 - vis) * 12).toFixed(2)}px, 0)`;
    cursor.style.opacity = vis >= 0.999 ? "1" : vis.toFixed(3);
    // 12 px of gauge-free air above the rocket's tip and below the ring (the ring's centre is on the rail; the rocket rises MARK.top radii above it)
    const gapUp = ((geo.d / 2) * MARK.top + 12) * vis;
    const gapDown = ((geo.d / 2) * MARK.bot + 12) * vis;
    setSeg(segUp, geo.top, Math.max(geo.top, y - gapUp));
    setSeg(segDown, Math.min(geo.bottom, y + gapDown), geo.bottom, vis);
  }

  const pcCache = new WeakMap<HTMLElement, string>();
  /** Live: the cursor, the gauge and the ticks follow the station coordinate S. */
  function draw(S: number): void {
    const a = clamp(S, 0, 5);
    place(yRail(a), sm(0.12, 0.5, S) * cursorEnt);
    // a tick warms as the cursor comes level with it
    if (Math.abs(a - lastA) > 0.004) {
      lastA = a;
      links.forEach((li, i) => {
        const pc = clamp(1 - Math.abs(a - (i + 1)) * 1.6);
        const v = pc.toFixed(2);
        if (pcCache.get(li) !== v) {
          pcCache.set(li, v);
          li.style.setProperty("--pc", v);
        }
      });
    }
  }

  /** The Opportunities tick presses down just before the satellites leave it (Fr.dock[j].press, 0..1). */
  function press(dock: { press: number }[]): void {
    const p = Math.max(dock[0]?.press ?? 0, dock[1]?.press ?? 0, dock[2]?.press ?? 0);
    const v = p.toFixed(3);
    if (v !== lastPress) {
      lastPress = v;
      links[2]?.style.setProperty("--press", v);
    }
  }

  /** Static page: the cursor sits at the current station's tick (not on the hero) and the gauge is lit below it. Reduced motion allows nothing that changes opacity or transform with
   *  the scroll, so this uses layout properties only (top, left, height, display), once, when the station changes: a state, not an animation. */
  function drawStatic(index: number): void {
    const a = clamp(index, 0, 5);
    const y = yRail(a);
    const shown = index >= 1;
    cursor.style.transform = "none";
    cursor.style.opacity = "1";
    cursor.style.left = `${(geo.cx - geo.d / 2).toFixed(1)}px`;
    cursor.style.top = `${(y - geo.d / 2).toFixed(1)}px`;
    cursor.style.display = shown ? "" : "none";
    const gapUp = shown ? (geo.d / 2) * MARK.top + 12 : 0;
    const gapDown = shown ? (geo.d / 2) * MARK.bot + 12 : 0;
    const seg = (el: HTMLElement, y0: number, y1: number, on = true): void => {
      const len = Math.max(0, y1 - y0);
      el.style.transform = "none";
      el.style.opacity = "1";
      el.style.top = `${y0.toFixed(1)}px`;
      el.style.height = `${len.toFixed(1)}px`;
      el.style.display = len < 2 || !on ? "none" : "";
    };
    seg(segUp, geo.top, Math.max(geo.top, y - gapUp));
    seg(segDown, Math.min(geo.bottom, y + gapDown), geo.bottom, shown);
  }

  /** Pressing Join Foundry: a ring leaves the cursor once (motion that answers a press; the reduced-motion rule turns it into nothing). */
  function flash(): void {
    cursor.classList.remove("flash");
    void cursor.offsetWidth;
    cursor.classList.add("flash");
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => cursor.classList.remove("flash"), 2000);
  }

  // ── the phone menu: the same list of links, opened as a panel under the pills ─────────────────────────────────────
  function setMenu(open: boolean): void {
    nav.dataset.menu = open ? "open" : "closed";
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  const isOpen = (): boolean => nav.dataset.menu === "open";
  const onMenuClick = (): void => setMenu(!isOpen());
  const onNavClick = (e: MouseEvent): void => {
    if ((e.target as Element).closest(".rail-links a")) setMenu(false);
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (isOpen() && !(e.target as Element).closest(".rail-links, .menu-btn")) setMenu(false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && isOpen()) {
      setMenu(false);
      menuBtn.focus();
    }
  };
  setMenu(false);
  menuBtn.addEventListener("click", onMenuClick);
  nav.addEventListener("click", onNavClick);
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKey);

  layout();
  return {
    layout, launchPoint, entrance, draw, press, drawStatic, flash,
    destroy() {
      menuBtn.removeEventListener("click", onMenuClick);
      nav.removeEventListener("click", onNavClick);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(flashTimer);
      cursor.classList.remove("flash");
      delete nav.dataset.menu;
      menuBtn.setAttribute("aria-expanded", "false");
      // hand the nav back to the stylesheet: no inline state of ours left behind (the ticks keep the --i the server gave them)
      for (const el of [navEnd, cursor, segUp, segDown, ...links]) for (const p of ["opacity", "transform", "left", "top", "height", "display", "--pc", "--press"]) el.style.removeProperty(p);
    },
  };
}
