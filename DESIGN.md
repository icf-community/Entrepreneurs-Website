---
name: Foundry · Lumen
description: "Colour is light direction, not decoration: a night with six lights in it, one curve to move on, and a few gestures that all come from the logo."
colors:
  void: "oklch(0.13 0.016 255)"
  ink: "oklch(0.96 0.006 250)"
  star: "oklch(1 0 0)"
  sun: "oklch(0.95 0.035 85)"
  warm: "oklch(0.78 0.13 68)"
  cool: "oklch(0.72 0.04 250)"
  surface-secondary: "oklch(0.165 0.018 255)"
  surface-card: "oklch(0.195 0.02 255)"
  surface-card-hover: "oklch(0.225 0.022 255)"
  surface-raised: "oklch(0.215 0.021 255)"
  text-secondary: "oklch(0.777 0.008 252)"
  text-muted: "oklch(0.694 0.009 253)"
  border: "oklch(0.362 0.013 254)"
  border-subtle: "oklch(0.271 0.014 255)"
  border-strong: "oklch(0.56 0.024 255)"
  accent-light: "oklch(0.965 0.025 85)"
  accent-dim: "oklch(0.72 0.021 87)"
  danger: "oklch(0.75 0.15 28)"
  success: "oklch(0.8 0.11 165)"
  person-warm: "oklch(0.84 0.1 70)"
  person-sun: "oklch(0.93 0.07 95)"
  person-cool: "oklch(0.82 0.07 235)"
typography:
  hero:
    fontFamily: "Funnel Display, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(33.6px, 1.9vw + 18.4px, 54.4px)"
    fontWeight: 300
    lineHeight: 1.16
    letterSpacing: "-0.024em"
  display:
    fontFamily: "Funnel Display, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(31.2px, 1.2vw + 23.2px, 48.8px)"
    fontWeight: 300
    lineHeight: 1.16
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Funnel Display, Helvetica Neue, Arial, sans-serif"
    fontSize: "31.25px"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Funnel Display, Helvetica Neue, Arial, sans-serif"
    fontSize: "25px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Host Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.42
  body:
    fontFamily: "Host Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Host Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Host Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  2xl: "18px"
  pill: "999px"
spacing:
  gutter: "clamp(20px, 3.6vw, 56px)"
  content-max: "72rem"
  col-page: "41rem"
  col-narrow: "32rem"
  page-top: "2.5rem"
  page-bottom: "5rem"
  touch: "44px"
  rail: "280px"
  rail-collapsed: "92px"
  appbar: "76px"
components:
  button-primary:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.void}"
    rounded: "{rounded.pill}"
    height: "58px"
    padding: "0 30px"
  button-primary-hover:
    backgroundColor: "{colors.accent-light}"
  button-ghost:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "50px"
    padding: "0 24px"
  input:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "48px"
    padding: "0 16px"
  panel:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  dialog:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
  badge:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    height: "24px"
    padding: "0 10px"
  badge-lit:
    textColor: "{colors.accent-light}"
  nav-item:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    height: "44px"
  nav-item-active:
    textColor: "{colors.ink}"
---

# Design System: Foundry · Lumen

## Overview

**Creative North Star: "The Light Behind the Mark"**

Foundry is a night. The page is one dark field (a cool near-black, `#04080d`) and light enters it only where something is lit: the action in cream, the chosen thing in amber, the focus ring, the warm core that sits behind the logo like a sun behind a planet. Nothing is decorated with colour; colour is *direction*. There are six lights (void, ink, star, sun, warm, cool) and every other value in the product is a role built from them, so the whole look is decided in one file (`frontend/src/design-system/tokens.css`) and a change there is a change everywhere.

The system is drawn from the logo, not applied to it. The 2026 roundel is a ring with one opening where the rocket breaks out. That becomes the grammar: every icon and identity glyph has exactly one 3.8-unit opening where a part leaves the figure; the current page in the navigation is a ring that lights; a rule across the top of every page draws itself and lights its end; a body in orbit stands in for a spinner. It is a calm, precise, slightly astronomical product for people who are building things, and it is dark-only.

**Key Characteristics:**
- Six lights; components name a role (`bg-bg-card`, `text-text-muted`, `border-border-strong`), never a hue.
- Cream is the one action and the focus ring; amber is light itself (glow, chosen, the lit part of a gauge) and is never an action fill. At most one lit thing per view.
- Funnel Display, light and tight, for headings; Host Grotesk for everything else; no monospace anywhere.
- A hairline and a whisper of top light make a surface; one soft shadow lifts an overlay; only a lit thing, or the one being pointed at, gets warm light.
- A little character, all of it light and none of it copy: a warm pool behind each page's title and a dot that breathes before it, a card that warms its edge and lights the ring inside it when pointed at, a face in one of three lights, a small body that circles an empty state.
- One exponential ease-out and four durations; transform and opacity only; idle loops of 8 s and slower; every entrance lands on its end state under `prefers-reduced-motion`.
- The landing page is the Lumen mock (a WebGL scene with the roundel at its centre and a rail down the right edge whose cursor is the roundel). The signed-in app keeps a labelled left sidebar in the same language.

## Colors

A palette of one night and its lights. Values are OKLCH (the build serialises them as `lab()`), and every colour mix in the system is `color-mix(in oklab, …)`: mixed in oklch, a low-chroma surface loses its hue and paints red.

### Primary
- **Sun** (`oklch(0.95 0.035 85)`, cream, about `#f9edd5`): what is lit in words. The primary button's fill (the night on it is 7:1 or better), a lit name, a link, and the focus ring (2 px, offset 3 px, so it reads on a cream fill too).

### Secondary
- **Warm** (`oklch(0.78 0.13 68)`, amber): light itself. The glow behind a mark, a lit body's halo, a chosen tag's edge, the lit end of a rule, the travelled part of a gauge, text selection. Its washes (`lit-muted`, `lit-line`, `lit-glow`) are the same amber at 14, 38 and 19 per cent.

### Tertiary
- **Cool** (`oklch(0.72 0.04 250)`): one cold for star dust, hairlines and "info". It stays at hue 250: there is no purple.

### Neutral
- **Void** (`oklch(0.13 0.016 255)`): the page, the night everything sits in; also the theme colour and the favicon plate.
- **Ink** (`oklch(0.96 0.006 250)`) and its two steps **text-secondary** (`oklch(0.777 0.008 252)`) and **text-muted** (`oklch(0.694 0.009 253)`): all at least 4.5:1 on every surface and on every tint laid over one.
- **Star** (`oklch(1 0 0)`): ring white. The logo, and nothing else.
- **Surfaces** in four steps of night, each a little bluer and lighter: secondary (bands, the rail), card (panels), raised (overlays), card-hover (a panel being pointed at). **Tints** are ink laid over whatever is behind it at 3, 5, 8 and 12 per cent (`tint-1…4`).
- **Lines**: `border` (a rule, decorative, below 3:1 on purpose), `border-subtle`, and `border-strong` (the edge of anything you can press, 3:1 or better). A pointed-at control's edge (`edge-hover`) and a chosen control's (`edge-lit`) are also pinned at 3:1.

### Status
- **Danger** (`oklch(0.75 0.15 28)`) and **Success** (`oklch(0.8 0.11 165)`): always with a word or a drawn mark beside the colour, never a stripe.

### People
- **Person lights** (`person-warm` `oklch(0.84 0.1 70)` amber, `person-sun` `oklch(0.93 0.07 95)` a cream that leans yellow, `person-cool` `oklch(0.82 0.07 235)` sky): the only place a hue varies. A face with no photo is its initials in one of these lights, or in none (two in five stay neutral), chosen from the first name so a person is the same colour on every page (`components/ui/avatarHue.ts`). The ring takes a 46 % share of the light and the face a 12 % wash of it. Each light is pinned at 4.5:1 as text on every surface and on its own wash by `tokens.contrast.test.ts`, like ink.

### Named Rules
**The One Lit Thing Rule.** A view has at most one lit thing: one cream action, or one lit panel. Its rarity is what makes it read as light.
**The Role, Not the Hue Rule.** A component never names a colour; it names what the colour is for. If a role is missing, add it to `tokens.css` first.
**The Night Shows Through Rule.** The atmosphere (a warm core high on the left, one cold breath in the opposite corner, two tiles of star dust) is one fixed layer behind every page. A page wrapper never takes an opaque background; panels may.
**The No Purple Rule.** No colour token sits at OKLCH hue 285–345° at chroma 0.03 or more. `tokens.contrast.test.ts` fails if one does.
**The Faces Carry the Hue Rule.** A person light colours a face and nothing else: never a status, a badge, a button or a photo, never a fourth light, and never on the one *lit* (chosen) face, which stays amber.

## Typography

**Display Font:** Funnel Display (variable, self-hosted through `next/font`), with Helvetica Neue and Arial behind it.
**Body Font:** Host Grotesk (variable, self-hosted), with Helvetica Neue and Arial behind it.

**Character:** a light, tight display grotesque over a quiet working grotesque: confident at large sizes, never loud. Measured values (dates, counts, money, ids) use Host Grotesk's tabular figures (`.data`); there is no monospace.

### Hierarchy
- **Hero** (300, 34–54 px fluid, 1.16): the landing headline only.
- **Display** (300, 31–49 px fluid, 1.16): a page's own h1 and a section's h2.
- **Heading** (400, 31 px, 1.18) and **Title** (400, 25 px, 1.25): a section, a panel, a card.
- **Lead** (400, 20 px, 1.42): a lede, an entry's title.
- **Body** (400, 16 px, 1.5): reading; a paragraph never runs past about 62 characters, a lede or caption past 34.
- **Small** (14.5 px) and **Caption** (13 px, medium): dense rows and table cells; meta, helper text, badges.

The scale is a 1.25 ratio from a 16 px body (plus Small for dense rows). The app runs a 125 % root (`html { font-size: 125% }` in `base.css`), so a 16 px body is `0.8rem`; use the tokens (`text-body`) and never do the arithmetic.

### Named Rules
**The Sentence Case Rule.** Labels are sentence case at normal tracking. There are no tracked capitals anywhere.
**The Display Is Light Rule.** h1 and h2 are weight 300; below them 400, because 300 goes thin at card-title sizes.

## Layout

The signed-in app is a **labelled rail and a content column**. From 1024 px the rail is fixed at 280 px (92 px collapsed to a column of rings, remembered in `localStorage`); below that an app bar of 76 px (the menu control and the roundel, sized so a 45 px ring keeps a quarter of its height clear) opens the same rail as a drawer. The column's side margin is the fluid `--gutter` (20–56 px) everywhere. Every page sits in the same frame (`Page`): that margin, `--page-top` above and `--page-bottom` below, a column of at most `--content-max`, and, for a page of one column, `--col-page` (820 px) or `--col-narrow` (640 px) starting at the frame's left edge, so a title never moves sideways between pages. Every page opens with `PageHead`: where you are (a plain trail), the title, one sentence, the actions, and a hairline rule that draws across the top as it scrolls into view and lights its end. A faint pool of amber sits behind the trail and title (it is fainter than the page's own warm core, and fades out well inside the head's box), and the dot before the trail breathes on an 11 s loop.

Rhythm is generous and uncluttered by rule: one clear primary action per view; secondary detail goes behind a disclosure, a popover, a sheet or a tooltip (the words stay in the DOM and every action stays reachable by keyboard); long chip sets collapse to what is chosen plus a "+" ring. Nothing scrolls sideways at 320 px, every control is at least 44 px (24 px is the floor), and tables become stacked cards below 640 px of their own width with the same markup.

The landing page is a single scene: the star-built roundel never rotates; six audience orbits, the member ring, the events dial and the visitor's spiral move around it as you scroll; the rail on the right edge holds five ticks and a roundel cursor. Reduced motion or no WebGL gets a painted poster per station; with no JavaScript every word is still there.

## Elevation & Depth

Depth is **tonal and hairline first**. A surface is a step of the night, a 1 px edge and an inset whisper of light along its top edge (4 % ink); it is never lifted by a shadow. An overlay (dialog, sheet, popover, menu) is raised: the raised surface, a hairline, the same whisper, and one soft shadow. Only a *lit* thing, or one being pointed at for as long as it is, carries warm light.

### Shadow Vocabulary
- **Pop** (`0 18px 50px -14px oklch(0 0 0 / 0.65), 0 2px 8px -2px oklch(0 0 0 / 0.4)`): every overlay.
- **Lit** (`0 0 0 1px lit-line, 0 14px 46px -12px warm 55 %`): the one lit panel or action; a hairline of amber round it and a pool of it underneath.
- **Button** (`inset 0 1px 0 oklch(1 0 0 / 0.55), inset 0 -1px 0 oklch(0 0 0 / 0.08)`): the cream pill's top light.

### Named Rules
**The No Stripe Rule.** No coloured `border-left` stripes on cards, no gradient text, no hard offset shadows, no glass as decoration.

## Shapes

Pills for small controls (buttons, badges, the rail's rows), **12 px** for inputs and rows, **14 px** for panels, **18 px** for dialogs and large panels, circles for people and glyphs. The recurring silhouette is the **ring with one opening**: the logo's roundel, a glyph's Ø40 ring, the rail's lit ring round the current icon, the cursor on the landing rail, a field's edge that warms and lights. Never nest a panel in a panel.

## Components

Every component is a class in a design-system stylesheet keyed by `data-*` attributes (`data-variant`, `data-tone`, `data-size`); a page never carries a long utility string for a component's look. The living style guide, which renders the real components, is `/admin/design-system`; each family is documented in `docs/design-system/`.

### Buttons
- **Shape:** a pill; small 44, medium 50, large 58 px (the default).
- **Primary:** cream with the night on it, the strongest control the system makes. Pointing at it lights a ring one step off the edge; pressing it sinks a pixel. `lit` adds the warm halo for the page's one reason to exist.
- **Ghost / Quiet / Danger:** a surface and a firm edge; text that gains a surface only when pointed at; the danger light, neutral until you are about to press it. Disabled primary becomes a quiet surface rather than beige mud; busy keeps its fill and shows the orbit turning.

### Fields and choices
- **Style:** a 48 px pane of the night with a firm edge (3:1). Pointing warms the edge, focus lights it cream with a faint amber halo, chosen is amber, wrong is the danger edge with a drawn mark and a sentence beneath. Label above, hint beneath; the label is the control's accessible name.
- **Chips and switches:** a chip is a pill that is pressed or not (`aria-pressed`); a switch is a pill track with a ring for a knob that travels and lights. Checkboxes and radios are native inputs redrawn. Long chip sets collapse.

### Panels, entries, badges
- **Panel:** `bg-card`, a hairline, a whisper of top light, 14 px radius; tones inset, lit and danger. A panel you can press, pointed at or holding keyboard focus, warms its edge, gains a faint pool of amber underneath and lights the ring or face inside it. **Entry:** one row of a list with a glyph in a ring, a title, meta and a trailing control; a link makes the whole row the target. **Badge:** a small pill that says what kind or what state; tone is meaning, always with a word.

### Navigation
- **The rail:** pill rows with a 36 px ring's worth of room at the left, empty until the row is the current page or is pointed at, when the ring draws and lights. The brand is the roundel alone at 48 px. Collapsed it is a column of rings with the labels kept for screen readers. A navigation in flight turns the row's ring and sweeps a hairline across the top of the viewport.
- **Tabs:** a hairline with a lit dot under the current tab (links, toggle buttons, or a true ARIA tablist), or a segmented pill.

### Data and structure
- **Tables** are a focusable named region that stacks into cards on a narrow container; **stats** draw a ring or bar only where a limit exists; **avatars** are a ring with initials or a photo, lit when they are the chosen one, and, with no photo, in one of the three person lights (People, above); disclosures, definition lists, pagers, progress, meters and step dots follow the same two devices (the hairline with a lit end, and the ring).

### Overlays and feedback
- **Dialog** (native `<dialog>`, focus trapped, `Close` ring), **Sheet** (a drawer from either edge), **Popover/Menu/Tooltip** (top layer, placed in script and flipped at the edges), **Notice** (info, lit, danger, success: a hairline, a wash and an icon, never a stripe), **EmptyState** (a small amber body circles its ring once every 40 s; under reduced motion it rests at 50°), **Toast**, **Skeleton**. Prefer a popover or a disclosure to a modal whenever the task needs neither interruption nor protected focus.

### Icons, glyphs and the logo
- **Icons** (88, 24 grid, 1.75 stroke, round caps) are functional; **glyphs** (18, a Ø40 ring with a solid mirror-symmetric figure) are identity: the six audiences, the listing kinds, the event types, the sign-up steps. Both keep one opening in every silhouette.
- **The logo** is vector, one flat colour (white on the night), never rotated, cropped, outlined or crossed; the ring at least 45 px, the lockup at least 51 px tall, a quarter of the mark's height clear, never a word set beside the roundel alone.

## Do's and Don'ts

### Do:
- **Do** take colour, size and radius from a role or a component; if the system lacks one, add it to `tokens.css` first.
- **Do** keep one lit thing per view and let everything else stay quiet.
- **Do** keep every word and every accessible name when restyling; move secondary text behind an interaction rather than deleting it.
- **Do** draw a state with a mark and a word, never colour alone, and give every control hover, `:focus-visible`, disabled, loading and error states.
- **Do** mix colour in `oklab`, and check a change in `/admin/design-system` at 1440 and 390 px.

### Don't:
- **Don't** hard-code a hex, an `rgb()`, a Tailwind palette class (`bg-black/60`), an arbitrary type size (`text-[13px]`) or `uppercase` tracking; `tokens.guard.test.ts` fails the build on all of them.
- **Don't** use purple, gradient text, coloured card stripes, hard offset shadows, monospace, or tracked capitals.
- **Don't** use a person light for anything but a face, or add character to a page of its own: the character is in the system (page head, pressable panel, face, empty state), so one change in `tokens.css` or the design-system stylesheets changes it everywhere.
- **Don't** give a page wrapper an opaque background, nest a panel in a panel, or open a modal for a task that needs neither interruption nor protected focus.
- **Don't** draw the logo as an image, resize it under its minimums, or set a word beside the roundel alone; `logo.guard.test.ts` fails on all three, and on any trace of the 2025 logo.
- **Don't** make a decorative idle loop faster than 8 s, animate layout properties, or leave an entrance at `opacity: 0` under reduced motion.
