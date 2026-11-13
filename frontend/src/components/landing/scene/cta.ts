// Lumen · the one action. "Join Foundry" at the end of the page is the burn that puts the waiting visitor into orbit, so it is drawn like it:
// an orbit ring that follows the pill exactly (an SVG path built from the button's real size, so it is a true pill at every width), a comet that
// circles it, and a warm light behind it. Pressing it locks the ring and sends a signal to the visitor in the scene (scene/engine.ts moves the signal).
// Everything here is a state or a loop of the stylesheet; this file only fits the ring to the button and records the press.

export interface Cta {
  /** Pressed: the ring locks (CSS) and one ring leaves the pill. */
  join(): void;
  destroy(): void;
}

export function mountCta(root: HTMLElement): Cta | null {
  const btn = root.querySelector<HTMLElement>("#join");
  const svg = btn?.querySelector(".btn-ring svg");
  if (!btn || !svg) return null;
  const paths = [...btn.querySelectorAll(".btn-ring path")];
  let alive = true;

  /** The ring: the pill's outline, `--off` px outside it. pathLength is 100 in the markup, so dash lengths are shares of the lap whatever the size. */
  function fit(): void {
    const off = parseFloat(getComputedStyle(btn as HTMLElement).getPropertyValue("--off")) || 9;
    const w = (btn as HTMLElement).offsetWidth + off * 2;
    const h = (btn as HTMLElement).offsetHeight + off * 2;
    const r = h / 2;
    if (!w || !h) return;
    (svg as SVGElement).setAttribute("width", String(w));
    (svg as SVGElement).setAttribute("height", String(h));
    (svg as SVGElement).setAttribute("viewBox", `0 0 ${w} ${h}`);
    const d = `M ${r} 1 H ${w - r} A ${r - 1} ${r - 1} 0 0 1 ${w - r} ${h - 1} H ${r} A ${r - 1} ${r - 1} 0 0 1 ${r} 1 Z`;
    for (const p of paths) p.setAttribute("d", d);
  }
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(btn);
  void document.fonts?.ready.then(() => {
    if (alive) fit();
  });

  return {
    join() {
      btn.classList.add("joined");
    },
    destroy() {
      alive = false;
      ro.disconnect();
      btn.classList.remove("joined");
    },
  };
}
