import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCKUP, ROUNDEL } from "./logo/logo-data";

// ════════════════════════════════════════════════════════════════════
// The logo guard: the 2026 logo is the only logo, and it is drawn by the rules.
//
// The site changed logos in 2026 (the rocket now breaks out of the ring). These
// tests keep it from quietly reverting, and keep the usage rules the brand
// asked for true in code: one flat colour, the roundel at 45 px or more, the
// lockup at 51 px or more, drawn as vector by <Roundel> / <Lockup>, never as an
// image of an older file.
//
// If the logo is MEANT to change: replace src/design-system/logo/logo-data.ts,
// run `node scripts/logo/build-assets.mjs` from frontend/ (it re-exports every
// raster file), and update the two fingerprints below.
// ════════════════════════════════════════════════════════════════════

const FRONTEND = join(__dirname, "..", "..");
const SRC = join(FRONTEND, "src");

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const sources = walk(SRC).filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.endsWith("logo.guard.test.ts"));
const tsx = sources.filter((f) => f.endsWith(".tsx"));
const read = (f: string) => readFileSync(f, "utf8");
// comments may talk about the logo and its history; only code can draw it or point at a file
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => relative(FRONTEND, f);

describe("the 2026 logo is the only logo", () => {
  it("the vector data is the 2026 trace", () => {
    expect(sha(ROUNDEL.d), "ROUNDEL changed: regenerate the rasters and update the fingerprint").toBe("68c4b31616c486d5");
    expect(sha(LOCKUP.d), "LOCKUP changed: regenerate the rasters and update the fingerprint").toBe("41d105d3257f0684");
  });

  it.each(["public/logo-full.png", "public/logo-lockup.png", "public/entrepreneurs-logo.png"])("the 2025 file %s is gone", (file) => {
    expect(existsSync(join(FRONTEND, file))).toBe(false);
  });

  it("no source file refers to a 2025 logo file", () => {
    const hits = sources.filter((f) => /logo-full|logo-lockup|entrepreneurs-logo/.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("nothing draws the logo as an image: it is <Roundel> or <Lockup>, vector, one flat colour", () => {
    const hits = tsx
      .filter((f) => /<(?:Image|img)\b[^>]*\bsrc=(?:"|'|\{)[^>]*logo/.test(code(f).replace(/\s+/g, " ")))
      .map(rel);
    expect(hits).toEqual([]);
  });
});

describe("the logo is never drawn smaller than its rules allow", () => {
  it("every <Roundel size={n}> is at least 45 px (the ring), every <Lockup height={n}> at least 51", () => {
    const small: string[] = [];
    for (const f of tsx) {
      const text = read(f);
      for (const m of text.matchAll(/<Roundel\b[^>]*?\bsize=\{(\d+)\}/g)) if (Number(m[1]) < 45) small.push(`${rel(f)}: Roundel ${m[1]}`);
      for (const m of text.matchAll(/<Lockup\b[^>]*?\bheight=\{(\d+)\}/g)) if (Number(m[1]) < 51) small.push(`${rel(f)}: Lockup ${m[1]}`);
    }
    expect(small).toEqual([]);
  });

  it("BrandLogo's heights are all at least 51", () => {
    const text = read(join(SRC, "components/BrandLogo.tsx"));
    const block = text.match(/const HEIGHT[^{]*\{([^}]*)\}/)?.[1] ?? "";
    const heights = [...block.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(51);
  });
});

describe("the raster exports exist at their sizes (scripts/logo/build-assets.mjs)", () => {
  const png = (file: string) => {
    const b = readFileSync(join(FRONTEND, file));
    expect(b.subarray(1, 4).toString("ascii"), `${file} is a PNG`).toBe("PNG");
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  };

  it.each([
    ["src/app/icon.png", 512, 512],
    ["src/app/apple-icon.png", 180, 180],
    ["public/logo-square.png", 512, 512],
    ["public/og-image.png", 1200, 630],
  ] as const)("%s is %i × %i", (file, w, h) => {
    expect(png(file)).toEqual({ w, h });
  });

  it("favicon.ico holds 16, 32 and 48 px frames", () => {
    const b = readFileSync(join(FRONTEND, "src/app/favicon.ico"));
    expect(b.readUInt16LE(2), "an icon file").toBe(1);
    const count = b.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => b[6 + i * 16] || 256).sort((a, c) => a - c);
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("the link-preview card stays small enough for every scraper (under 300 KB)", () => {
    expect(statSync(join(FRONTEND, "public/og-image.png")).size).toBeLessThan(300_000);
  });
});
