# The landing page (Lumen)

Route `/`. One page, one scene: the star-built roundel at the centre, six audience orbits, a member ring, three satellites, a calendar dial, a visitor who spirals in through three gates; the words scroll past
at 1x in native columns; the only navigation is an altitude rail on the right edge with the real roundel as its cursor. The design note is `design/phase-2/directions/09-lumen/LUMEN.md` (in the owner's local design workspace, which is not in this repository); this page
is how that mock runs as the live route. Code: `frontend/src/components/landing/` (markup, stylesheet, scene) and `frontend/src/lib/landing/content.ts` (the words).

## How it is built

**The page is the server's.** Every word is real markup in the static HTML, in order: hero, who we are, community, opportunities, events, apply, footer (`Landing.tsx` composes `Nav`, `Hero`, `Who`, `Community`,
`Opportunities`, `Events`, `Apply`, `Footer`, all server components, all rendering from `content.ts`). Every anchor works without JavaScript. `/` is statically rendered and listed in `csp.ts`'s `STATIC_CSP_ROUTES`:
nothing under `components/landing` or `lib/landing` may read cookies, headers, the query string (but for the test hooks below), the database or the network, or add a form field or an `innerHTML`. Two unit tests
scan every `.ts`/`.tsx` there (`lib/staticRoutes.test.ts`, `lib/csp.test.ts`); a third guard (`design-system/tokens.guard.test.ts`) keeps raw colours out of it.

**The scene is an island that attaches to that markup.** `LandingFrame.tsx` is the one client component (a `div.lumen` around the server's children). Its effect calls `scene/boot.ts`, which sets `data-mode`
(`live`, or `static` when motion is reduced), waits for the page to paint and the browser to idle, and only then imports `scene/engine.ts`. The engine reads the DOM (where each entry's words are, where the rail
is), builds the world, and returns when it is running. An `AbortSignal` releases everything it made, at whatever stage: the renderer (geometries, materials, textures, context), listeners, observers, timers,
the animation frame. React StrictMode's second mount, and a round trip to `/login` and back, each start a fresh scene on the same markup (checked: one GL context made and one lost per visit).

| Module (`scene/`) | What it is |
|---|---|
| `boot.ts` | the only scene code in the page's own bundle (about 4 KB with the frame): mode, idle start, teardown |
| `engine.ts` | start / stop; the live loop (masks, entries, leader lines, the signal to the visitor) and the static runner |
| `stage.ts` | the scroll engine: smoothed scroll, `active` section, anchors, the page clock. Never calls `preventDefault` but on a plain click of an in-page anchor |
| `director.ts` | scroll to frame: poses, bodies, rings, the hero formation. A pure function of (scroll, geometry, clock) |
| `world.ts`, `cam.ts`, `sample.ts`, `rand.ts` | the point clouds (the mark is the roundel's path sampled into 16 000 stars), orbit geometry, the one camera |
| `gl.ts`, `palette.ts` | the WebGL painter (one canvas, a handful of draw calls) and the colour tokens it reads |
| `poster.ts` | the 2D painter for the static page: one still per station into canvases the server already placed |
| `glyph-art.ts` | reads the page's own glyphs (the design system's `Glyph`, tagged `data-glyph`) and rasterises them: the body in the scene and the glyph beside the words are one drawing |
| `nav.ts`, `cta.ts`, `ui.ts`, `who.ts` | the rail's gauge and cursor and the phone menu; the closing action's orbit ring; the skills picker; the audience row |

Three.js is imported by name (tree-shaken). The renderer chunk loads only in live mode.

## Modes

- **Live** (WebGL, motion allowed): a fixed canvas behind the words, scroll-driven. The canvas fades in over the atmosphere once its first frame is drawn.
- **Static** (`prefers-reduced-motion`, or no WebGL): `data-mode="static"`, the canvas never exists, one painted poster per station sits beside its words, the cursor sits at the current station's tick (set once per station
  change, nothing tied to the scroll). The scene decides this itself if WebGL fails.
- **No JavaScript**, and the server's page before the scene starts: no `data-mode`, the live layout with its gaps compacted (`--k`), every word readable, the picker laid out open, the rail's ticks placed by CSS,
  Sign in visible. If the scene never starts (a failed chunk) Sign in and the ticks still arrive after five seconds (`lumen-arrive`).

## The stylesheet

`landing.css` is the mock's `lumen.css` scoped under `.lumen` (native nesting), on the design-system tokens: `--void` is `--color-void`, and so on (aliases at the top). `rem` in the mock is 16 px (20 px at 2560);
the app's root is 125 %, so every length is `calc(N * var(--r))` with `--r` the mock's root size. The design system's `.lm-btn` (via `ButtonLink`), `OrbitGlyph`, `Roundel`, `Lockup`, `Glyph` and `Icon`
are used as they are; the comet-ring action, the rail, the picker, the stations' layout and the poster layout are landing-only. Every `color-mix` is `in oklab`. Keyframes the design system owns (`breathe`,
`swell`, `orbit-spin`, `orbit-lap`) are used by name; the landing's own are `lumen-*`.

## Test hooks (inert unless you add them)

Read once at start, in client code only, by `scene/motion.ts` `readParams`: flags and numbers, never a string into the DOM (a unit test feeds it hostile input).

| Param | Effect |
|---|---|
| `?still` | the settled composition: no entrance, no smoothing, no loop |
| `?still&p=<0..1>` | scroll to that fraction of the page, still (how the port is compared with the mock, frame by frame) |
| `?t=<s>` | freeze the page clock (0.3 empty, 1 converging, 1.8 forming, 2.8 arrived; the nav's entrance follows it) |
| `?who=<0-5>` | select an audience glyph (lights its orbit) |
| `?joined` | the finished orbit insertion, the button included |
| `?prof` | per-frame timing in `window.__prof`, the frame in `window.__F` |

On `window`: `__ready` (true when the first frame is drawn), `__stage`, `__mark()` (the circle that holds ring and rocket, for clear-space checks), `__stops()` (scroll offsets worth looking at). All removed on teardown.

## Changing it

- **A word**: `lib/landing/content.ts`. Labels that belong to the design system's glyph families (the audiences, listing kinds, event types, sign-up steps) are its (`design-system/icons/glyphs.ts`).
  What the live page said that this one does not is in [landing-extras.md](landing-extras.md).
- **A drawing**: the design system's `Glyph` / `Icon`. The scene follows (it reads the page's glyphs).
- **A colour, a size, a duration**: the tokens; the scene reads `--void --cool --warm --sun --star` at start.
- **A station**: the markup (a `section[data-section]` with its entries), `ENTRY_SEL` and the poses in `director.ts`, and the station's CSS. The director keeps the bodies clear of the words by measuring them.
- **After any change**: compare with `?still&p=` frames at 1440x900 and 390x844 (and 768x1024, 1024x768, 667x375, 320x568 for the hero and the closing action), check reduced motion, no WebGL and no JavaScript,
  run axe, and `node design/site-port/tools/snapshot.mjs --roles anon --only '^/$'` then `compare.mjs` (the owner's local content-contract tools, which are not in this repository).

## Known limits

- A Playwright `fullPage` capture can catch the page mid-resize (the rail's cursor on the wrong station, a poster repainting at a transient size); shoot the viewport, or retake.
- Frame rate on a real GPU, Safari and Firefox WebGL, and real phones are unmeasured (software GL on a shared machine only).
- The static layout reaches a reduced-motion visitor when the page hydrates; before that the server's page is the (compacted) live layout. The mock decided before first paint with an inline script, which the static-CSP
  tests forbid here.
- The small tick-ring before the closing action's small print is drawn at 18 px (the mock's mark), under the design system's 28 px glyph minimum; the equity wedge and the picker's plus are bespoke marks.
