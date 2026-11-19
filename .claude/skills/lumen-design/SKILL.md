---
name: lumen-design
description: Foundry's Lumen design system. Use for ANY UI work in this repo — a new page, component, section, or a change to words on a page (including the landing page) — so the result sits in the existing look and flow and passes the design guards. Triggers: add/change/restyle a page, component, copy, landing section, panel, form, dialog, "make it match the design".
---

# Lumen: how to build in Foundry's design

The owner likes the existing design and does not want it disturbed. **Reuse what exists; add to the system, never around it.** The sources of truth, in reading order:

1. `DESIGN.md` (repo root): the one-page statement. Read it before designing anything.
2. `docs/design-system/README.md`, then the family doc you need (`shell`, `forms`, `overlays`, `data`, `icons`, `logo`, `landing`).
3. `frontend/src/design-system/tokens.css`: the only place a value (colour, size, radius, motion) is decided.
4. `/admin/design-system` (admin login): the living guide that renders the real components.

## The idea, in five lines

- Foundry is a **night with six lights** (void, ink, star, sun, warm, cool). Colour is *direction*, not decoration. Dark only.
- **Cream (`sun`) is the one action and the focus ring.** **Amber (`warm`) is light itself** (glow, chosen, lit) and never an action fill. **At most one lit thing per view.**
- **Funnel Display** (light, tight) for headings, **Host Grotesk** for everything else. Sentence case, normal tracking, no monospace.
- Depth is a hairline and a whisper of top light. One soft shadow only for overlays. Warm light only on a lit thing or the thing being pointed at.
- The recurring shape is the **ring with one opening** (the logo). Rule lines draw and light their end. Idle motion is 8 s or slower and rests under reduced motion.

## Rules you must not break (the guards fail the build)

- **Name a role, never a hue**: `bg-bg-card`, `text-text-muted`, `border-border-strong`, `text-body`, `text-small`, `rounded-xl`. No hex, `rgb()`, default Tailwind palette (`bg-black/60`, `text-gray-400`), arbitrary or default type sizes (`text-[13px]`), `uppercase` tracking. If a role is missing, add it to `tokens.css` first.
- A component's look is a class in a design-system stylesheet keyed by `data-*` (`data-variant`, `data-tone`, `data-size`); a page never carries a long utility string for it. Use `components/ui/*` (`Button`, `Panel`, `Entry`, `Badge`, `Page`, `PageHead`, `Trail`, `Input`, `Select`, `Dialog`, `Table`, `Timeline` …). Never nest a panel in a panel.
- Colour mixes are `color-mix(in oklab, …)` only. No purple, gradient text, coloured card stripes, hard offset shadows, glass as decoration.
- Every page sits in `Page` (one side margin, one column width, same left edge) and opens with `PageHead`; a page with a parent says so with one `Trail`.
- **Never key a multi-column grid to the window beside the rail** (`lg:grid-cols-3`): use `lm-cards`, `lm-tiles`, `lm-filters`, `lm-actionrow`, or `xl:`.
- Nothing scrolls sideways at 320 px; every control is at least 44 px; a state is a mark and a word, never colour alone; every control has hover, `:focus-visible`, disabled, loading and error states.
- Keep every word and every accessible name when restyling. Secondary text goes behind a disclosure, popover or tooltip, not in the bin.
- The logo is vector only (`Roundel`, `Lockup`), at least 45 px / 51 px, never an `<img>`, never beside a word on its own. Only the 2026 logo exists.
- A page wrapper never takes an opaque background: the atmosphere is the night behind every page. Public pages use `100svh`, not `100vh`.

## Copy

Short. One sentence, and a link if more is needed; no explaining paragraphs in member-facing UI. Sentence case. Keep legal lines verbatim (IC Founders Ltd company line, "not operated or endorsed by Imperial College London", copyright).

## The landing page (`/`) is different: read `docs/design-system/landing.md`

- It is **statically prerendered** and listed in `STATIC_CSP_ROUTES`. Everything under `components/landing` and `lib/landing` is server markup: no cookies, headers, query string, database, network, form field or `innerHTML`. Two unit tests scan every file there.
- **Words live in `frontend/src/lib/landing/content.ts`**; each section component renders from it. Its stylesheet is `landing.css`, scoped under `.lumen`, lengths as `calc(N * var(--r))` (the root is 125%), colours from tokens.
- **The 3D scene reads the page.** It measures where each entry's words sit and keeps its bodies clear of them (`ENTRY_SEL`, the poses in `director.ts`). Adding or moving text changes that layout, so a new line needs a proper home in the section's markup, not an absolute-positioned afterthought.
- Every word must still be real markup with JavaScript off, and the page must read in `data-mode="static"` (reduced motion or no WebGL).
- A drawing is the design system's `Glyph` / `Icon`; the scene follows it.

## Doing a change

1. Find the nearest existing thing in `/admin/design-system` or on a neighbouring page and copy its structure.
2. Put any new look in the family's stylesheet as an `lm-*` class reading only tokens; add it to the family's gallery section and doc.
3. Look at it: **1440 and 390 px at least, and 320 px for anything with text**. For the landing page also reduced motion, no WebGL, and no JavaScript, and compare `?still&p=<0..1>` frames before and after.
4. Verify (from `frontend/`): `pnpm exec tsc --noEmit`, `pnpm exec eslint .`, `pnpm exec vitest run` (includes the three guards), `pnpm dlx react-doctor@latest .` (currently 100), and for anything user-visible `scripts/e2e-local.sh --project=public --project=member` after a fresh build (never test a build you did not just make). Confirm `/` is still `○ (Static)` in the build output.
5. Run `graphify update .` after code changes.

## Anti-patterns that have already cost time here

- Adding a new colour, radius or size inline instead of a token.
- Giving the landing page a client-only or request-dependent piece (breaks static rendering and the static CSP).
- Restyling and silently dropping words or accessible names.
- A bare-text control with no visible shape: every control needs a visible edge (`--color-border-strong`).
