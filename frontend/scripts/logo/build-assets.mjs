#!/usr/bin/env node
// Exports the raster files of the 2026 logo from its vector data, so nothing raster is ever drawn by hand:
//
//   src/app/icon.png        512 × 512   the roundel, white on the night (the favicon source; also the manifest's icon)
//   src/app/apple-icon.png  180 × 180   the same, opaque (iOS rounds the corners itself)
//   src/app/favicon.ico     16 / 32 / 48
//   public/logo-square.png  512 × 512   the same as icon.png (the Organization logo in the JSON-LD)
//   public/logo-roundel.png 1024 wide   the roundel alone, white on transparent (the landing scene samples its alpha)
//   public/og-image.png     1200 × 630  the lockup and the tagline on the night with its glows and star dust (OG and Twitter cards)
//
// The vector data is src/design-system/logo/logo-data.ts (the roundel is a trace of source/solid-black.png, the wordmark is the supplied
// outline vector); the colours are read from src/design-system/tokens.css, so a change to the night or the ring white lands here too. The
// tagline (tagline.json) is the previous trace, carried over unchanged: only the OG image draws it.
//
//   node scripts/logo/build-assets.mjs [--only icon,favicon,roundel,og]
//
// Needs Google Chrome (through the repo's Playwright) and ImageMagick (`magick`) for the .ico and the palette PNGs. Run it from frontend/.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { LOCKUP, MARK, ROUNDEL } from "../../src/design-system/logo/logo-data.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const tagline = JSON.parse(fs.readFileSync(path.join(HERE, "tagline.json"), "utf8"));
const tokens = fs.readFileSync(path.join(ROOT, "src/design-system/tokens.css"), "utf8");
const token = (name) => {
  const m = tokens.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --color-${name} not found in tokens.css`);
  return m[1].trim();
};
const COLOR = { void: token("void"), star: token("star"), warm: token("warm"), cool: token("cool"), sun: token("sun") };

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? process.argv[process.argv.indexOf("--only") + 1] ?? "")
  .replace("--only=", "")
  .split(",")
  .filter((x) => x && !x.startsWith("--") && !x.includes("/"));
const want = (k) => only.length === 0 || only.includes(k);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logo-assets-"));
const out = (rel) => path.join(ROOT, rel);

// ── composition ───────────────────────────────────────────────────────────────────────────────────────────────
// The rocket breaks out of the ring, so the mark is taller than its ring. To centre it in a square, centre the smallest circle that holds
// all of it (MARK: radius rho ring radii, centred c ring radii above the ring's centre) and size that circle as a fraction of the square.
const R = ROUNDEL.outerR;
function roundelIn(size, fraction, fill) {
  const k = (size * fraction) / (2 * MARK.rho * R); // px per path unit
  const tx = size / 2 - ROUNDEL.cx * k;
  const ty = size / 2 + MARK.c * R * k - ROUNDEL.cy * k;
  return `<g transform="translate(${tx} ${ty}) scale(${k})" fill="${fill}"><path fill-rule="evenodd" d="${ROUNDEL.d}"/></g>`;
}

// the night's two breaths and its star dust, as the atmosphere draws them (surfaces.css), for the OG image
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dust(w, h, seed) {
  const rnd = mulberry32(seed);
  let s = "";
  for (let i = 0; i < 520; i++) {
    const x = rnd() * w, y = rnd() * h, big = rnd() > 0.93;
    const r = big ? 0.9 + rnd() * 0.8 : 0.35 + rnd() * 0.55;
    const warm = rnd() > 0.72;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${warm ? COLOR.sun : COLOR.cool}" opacity="${(big ? 0.5 : 0.18 + rnd() * 0.3).toFixed(2)}"/>`;
  }
  return s;
}

const page = (w, h, bg, body) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${bg}}svg{display:block}</style>${body}`;
const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
async function shoot(file, w, h, html, transparent = false) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
}
const magick = (...args) => execFileSync("magick", args, { stdio: ["ignore", "inherit", "inherit"] });

// ── icons ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 0.70 of the square for the large icons (a platform mask may take a fifth of the edge); 0.86 for the favicon, which has no mask and
// is seen at 16 px, where every pixel of the ring has to count.
const iconSvg = (size, fraction) => svg(size, size, `<rect width="${size}" height="${size}" fill="${COLOR.void}"/>${roundelIn(size, fraction, COLOR.star)}`);

if (want("icon")) {
  await shoot(out("src/app/icon.png"), 512, 512, page(512, 512, COLOR.void, iconSvg(512, 0.7)));
  await shoot(out("public/logo-square.png"), 512, 512, page(512, 512, COLOR.void, iconSvg(512, 0.7)));
  await shoot(out("src/app/apple-icon.png"), 180, 180, page(180, 180, COLOR.void, iconSvg(180, 0.7)));
}
if (want("favicon")) {
  const sizes = [16, 32, 48];
  const files = [];
  for (const s of sizes) {
    const f = path.join(tmp, `fav-${s}.png`);
    await shoot(f, s, s, page(s, s, COLOR.void, iconSvg(s, 0.86)));
    files.push(f);
  }
  magick(...files, out("src/app/favicon.ico"));
}

// ── the roundel alone, white on transparent: the landing scene samples this alpha channel if it is asked to ────────────
if (want("roundel")) {
  const w = 1024, h = Math.round((w * ROUNDEL.h) / ROUNDEL.w);
  const body = svg(w, h, `<g transform="scale(${w / ROUNDEL.w})" fill="#ffffff"><path fill-rule="evenodd" d="${ROUNDEL.d}"/></g>`);
  await shoot(out("public/logo-roundel.png"), w, h, page(w, h, "transparent", body), true);
}

// ── the link-preview card ─────────────────────────────────────────────────────────────────────────────────────────
if (want("og")) {
  const W = 1200, H = 630;
  const lockW = 800, lockH = (lockW * LOCKUP.h) / LOCKUP.w;
  const tagW = 330, tagH = (tagW * tagline.h) / tagline.w;
  const gap = 52;
  const top = (H - (lockH + gap + tagH)) / 2;
  const lockX = (W - lockW) / 2, tagX = (W - tagW) / 2;
  const ring = LOCKUP.roundel; // the ring's centre in lockup units, to put the warm light behind it
  const glowX = lockX + (ring.cx * lockW) / LOCKUP.w, glowY = top + (ring.cy * lockW) / LOCKUP.w;
  const inner = `
    <defs>
      <radialGradient id="warm" gradientUnits="userSpaceOnUse" cx="${glowX}" cy="${glowY}" r="520">
        <stop offset="0" stop-color="${COLOR.warm}" stop-opacity="0.16"/><stop offset="1" stop-color="${COLOR.warm}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="cool" gradientUnits="userSpaceOnUse" cx="${W}" cy="${H}" r="640">
        <stop offset="0" stop-color="${COLOR.cool}" stop-opacity="0.12"/><stop offset="1" stop-color="${COLOR.cool}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="${COLOR.void}"/>
    <rect width="${W}" height="${H}" fill="url(#warm)"/>
    <rect width="${W}" height="${H}" fill="url(#cool)"/>
    ${dust(W, H, 2026)}
    <g transform="translate(${lockX} ${top}) scale(${lockW / LOCKUP.w})" fill="${COLOR.star}"><path fill-rule="${LOCKUP.rule}" d="${LOCKUP.d}"/></g>
    <g transform="translate(${tagX} ${top + lockH + gap}) scale(${tagW / tagline.w})" fill="${COLOR.star}"><path d="${tagline.d}"/></g>`;
  const raw = path.join(tmp, "og-raw.png");
  await shoot(raw, W, H, page(W, H, COLOR.void, svg(W, H, inner)));
  // link-preview scrapers fetch this raw: a 64-colour palette with dithering keeps the glows smooth and the file small
  magick(raw, "-dither", "FloydSteinberg", "-colors", "96", "-strip", `PNG8:${out("public/og-image.png")}`);
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of ["src/app/icon.png", "src/app/apple-icon.png", "src/app/favicon.ico", "public/logo-square.png", "public/logo-roundel.png", "public/og-image.png"]) {
  const p = out(f);
  if (fs.existsSync(p)) console.log(`${f.padEnd(26)} ${String(fs.statSync(p).size).padStart(7)} bytes`);
}
