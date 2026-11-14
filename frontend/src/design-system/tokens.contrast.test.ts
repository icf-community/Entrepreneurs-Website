import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ════════════════════════════════════════════════════════════════════
// Lumen's colour contract, computed from tokens.css itself.
//
// Reads the custom properties, evaluates them the way a browser does (oklch,
// color-mix in oklab with premultiplied alpha, var()), composites translucent
// tints over their surface in gamma-encoded sRGB, and asserts WCAG 2.2:
//   - text ≥ 4.5:1 on every surface, and on every surface with a tint laid on it
//   - the edge of anything you can press (border-strong) and the focus ring ≥ 3:1
//   - no purple anywhere (OKLCH hue 285–345° at chroma ≥ 0.03): the brand's rule
// Change a token and this says whether the change is allowed.
// ════════════════════════════════════════════════════════════════════

const css = readFileSync(join(__dirname, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const VARS = new Map<string, string>();
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) VARS.set(m[1], m[2].trim().replace(/\s+/g, " "));

type Lab = { L: number; a: number; b: number; alpha: number };

function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function evalColor(expr: string): Lab {
  const e = expr.trim();
  if (e === "transparent") return { L: 0, a: 0, b: 0, alpha: 0 };
  const v = e.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (v) {
    const got = VARS.get(v[1]);
    if (!got) throw new Error(`unknown token ${v[1]}`);
    return evalColor(got);
  }
  const o = e.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (o) {
    const L = o[1].endsWith("%") ? parseFloat(o[1]) / 100 : parseFloat(o[1]);
    const C = parseFloat(o[2]);
    const H = (parseFloat(o[3]) * Math.PI) / 180;
    const alpha = o[4] === undefined ? 1 : o[4].endsWith("%") ? parseFloat(o[4]) / 100 : parseFloat(o[4]);
    return { L, a: C * Math.cos(H), b: C * Math.sin(H), alpha };
  }
  const mix = e.match(/^color-mix\((.*)\)$/i);
  if (mix) {
    const [space, ...rest] = splitTop(mix[1]);
    if (!/^in oklab$/i.test(space)) throw new Error(`colour mixing must be "in oklab" (oklch loses the hue of a low-chroma colour): ${expr}`);
    const parse = (arg: string) => {
      const m = arg.match(/^(.*?)(?:\s+([\d.]+)%)?$/);
      return { color: evalColor(m![1]), pct: m![2] === undefined ? undefined : parseFloat(m![2]) };
    };
    const [x, y] = rest.map(parse);
    let p = x.pct, q = y.pct;
    if (p === undefined && q === undefined) { p = 50; q = 50; } else if (p === undefined) p = 100 - q!; else if (q === undefined) q = 100 - p;
    const sum = p! + q!;
    const wp = p! / sum, wq = q! / sum;
    const alpha = wp * x.color.alpha + wq * y.color.alpha;
    const premul = (k: "L" | "a" | "b") => (wp * x.color.alpha * x.color[k] + wq * y.color.alpha * y.color[k]) / (alpha || 1);
    return { L: premul("L"), a: premul("a"), b: premul("b"), alpha: alpha * (sum / 100) };
  }
  throw new Error(`cannot evaluate colour: ${expr}`);
}

const token = (name: string) => evalColor(`var(--color-${name})`);

type RGB = { r: number; g: number; b: number };
const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const dec = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const clip = (v: number) => Math.min(1, Math.max(0, v));
function toSrgb({ L, a, b }: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clip(enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clip(enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clip(enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}
/** a colour drawn over an opaque backdrop, composited in gamma-encoded sRGB like a browser */
function over(fg: Lab, bg: RGB): RGB {
  const f = toSrgb(fg);
  return { r: f.r * fg.alpha + bg.r * (1 - fg.alpha), g: f.g * fg.alpha + bg.g * (1 - fg.alpha), b: f.b * fg.alpha + bg.b * (1 - fg.alpha) };
}
const lum = ({ r, g, b }: RGB) => 0.2126 * dec(r) + 0.7152 * dec(g) + 0.0722 * dec(b);
const ratio = (x: RGB, y: RGB) => {
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["bg-primary", "bg-secondary", "bg-card", "bg-card-hover", "bg-raised"] as const;
const TINTS = [undefined, "tint-1", "tint-2", "tint-3"] as const;
const surfaceRgb = (name: (typeof SURFACES)[number], tint?: string): RGB => {
  const base = toSrgb(token(name));
  return tint ? over(token(tint), base) : base;
};
const textRgb = (name: string, on: RGB): RGB => over(token(name), on);

describe("the palette is evaluated the way a browser evaluates it", () => {
  it("the six lights are what the doc says", () => {
    const rgb = (n: string) => toSrgb(token(n));
    const hex = ({ r, g, b }: RGB) => [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    expect(hex(rgb("void"))).toBe("04080d"); // layout.tsx's themeColor and manifest.ts
    expect(hex(rgb("star"))).toBe("ffffff");
  });

  it("the literals in app/global-error.tsx (it renders with no stylesheet) are the tokens, to one step in a channel", () => {
    // The one page that cannot read the tokens at runtime keeps a hand-written copy. Change a token and this names the literal to change with it.
    const src = readFileSync(join(__dirname, "../app/global-error.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const page = surfaceRgb("bg-primary");
    const lights = [toSrgb(token("void")), toSrgb(token("star")), ...["text-primary", "text-secondary", "text-muted"].map((n) => textRgb(n, page))];
    const literals = [...src.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1].toLowerCase());
    expect(literals.length).toBeGreaterThan(0);
    for (const lit of literals) {
      const ch = [0, 2, 4].map((i) => parseInt(lit.slice(i, i + 2), 16));
      const near = lights.some((c) => [c.r, c.g, c.b].every((v, i) => Math.abs(Math.round(v * 255) - ch[i]) <= 1));
      expect(near, `#${lit} is not one of void, star, text-primary, text-secondary or text-muted on the page`).toBe(true);
    }
  });

  it("every colour mix in the tokens is in oklab (a mix in oklch loses the hue of a low-chroma colour and paints it red)", () => {
    for (const [name, value] of VARS) {
      for (const m of value.matchAll(/color-mix\(\s*in\s+(\w+)/g)) expect(m[1], name).toBe("oklab");
      if (name.startsWith("--color-")) expect(() => evalColor(value), name).not.toThrow();
    }
  });
});

describe("text reads (WCAG 1.4.3, 4.5:1)", () => {
  for (const role of ["text-primary", "text-secondary", "text-muted"]) {
    for (const surface of SURFACES) {
      for (const tint of TINTS) {
        it(`${role} on ${surface}${tint ? ` + ${tint}` : ""}`, () => {
          const bg = surfaceRgb(surface, tint);
          expect(ratio(textRgb(role, bg), bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  // the lit words: a link, a chosen thing, a badge, a status. Each on the surfaces it is ever set on.
  for (const role of ["accent", "accent-light", "accent-dim", "lit", "danger", "success", "info"]) {
    for (const surface of ["bg-primary", "bg-secondary", "bg-card", "bg-card-hover", "bg-raised"] as const) {
      it(`${role} on ${surface}`, () => {
        const bg = surfaceRgb(surface);
        expect(ratio(textRgb(role, bg), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it.each([
    ["accent-light", "lit-muted"],
    ["lit", "lit-muted"],
    ["danger", "danger-muted"],
    ["success", "success-muted"],
    ["accent-light", "accent-muted"],
  ])("%s on its own wash (%s) over a panel", (role, wash) => {
    const bg = over(token(wash), surfaceRgb("bg-card"));
    expect(ratio(textRgb(role, bg), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("the primary button: the night on cream, at AAA (7:1), at rest and hovered", () => {
    const sun = toSrgb(token("sun"));
    const hovered = toSrgb(evalColor("color-mix(in oklab, var(--color-sun) 70%, var(--color-star))"));
    expect(ratio(toSrgb(token("void")), sun)).toBeGreaterThanOrEqual(7);
    expect(ratio(toSrgb(token("void")), hovered)).toBeGreaterThanOrEqual(7);
  });
});

describe("controls and focus are seen (WCAG 1.4.11, 3:1)", () => {
  for (const surface of ["bg-primary", "bg-secondary", "bg-card", "bg-raised"] as const) {
    it(`border-strong on ${surface}`, () => {
      const bg = surfaceRgb(surface);
      expect(ratio(toSrgb(token("border-strong")), bg)).toBeGreaterThanOrEqual(3);
    });
    it(`a pointed-at control's edge (edge-hover) on ${surface}`, () => {
      const bg = surfaceRgb(surface);
      expect(ratio(toSrgb(token("edge-hover")), bg)).toBeGreaterThanOrEqual(3);
    });
    it(`a chosen control's edge (edge-lit, translucent) on ${surface}`, () => {
      const bg = surfaceRgb(surface);
      expect(ratio(over(token("edge-lit"), bg), bg)).toBeGreaterThanOrEqual(3);
    });
    it(`the focus ring on ${surface}`, () => {
      const bg = surfaceRgb(surface);
      expect(ratio(toSrgb(token("focus")), bg)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("no purple (the brand's rule: OKLCH hue 285–345° at chroma ≥ 0.03)", () => {
  it("no colour token is purple", () => {
    const offenders: string[] = [];
    for (const [name, value] of VARS) {
      if (!name.startsWith("--color-")) continue;
      const c = evalColor(value);
      if (c.alpha === 0) continue;
      const chroma = Math.hypot(c.a, c.b);
      const hue = ((Math.atan2(c.b, c.a) * 180) / Math.PI + 360) % 360;
      if (chroma >= 0.03 && hue >= 285 && hue <= 345) offenders.push(`${name}: hue ${hue.toFixed(0)}, chroma ${chroma.toFixed(3)}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("DESIGN.md states the colours tokens.css has", () => {
  // DESIGN.md's frontmatter is the portable statement of the system; it must not drift from the one place the values live.
  const doc = readFileSync(join(__dirname, "..", "..", "..", "DESIGN.md"), "utf8");
  const block = doc.match(/\ncolors:\n((?:  [a-z0-9-]+: "[^"]+"\n)+)/)?.[1] ?? "";
  const NAME: Record<string, string> = {
    void: "void", ink: "ink", star: "star", sun: "sun", warm: "warm", cool: "cool",
    "surface-secondary": "bg-secondary", "surface-card": "bg-card", "surface-card-hover": "bg-card-hover", "surface-raised": "bg-raised",
    "text-secondary": "text-secondary", "text-muted": "text-muted", border: "border", "border-subtle": "border-subtle", "border-strong": "border-strong",
    "accent-light": "accent-light", "accent-dim": "accent-dim", danger: "danger", success: "success",
  };
  const entries = [...block.matchAll(/  ([a-z0-9-]+): "([^"]+)"/g)];

  it("lists every colour it claims", () => {
    expect(entries.length).toBe(Object.keys(NAME).length);
  });

  for (const [, key, value] of entries) {
    it(`${key} is the token's colour`, () => {
      expect(NAME[key], `${key} has no token mapping`).toBeDefined();
      const doc_ = evalColor(value), tok = token(NAME[key]);
      const d = Math.hypot(doc_.L - tok.L, doc_.a - tok.a, doc_.b - tok.b);
      expect(d, `DESIGN.md says ${value} but tokens.css gives a different colour`).toBeLessThan(0.004);
    });
  }
});
