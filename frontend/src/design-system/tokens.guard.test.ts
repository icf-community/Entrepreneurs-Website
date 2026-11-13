import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ════════════════════════════════════════════════════════════════════
// The token guard: every look comes from the design system.
//
// "One change in the design system changes the whole site" is only true while
// nothing bypasses it. These rules keep it true: colour, type size, caps and
// the colour-mix space come from tokens.css and the components, never from a
// value written into a page. A hit means: use the token (or a component) that
// already says it; if the system genuinely lacks one, add it to tokens.css
// first. Where a raw value is unavoidable (an e-mail, the inline styles of
// global-error.tsx, which renders without any CSS), the file is listed in
// ALLOWED with the reason.
// ════════════════════════════════════════════════════════════════════

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const all = walk(SRC);
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
const code = all.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const styles = all.filter((f) => f.endsWith(".css"));
const rel = (f: string) => relative(SRC, f);

// Files that may hold raw values, and why.
const ALLOWED: Record<string, string[]> = {
  "lib/email.ts": ["HTML e-mail: no CSS variables exist in a mail client"],
  "lib/emailFooter.ts": ["HTML e-mail"],
  "app/global-error.tsx": ["renders instead of the root layout, so no stylesheet: inline styles by necessity"],
};
const allowed = (f: string, rule: string) => Object.keys(ALLOWED).some((k) => rel(f) === k) || (rule === "hex" && /design-system\/logo\//.test(f));

// Strip comments so prose can talk about the things the code must not do.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");

type Rule = { name: string; why: string; re: RegExp };
const PALETTE = "black|white|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RULES: Rule[] = [
  { name: "raw-hex", why: "a hex colour in a class value or style: use a colour token", re: /-\[#[0-9a-fA-F]{3,8}\](?:\/\d+)?|\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*["'`]#[0-9a-fA-F]{3,8}/g },
  { name: "raw-colour-function", why: "rgb()/hsl()/oklch() in code: colours are tokens", re: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g },
  { name: "tailwind-palette", why: "a default Tailwind palette colour (bg-white, text-gray-400 …): use a role (bg-bg-card, text-text-muted …)", re: new RegExp(`\\b(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|placeholder|decoration|accent|caret|shadow)-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+|/\\[[^\\]]+\\])?(?![\\w-])`, "g") },
  { name: "tint-by-hand", why: "bg-white/[0.04] and friends: use bg-tint-1 … bg-tint-4", re: /\b(?:bg|border)-(?:white|black|ink|star)\/(?:\[[\d.]+\]|\d+)/g },
  { name: "arbitrary-type-size", why: "text-[0.75rem], text-[13px], text-[clamp(…)]: use text-caption … text-hero", re: /\btext-\[(?:\d|clamp|calc|var)/g },
  { name: "default-type-scale", why: "Tailwind's text-sm/text-lg …: use the Lumen scale (text-small, text-body, text-lead …)", re: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g },
  { name: "tracked-caps", why: "uppercase labels are not Lumen's voice: sentence case, no tracking", re: /\buppercase\b|\btracking-(?:wide|wider|widest)\b/g },
];

function scan(files: string[], rules: Rule[]) {
  const hits = new Map<string, string[]>();
  for (const f of files) {
    const text = stripComments(readFileSync(f, "utf8"));
    const lines = text.split("\n");
    for (const rule of rules) {
      if (allowed(f, rule.name === "raw-hex" ? "hex" : rule.name)) continue;
      lines.forEach((line, i) => {
        for (const m of line.matchAll(rule.re)) {
          const key = rule.name;
          hits.set(key, [...(hits.get(key) ?? []), `${rel(f)}:${i + 1}  ${m[0]}`]);
        }
      });
    }
  }
  return hits;
}

const hits = scan(code, RULES);

describe("nothing bypasses the design system", () => {
  for (const rule of RULES) {
    it(`${rule.name}: ${rule.why}`, () => {
      expect(hits.get(rule.name) ?? []).toEqual([]);
    });
  }

  it("no colour-mix in oklch anywhere (it loses the hue of a low-chroma colour and paints it red): mix in oklab", () => {
    const bad: string[] = [];
    for (const f of [...code, ...styles]) {
      const text = stripComments(readFileSync(f, "utf8"));
      text.split("\n").forEach((line, i) => {
        if (/color-mix\(\s*in\s+(?!oklab)/.test(line)) bad.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("stylesheets name no raw hue outside tokens.css and surfaces.css (the dust tiles are data)", () => {
    const bad: string[] = [];
    for (const f of styles) {
      if (/design-system\/(?:tokens|surfaces)\.css$/.test(f)) continue;
      const text = stripComments(readFileSync(f, "utf8"));
      text.split("\n").forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|\boklch\(/.test(line)) bad.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
