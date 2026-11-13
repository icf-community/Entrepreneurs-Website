# The logo

The 2026 mark: a ring with a gap at the top and the rocket breaking out through it, plumes with slits below. The 2025 logo is retired everywhere; `logo.guard.test.ts` keeps it that way.

## Rules

- **One flat colour**: `text-star` (white) on the night, black on a light plate. Never rotated, cropped, outlined, stretched or crossed by anything.
- **Size**: the roundel's ring is at least **45 px**; the lockup (roundel plus IMPERIAL / ENTREPRENEURS) at least **51 px** tall.
- **Clear space**: a quarter of the mark's own height all round. The rocket breaks out of the ring, so "the mark" is the smallest circle that holds ring and rocket (`MARK` in `logo-data.ts`).
- **Never a word set beside the roundel alone.** The lockup is the pairing. (`BrandLogo` sets the product name "Foundry" in the display face beside the lockup, divided from it by a hairline; that is the one sanctioned use.)
- **Draw it as vector**: `<Roundel size={n} label="…" />` and `<Lockup height={n} label="…" />` from `design-system/logo/`, or `BrandLogo`. Never an `<img>` or `next/image` of a logo file.

## Files

| | |
|---|---|
| `design-system/logo/logo-data.ts` | the vector data (ROUNDEL, WORDMARK, LOCKUP, MARK). The roundel is a trace of the supplied `solid black.png`; the wordmark is the supplied outline vector; the lockup is assembled from the two by the proportions measured on the 2025 lockup (no official lockup was supplied). |
| `design-system/logo/Roundel.tsx`, `Lockup.tsx`, `components/BrandLogo.tsx` | the components |
| `frontend/scripts/logo/build-assets.mjs` | exports every raster file from the data: `src/app/icon.png`, `apple-icon.png`, `favicon.ico`, `public/logo-square.png`, `og-image.png` |
| `frontend/scripts/logo/source/` | the supplied master (`solid-black.png`) and wordmark (`wordmark-black.svg`) |
| `frontend/scripts/logo/tagline.json` | the carried-over "GO DO SHIT." trace, used only by the link-preview image |

## Changing the logo

1. Replace `logo-data.ts` (a new trace, or an official vector).
2. From `frontend/`: `node scripts/logo/build-assets.mjs` (needs Chrome through Playwright, and ImageMagick). Look at `og-image.png` and the icons.
3. Update the two fingerprints in `src/design-system/logo.guard.test.ts` and run `pnpm test`.

## Open questions for the owner

The lockup was assembled by us (nothing official was supplied); the tagline "GO DO SHIT." is carried over unchanged from the 2025 trace and still appears in the link-preview image, as it did before
(it surfaces in Slack, WhatsApp, LinkedIn and Teams previews: a brand call).
