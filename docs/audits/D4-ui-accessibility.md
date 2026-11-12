# D4 — UI/UX and accessibility

Audit date: 2026-10-05. Branch `feat/connections`. Local build against the E2E seed.

**Gate (programme Part D):**
- zero axe serious/critical issues;
- every flow completable by keyboard;
- the owner reviews screenshots.

**Result:**
- **axe:** zero serious/critical on 49 page states: 43 at both desktop and phone width, plus 6 detail/edit pages at desktop, including WCAG
  2.2 target size, plus 320 px reflow on every page. All enforced in E2E.
- **Keyboard:** tested on the core flows listed below.
- **Screenshot review:** owner step, listed under Open.

## Method

`e2e/axe.spec.ts` (new; `@axe-core/playwright` 4.13.0 added as a dev dependency) runs in the
`member` project:

- **Pages:**
  - 5 public;
  - 24 member, including the three Connections tabs and graph view;
  - 14 admin;
  - the detail and edit page for one seeded listing of each kind.
- **Rules:** tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. Fails on any
  **serious** or **critical** result.
- **Viewports:** desktop, and phone (Pixel 7 viewport, touch, mobile).
- **Reflow:** at 320 CSS px (1280 px at 400% zoom, WCAG 1.4.10), no page may scroll sideways. A
  wide table may scroll inside its own focusable region. On failure the test names the element
  sticking out.
- **Timing:** every check waits until no `aria-busy` skeleton region remains, so it measures the
  finished page.

Not covered by axe here: `/onboarding`, `/intake`, `/pending`, `/rejected` and `/reset-password`
need an account in that state. They go to the E4 route matrix. `a11y.spec.ts` still checks
accessible names and the skip link.

## Findings (all fixed)

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| D4-F1 | Serious | **Muted text was just under AA.** `--color-text-muted` #808088 measured 4.48:1 on upload boxes (#19191b) and 4.15:1 on raised rows (#202022). The `text-text-muted/70` hints ("— optional", the `n/500` counters, 14 places) measured 2.95:1. | Token raised to **#8a8a92** (4.75:1 on #202022, 5.46:1 on cards, still below `text-secondary`). Alpha muted text removed everywhere; the one decorative "·" is `aria-hidden`. |
| D4-F2 | Serious | **Calendar:** out-of-month days were `opacity-40`, taking their dates to 1.82:1. | They sit on the page colour instead, at full text contrast. |
| D4-F3 | Serious | **Landing:** the illustrated "Continue →" (a picture of a disabled button) was `opacity-40` accent: 3.84:1. | Drawn as a muted outline button. |
| D4-F4 | Serious | **Legal pages:** links inside paragraphs were told apart by colour only (`link-in-text-block`). | Underlined, offset 3 px. |
| D4-F5 | Serious | **Cookies table on a phone:** a horizontally scrolling region that a keyboard couldn't reach. | Made a labelled, focusable region. |
| D4-F6 | Reflow | **Legal pages at 320 px:** the contact and appeals email addresses couldn't wrap (+33 px). | `overflow-wrap: anywhere` on the legal article. |
| D4-F7 | Reflow | **/opportunities at 320 px:** "Your bookmarks (n)" and "Post an opportunity →" sat in a `shrink-0` row (+59 px). It only showed when the count streamed in. | The masthead action row wraps. |
| D4-F8 | Target size | The mobile **Open navigation** button, the most-used control on every phone page, was 36×36. | 44×44. |

## Keyboard

| Area | Test |
| --- | --- |
| **New:** create a community post with Tab, typing and Enter only (reaches "Create a post" by tabbing, fills both fields, submits) | `a11y.spec.ts` |
| Skip link moves focus to `#main-content` | `a11y.spec.ts` |
| Member dialog: focus moves in and stays in the top layer; Escape and the close button restore focus to the card. (Opening uses a click; opening with Enter isn't tested yet, so it's an E4 item.) | `dialog.spec.ts` |
| Connections graph is drivable from the keyboard | `connections.spec.ts` |
| Every form control has an accessible name (14 pages) | `a11y.spec.ts` |

## Touch targets

- **The gate is WCAG 2.2 AA target size (24×24, or spacing):** axe enforces it at phone width
  on every page above.
- **The plan's 44 px is applied to the primary per-page control:** the mobile navigation button
  (fixed). Measured at phone width, the remaining controls under 44 px are footer text links
  (23 px tall). They pass WCAG 2.2 through its spacing exception.

## Not done here (owner or later)

- **Screenshot review (gate item):** the owner reviews desktop and phone screenshots of every
  route. That pairs naturally with the E4 Playwright MCP visual pass, which also checks
  "every control has a visible shape" (a recurring issue here).
- **VoiceOver smoke:** manual. Committee members do this on their own phones in E5b.
- **Copy check ("one sentence + a link"):** editorial, so it goes with the screenshot review
  rather than a test.
