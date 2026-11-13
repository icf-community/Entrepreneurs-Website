import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DRAWINGS } from "./drawings";
import { Icon } from "./Icon";
import { ICON_NAMES } from "./names";

// The icon vocabulary can never drift: every name in names.ts has a drawing, every drawing has a name, nothing is the placeholder ring,
// nothing carries a colour of its own, and everything sits on the 24 grid.

const markup = (name: (typeof ICON_NAMES)[number]) => renderToStaticMarkup(createElement(Icon, { name }));

/** Marks that are somebody else's trademark: drawn as supplied, to the edge of the grid, and exempt from the opening rule and the margin. */
const BRAND = new Set<string>(["github", "linkedin", "instagram"]);

describe("icon names", () => {
  it("are unique, kebab-case and not empty", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("each have a drawing, and every drawing has a name", () => {
    const missing = ICON_NAMES.filter((name) => !DRAWINGS[name]);
    expect(missing, `no drawing for: ${missing.join(", ")}`).toEqual([]);
    const known = new Set<string>(ICON_NAMES);
    const extra = Object.keys(DRAWINGS).filter((key) => !known.has(key));
    expect(extra, `drawn but not in names.ts: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("every icon", () => {
  it.each(ICON_NAMES)("%s is drawn (not the placeholder ring) and carries no colour of its own", (name) => {
    const svg = markup(name);
    const shapes = svg.match(/<(path|circle)\b/g) ?? [];
    expect(shapes.length, `${name} draws nothing`).toBeGreaterThan(0);
    // the placeholder was one circle of radius 8 at the centre
    expect(svg).not.toMatch(/<circle cx="12" cy="12" r="8"\s*\/>/);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(|style=|<linearGradient|<mask|<filter/);
    for (const fill of svg.matchAll(/\sfill="([^"]*)"/g)) expect(["none", "currentColor"]).toContain(fill[1]);
    for (const stroke of svg.matchAll(/\sstroke="([^"]*)"/g)) expect(["none", "currentColor"]).toContain(stroke[1]);
  });

  it.each(ICON_NAMES)("%s stays on the 24 grid with room for its stroke", (name) => {
    const svg = markup(name);
    const lo = BRAND.has(name) ? 0 : 0.9;
    const hi = BRAND.has(name) ? 24 : 23.1;
    const box = boundsOf(svg);
    expect(box.minX, `${name} leaves the grid on the left`).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(box.minY, `${name} leaves the grid at the top`).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(box.maxX, `${name} leaves the grid on the right`).toBeLessThanOrEqual(hi + 1e-6);
    expect(box.maxY, `${name} leaves the grid at the bottom`).toBeLessThanOrEqual(hi + 1e-6);
    // and it is drawn at the size of the family, not a speck: one side spans at least 12 units
    expect(Math.max(box.maxX - box.minX, box.maxY - box.minY), `${name} is too small`).toBeGreaterThanOrEqual(12);
  });
});

describe("the opening rule", () => {
  // Every silhouette has exactly one opening, so a stroked path must never close on itself. The only closed strokes are marks INSIDE a
  // silhouette (texture, not outline) and a company's own mark; each is named here with how many closed subpaths it may have.
  const CLOSED_OK: Record<string, number> = {
    settings: 1, // the gear's hub
    edit: 1, // the pencil: the part that leaves the page is a figure of its own
    globe: 1, // the meridian inside the ring
    instagram: 2, // the company's own mark
  };

  it.each(ICON_NAMES)("%s has no stroked outline that closes on itself", (name) => {
    const closed = closedStrokes(markup(name));
    expect(closed, `${name} closes a stroked outline: give it an opening, or allow it here with a reason`).toBeLessThanOrEqual(CLOSED_OK[name] ?? 0);
  });

  it("allows only icons that exist", () => {
    const known = new Set<string>(ICON_NAMES);
    for (const name of Object.keys(CLOSED_OK)) expect(known.has(name), name).toBe(true);
  });
});

describe("<Icon>", () => {
  it("is decorative without a title and an image with one", () => {
    const decorative = renderToStaticMarkup(createElement(Icon, { name: "home" }));
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("role=");
    const named = renderToStaticMarkup(createElement(Icon, { name: "home", title: "Home" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Home"');
    expect(named).not.toContain("aria-hidden");
  });

  it("draws on the 24 grid with the family's stroke and size", () => {
    const svg = renderToStaticMarkup(createElement(Icon, { name: "search", size: 16 }));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.75"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
    expect(svg).toContain('data-icon="search"');
  });
});

// ── a small SVG path walker: the bounds of everything the markup draws (control points included, arcs sampled) ──────────────────

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boundsOf(svg: string): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  type Map2 = (x: number, y: number) => [number, number];
  const stack: Map2[] = [(x, y) => [x, y]];
  const add: Map2 = (x, y) => {
    const [tx, ty] = stack[stack.length - 1](x, y);
    box.minX = Math.min(box.minX, tx);
    box.minY = Math.min(box.minY, ty);
    box.maxX = Math.max(box.maxX, tx);
    box.maxY = Math.max(box.maxY, ty);
    return [tx, ty];
  };
  for (const tag of svg.matchAll(/<(\/?)(g|path|circle)\b([^>]*)>/g)) {
    const [, closing, name, attrs] = tag;
    if (closing && name !== "g") continue;
    if (name === "g") {
      if (closing) stack.pop();
      else stack.push(compose(stack[stack.length - 1], /transform="([^"]*)"/.exec(attrs)?.[1] ?? ""));
    } else if (name === "circle") {
      const [cx, cy, r] = ["cx", "cy", "r"].map((k) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(attrs)?.[1]));
      add(cx - r, cy - r);
      add(cx + r, cy + r);
    } else {
      const d = /d="([^"]+)"/.exec(attrs)?.[1];
      if (d) walk(d, add);
    }
  }
  return box;
}

/** How many stroked subpaths of the markup close on themselves (a Z, or a path that ends where it began). Solid parts do not count. */
function closedStrokes(svg: string): number {
  let count = 0;
  for (const tag of svg.matchAll(/<path\b([^>]*)>/g)) {
    const attrs = tag[1];
    if (/fill="currentColor"/.test(attrs)) continue;
    const d = /d="([^"]+)"/.exec(attrs)?.[1] ?? "";
    for (const sub of d.split(/(?=M)/).filter(Boolean)) {
      let first: [number, number] | null = null;
      let last: [number, number] = [0, 0];
      walk(sub, (x, y) => {
        first ??= [x, y];
        last = [x, y];
      });
      const returns = first !== null && sub.length > 20 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.35;
      if (/[zZ]/.test(sub) || returns) count++;
    }
  }
  return count;
}

/** The transforms the set uses: rotate(a cx cy), translate(x y), scale(s), in any order. */
function compose(parent: (x: number, y: number) => [number, number], transform: string): (x: number, y: number) => [number, number] {
  const steps = [...transform.matchAll(/(rotate|translate|scale)\(([^)]*)\)/g)].map((m) => ({ kind: m[1], args: m[2].split(/[\s,]+/).filter(Boolean).map(Number) }));
  return (x, y) => {
    let [px, py] = [x, y];
    for (let i = steps.length - 1; i >= 0; i--) {
      const { kind, args } = steps[i];
      if (kind === "translate") [px, py] = [px + args[0], py + (args[1] ?? 0)];
      else if (kind === "scale") [px, py] = [px * args[0], py * (args[1] ?? args[0])];
      else {
        const a = (args[0] * Math.PI) / 180;
        const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
        [px, py] = [cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)];
      }
    }
    return parent(px, py);
  };
}

function walk(d: string, put: (x: number, y: number) => void) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (up === "Z") {
      x = sx;
      y = sy;
    } else if (up === "M" || up === "L" || up === "T") {
      x = ox + num();
      y = oy + num();
      put(x, y);
      if (up === "M") {
        sx = x;
        sy = y;
        cmd = rel ? "l" : "L";
      }
    } else if (up === "H") {
      x = ox + num();
      put(x, y);
    } else if (up === "V") {
      y = oy + num();
      put(x, y);
    } else if (up === "C") {
      for (let k = 0; k < 3; k++) put(ox + num(), oy + num());
      x = ox + Number(tokens[i - 2]);
      y = oy + Number(tokens[i - 1]);
    } else if (up === "S" || up === "Q") {
      for (let k = 0; k < 2; k++) put(ox + num(), oy + num());
      x = ox + Number(tokens[i - 2]);
      y = oy + Number(tokens[i - 1]);
    } else if (up === "A") {
      const rx = num();
      const ry = num();
      const rot = num();
      // the flags may be written without separators ("00-3.8"): read them one digit at a time
      const flag = () => {
        const t = tokens[i];
        if (t.length > 1 && (t[0] === "0" || t[0] === "1") && !t.startsWith("0.")) {
          tokens[i] = t.slice(1);
          return Number(t[0]);
        }
        i++;
        return Number(t);
      };
      const large = flag();
      const sweep = flag();
      const nx = ox + num();
      const ny = oy + num();
      sampleArc(x, y, rx, ry, rot, large, sweep, nx, ny, put);
      x = nx;
      y = ny;
    } else {
      throw new Error(`unsupported path command ${cmd}`);
    }
  }
}

/** The SVG endpoint-to-centre arc conversion, then a sample every few degrees. */
function sampleArc(x1: number, y1: number, rxIn: number, ryIn: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number, put: (x: number, y: number) => void) {
  if (rxIn === 0 || ryIn === 0) return put(x2, y2);
  const phi = (rotDeg * Math.PI) / 180;
  const [cp, sp] = [Math.cos(phi), Math.sin(phi)];
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(dt) / (Math.PI / 24)));
  for (let k = 0; k <= steps; k++) {
    const t = t1 + (dt * k) / steps;
    put(cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp);
  }
}
