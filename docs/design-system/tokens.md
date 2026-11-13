# Tokens

`frontend/src/design-system/tokens.css` is the only place a value is decided. It is written in OKLCH inside a Tailwind v4 `@theme static` block, so every variable is always emitted
(the landing scene reads some at runtime) and every token becomes a utility (`bg-bg-card`, `text-text-muted`, `text-small`, `rounded-xl`). The build serialises the oklch values as `lab()`,
which is why colour mixing is always `color-mix(in oklab, …)`: mixed in oklch, a low-chroma colour such as a dark surface loses its hue and paints red.

## The six lights

| Token | Value | What it is |
|---|---|---|
| `void` | `oklch(0.13 0.016 255)` | the night everything sits in (`#04080d`; the theme colour, the manifest, the favicon plate) |
| `ink` | `oklch(0.96 0.006 250)` | what is read on it |
| `star` | `oklch(1 0 0)` | ring white: the logo, and nothing else |
| `sun` | `oklch(0.95 0.035 85)` | cream: what is lit in words. The one action, a lit name, the focus ring |
| `warm` | `oklch(0.78 0.13 68)` | amber: light itself. The glow behind a mark, a chosen tag, the lit part of a gauge. Never an action fill |
| `cool` | `oklch(0.72 0.04 250)` | one cold, for dust, hairlines and "info" |

## Roles (what components and pages use)

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `bg-primary` (the page), `bg-secondary` (bands, rail), `bg-card` (panels), `bg-card-hover`, `bg-raised` (overlays) | four steps of night, each a little bluer and lighter |
| Tints | `tint-1…4` = ink at 3 / 5 / 8 / 12 % over whatever is behind | a quiet field, a resting control, a raised row, a hovered or pressed one |
| Ink | `text-primary`, `text-secondary`, `text-muted` | all at least 4.5:1 on every surface and every tint (pinned) |
| Lines | `border` (a rule), `border-subtle`, `border-strong` | `border-strong` is the edge of anything pressable and clears 3:1 |
| Action | `accent` (= sun), `accent-light` (a lit word or link), `accent-dim`, `accent-muted`, `focus` | cream with the night on it is the strongest control |
| Light | `lit`, `lit-muted`, `lit-line`, `lit-glow`, `signal` | selection, chosen things, glow |
| Status | `danger`, `danger-muted`, `danger-line`, `success`, `success-muted`, `info` | always with a word or a drawn mark beside the colour |

## Type

Two faces, both self-hosted through `next/font` (`layout.tsx`): **Funnel Display** for headings (h1/h2 render at weight 300, the rest 400) and **Host Grotesk** for everything else.
There is no monospace: measured values (dates, counts, ids) use tabular figures, `.data`. The scale is a 1.25 ratio from a 16 px body, plus `small` for dense rows. The app runs a 125 % root
(`base.css`), so a 16 px body is `0.8rem`; use the tokens and you never do that maths.

| Class | Rendered size | For |
|---|---|---|
| `text-caption` | 13 px | meta, helper text, badges |
| `text-small` | 14.5 px | dense rows, table cells |
| `text-body` | 16 px | reading |
| `text-lead` | 20 px | ledes, entry titles |
| `text-title` | 25 px | panel and section titles |
| `text-heading` | 31 px | |
| `text-display` | 31–49 px (fluid) | a page's own h1, a section's h2 |
| `text-hero` | 34–54 px (fluid) | the landing headline |

## Shape, depth, motion, layout

- Radii: `sm 8`, `md 10`, `lg 12` (inputs, rows), `xl 14` (panels), `2xl 18` (dialogs), `pill`. Circles are for people and glyphs.
- Depth: surfaces are lit by a hairline and a whisper of top light; overlays take one soft shadow (`--shadow-pop`); only a lit thing gets warm light (`--shadow-lit`). No hard offset shadows, no gradient text.
- Motion: one curve (`--ease-out`, an exponential ease-out), four durations (`140 / 220 / 420 / 760 ms`), transform and opacity only, idle loops 8 s and up. `prefers-reduced-motion` lands every entrance on its end state and keeps spinners turning, slowly.
- Layout: `--gutter` (the page's side margin, fluid 20–56 px), `--content-max` (72 rem), `--measure` (34 ch, a lede's width), `--touch` (44 px, the smallest a control may be), `--rail-width` (280 px), `--rail-width-collapsed` (92 px), `--appbar-height` (76 px).
