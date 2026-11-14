# Lumen: Foundry's design system

Lumen treats colour as **light direction, not decoration**. The product is a night with six lights in it, one curve that everything moves on, and a handful of gestures that all
come from the logo: a ring with an opening where the rocket breaks out, a hairline rule that draws and lights its end, a body in orbit. Everything on screen is a *role* built from
those lights, so the look is decided in one file and the whole site follows it.

`DESIGN.md` (repo root) is the one-page statement of the system, in the format design tools read. This folder is the working documentation.

## Where things live

| What | Where |
|---|---|
| **The values** (colour, type scale, shape, depth, motion) | `frontend/src/design-system/tokens.css`. The one place a look is decided. |
| Resets, focus ring, selection, scrollbars, the page | `design-system/base.css` |
| Voice that sizes alone cannot carry (`.font-display`, `.data`, `.measure`) | `design-system/typography.css` |
| Keyframes, rule-draw, reduced-motion contract | `design-system/motion.css` |
| The night behind every page (the atmosphere) | `design-system/surfaces.css` |
| Classes behind Button, Panel, Entry, Badge, PageHead | `design-system/components.css` |
| The signed-in frame: rail, app bar, drawer | `design-system/shell.css` ([shell.md](shell.md)) |
| Form controls | `design-system/forms.css` ([forms.md](forms.md)) |
| Dialogs, sheets, popovers, menus, toasts, banners, skeletons | `design-system/overlays.css` ([overlays.md](overlays.md)) |
| Tabs, avatars, tables, stats, meters, empty states, pagers | `design-system/data.css` ([data.md](data.md)) |
| Icons and glyphs | `design-system/icons/` ([icons.md](icons.md)) |
| The 2026 logo (vector data, `<Roundel>`, `<Lockup>`) and its raster exports | `design-system/logo/`, `frontend/scripts/logo/` ([logo.md](logo.md)) |
| The components pages import | `frontend/src/components/ui/*` |
| The landing page | `frontend/src/components/landing/` ([landing.md](landing.md), [landing-extras.md](landing-extras.md)) |
| **The living style guide** (renders the real components) | `/admin/design-system` (admin login) |

## The rule: change it in one place

A page never names a hue, a size or a radius. It names a **role** (`bg-bg-card`, `text-text-muted`, `border-border-strong`, `text-small`, `rounded-xl`) or uses a **component**
(`Button`, `Panel`, `Entry`, `PageHead`, `Dialog`, `Input` …). The component's look is a class in a design-system stylesheet, keyed by `data-*` attributes (`data-variant`, `data-tone`,
`data-size`), never a long utility string in a page. So:

- *Re-colour the product*: edit the six lights and the surface steps in `tokens.css`. Contrast is re-checked by `tokens.contrast.test.ts`.
- *Make everything rounder, denser, bigger*: `--radius-*`, the `--text-*` scale, the `html` font-size lever in `base.css` (125 %: every rem scales with it).
- *Change how every button, panel, field, dialog or tab looks*: its class in `components.css`, `forms.css`, `overlays.css` or `data.css`.
- *Change the logo*: replace `design-system/logo/logo-data.ts`, run `node scripts/logo/build-assets.mjs`, update the fingerprints in `logo.guard.test.ts` ([logo.md](logo.md)).

## Guards (they run in `pnpm test`, so CI holds the system in place)

| Test | What it pins |
|---|---|
| `design-system/tokens.contrast.test.ts` | Evaluates `tokens.css` as a browser would. Text 4.5:1 on every surface and on every tint over it, controls and focus 3:1, no purple (OKLCH hue 285–345° at chroma ≥ 0.03), every `color-mix` in oklab. The hand-written colours in `app/global-error.tsx` (the one page that renders with no stylesheet) must still be the tokens. |
| `design-system/tokens.guard.test.ts` | Nothing bypasses the system: no raw hex or `rgb()/oklch()` in code, no default Tailwind palette class (`bg-black/60`, `text-gray-400`), no hand-written tints, no arbitrary or default type sizes, no tracked-caps labels, no `color-mix(in oklch …)`, no raw hue in a stylesheet. |
| `design-system/logo.guard.test.ts` | The 2026 logo is the only logo: the vector data's fingerprint, the 2025 files gone and unreferenced, no `<img>` of a logo, the roundel ≥ 45 px and the lockup ≥ 51 px, the raster exports at their sizes. |

Three things the system depends on that tests cannot fully see: look at a change in `/admin/design-system` at 1440 and 390 px; do not give a page wrapper an opaque background (the atmosphere is the night); and keep a page inside a 320 px screen whatever a member typed. Two rules in `base.css` do most of that: a plain `grid` has one shrinkable column (in the base layer, so every `grid-cols-*` still wins), and text may break anywhere (`overflow-wrap: anywhere` on `html`, because a title or a name with no spaces in it would otherwise run past its card and past the screen). A table sizes its columns by their words, so `.lm-table` opts out (it scrolls, or stacks and breaks), and so must any label that has to stay whole: put `wrap-normal` on it, as the calendar's weekday headers do. The adversarial specs post exactly such text, and the reflow specs measure 320 px on Linux, where text runs a little wider than on a Mac, so look at a card holding a 60-character word, and leave a few pixels of room, before calling a layout done.

## Adding a component

1. Does a family component already say it? (`/admin/design-system`.) Use it; if it nearly fits, extend its variants rather than forking it.
2. Put the look in the family's stylesheet as an `lm-*` class with `data-*` variants, reading only tokens. Give it hover, `:focus-visible`, active, disabled, loading and error states where they apply, and let it land on its end state under `prefers-reduced-motion`.
3. Keep the semantics native (a `<button>`, a `<dialog>`, a `<label>` around its control); state is read off ARIA where it can be.
4. Add it to the family's gallery section so it can be seen at both widths, and to the family's doc.
