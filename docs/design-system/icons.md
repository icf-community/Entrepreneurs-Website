# Icons and glyphs (Lumen)

Foundry draws everything pictorial in one hand, taken from the logo: a ring with **one opening** where the rocket breaks out, plumes with slits, solid mirror-symmetric figures, four-point sparks as the only ornament. There are two families.

| | `Icon` | `Glyph` |
|---|---|---|
| For | what you can do and where you can go: buttons, rows, meta lines, states | who someone is and what a listing is: audiences, listing types, sign-up steps, event types |
| Grid | 24, stroke 1.75, round caps and joins | 48, a Ø40 ring (stroke 2.3) and a **solid** figure |
| Drawn sizes | 16, 20, 24 (also 18, 32) | 28 and up (48 is the design size) |
| Import | `@/design-system/icons/Icon` | `@/design-system/icons/Glyph` (component) and `@/design-system/icons/glyphs` (names and mappings) |
| Names | `names.ts` (`ICON_NAMES`, `IconName`) | `glyphs.ts` (`GLYPH_NAMES`, `GlyphName`) |

Both are pure, server-safe components (no hooks in `Icon`; `Glyph` has none either, bar the coin's `useId`). They are one flat colour, `currentColor`: the text colour of whatever holds them.

Files: `frontend/src/design-system/icons/` (`Icon.tsx`, `drawings.tsx`, `names.ts`, `Glyph.tsx`, `glyphs.ts`, `Disc.tsx`, two tests) and the style guide section `frontend/src/app/admin/design-system/IconsGallery.tsx`.

## 1. The gallery

`/admin/design-system`, the section **Icons and glyphs** (admin login). Top to bottom:

1. **The whole set**: every icon at 24 px in one uniform grid on the night (judge weight and rhythm first), then every icon at 20 px on a light plate. Point at one for its name.
2. **How an icon is built**: six icons on their construction grid (a line per unit, the 2-unit margin) with the opening ringed in the lit colour: a ring, a speech bubble that loses its upper-right corner, a calendar whose right binding ring leaves through the opening, a search lens whose handle does, a house whose door is the gap, a node graph whose lines stop short.
3. **Destinations, Arrows and chevrons, Things you do, States and marks, Things**: every icon in a cell with its name, at 16, 20, 24 and 32 on the night. A last group, "Not yet grouped", appears only if a name was added to `names.ts` and not to the gallery.
4. **Icons in use**: icon buttons (44 px ring, 20 px icon), buttons and badges with icons, the sidebar's rows (18 px icon in a 36 px ring, one lit), meta lines (16 px).
5. **Glyphs**: the four families at 48 and 32 (audiences, listing types, sign-up steps, event types with the verified tick and the scroll cue), then all of them on a light plate.
6. **Disc**: the three ring sizes holding icons and figure-only glyphs; a glyph on its own keeps its ring.

## 2. The language the drawings follow

- **The opening.** Every silhouette has exactly one opening, 3.8 units wide on the centreline (about 2 units of light between the round caps), so at 16 px it reads as a choice and at 64 px as the roundel's gap. Rings open at the upper right, the way the light leaves. A box loses its upper-right corner. A house's door is the gap. A bell's rim breaks on the right. A star's top point is cut on its right side. A gear's upper-right valley is open.
- **Things that leave the figure pass through the opening**: the search lens's handle, the key's shaft, the pencil in the edit square, the arrow out of the external-link box, the arrow out of the sign-out door, the calendar's right binding ring, the arrow out of a tray. This is the rocket and the ring.
- **Marks inside a silhouette are texture, not outlines**, and stay closed: the gear's hub, the globe's meridian, and the pencil in `edit` (the part that leaves the page is a figure of its own). An audit of every stroked path in the set finds no other closed outline outside the brand marks.
- **Solid is for the small.** Heads, dots, nodes, latches, the picture's sun and sparks are solid fills (a ring that small could not hold an opening at 16 px). Large things are strokes.
- **Slits.** Where a line meets a solid dot it stops short with about 1.1 units of light (connections, share, sliders): the plume's slit.
- **Sparks** (`foundry-ai`, `spark`, `events`, `committee`) are the only ornament, and always mean "lit": AI, new, an event day, someone who steers.
- **A chevron is a chevron.** Arrows, chevrons, plus, minus, close and check are plain open strokes. Functional clarity comes before the signature.
- **Closing the ring is a state.** `bookmark` and `star` are open; `bookmark-filled` and `star-filled` are closed and solid: saving closes the shape.
- **Brand marks** (`github`, `linkedin`, `instagram`) are the companies' own drawings, flat, edge to edge of the grid: the one place the opening rule does not apply.
- Keylines: a 24 grid with a 2-unit margin. Circle r 9; large box 17 wide, corners 3; medium box corners 2.5; separate strokes keep about 2.6 units between their centrelines so counters stay open at 16 px.

## 3. Rules of use

### Icon

```tsx
import { Icon } from "@/design-system/icons/Icon";
<Icon name="chevron-right" size={20} className="text-text-secondary" title="Next" />
```

Props: `name` (an `IconName`), `size` (default 20), `className`, `style`, `title`. No stroke, no colour, no fill props: the family has one weight and takes the text colour.

| Size | Where |
|---|---|
| 14 | inside a badge or a dense chip |
| 16 | a line of meta (place, time, amount, views), a trailing arrow in a button, an inline arrow after link text |
| 18 | a button's leading icon; a sidebar row's icon in its 36 px ring |
| 20 | the default; an icon button (the 44 px `lm-iconbtn` ring) |
| 24 | a section's lead, an empty state, a 56 px ring |
| 32 | rare: a specimen or a hero |

- **Colour.** Inherit: put the role class on the icon or its parent. Resting controls `text-text-secondary`, meta `text-text-muted`, the current or chosen one `text-accent-light` (or `text-lit` for light itself), destructive `text-danger`. Never a hex, never an inline `color`.
- **Naming.** Without `title` the icon is decorative (`aria-hidden`). That is right whenever words sit beside it. For an icon-only control, name the **button** (`aria-label="Close"`), not the icon; keep every existing `aria-label` and `title`.
- **Never replace a word with an icon** where there is a word. `→ ← ↗ ✕ ▾` in labels become icons; the label words stay (section 6).
- **Rotating** is allowed for chevrons only (a disclosure turns `chevron-right` 90° when open; a menu's `chevron-down` turns 180°). Use a transform class and `transition-transform`. Never rotate another icon.
- **Alignment.** Put the icon and its text in `inline-flex items-center gap-2` (gap 1.5 for 14–16 px). Do not nudge icons with margins to fake optical centre; the drawings are centred.
- **A spinner** is not an icon: use `OrbitGlyph spin="fast"` (or the `Spinner` primitive).
- **A busy or pending state** never changes an icon's drawing; swap in the spinner.
- **Do not** use emoji, a Unicode arrow, a triangle, a multiplication sign, a check mark or a star as an icon. Do not paste an `<svg>`: add the drawing here instead (section 7).

### Glyph

```tsx
import { Glyph } from "@/design-system/icons/Glyph";
import { AUDIENCES, LISTING_KINDS, EVENT_TYPES, SIGNUP_STEPS } from "@/design-system/icons/glyphs";
<Glyph name="lighthouse" size={48} title="Mentors" />
```

Props: `name` (a `GlyphName`), `size` (the whole 48 grid in px, default 48; **never below 28**: smaller is raised to 28), `ring` (default on), `title`, `className`, `style`.

- Names: `book cap sprout lighthouse wings flask` (audiences), `briefcase calendar coin` (listing types), `badge chips eye` (sign-up steps), `tick` (verified), `network stage chip talk` (event types), `down` (the "Learn more" cue).
- **Mappings** (typed, from the kit, labels verbatim; they are content): `AUDIENCES` (id, glyph, short `name`, `full` label, and the app's own `affiliation` value from `lib/intake/steps.ts`), `LISTING_KINDS` (id, glyph, name, the app's `ListingKind` as `kind`, and the compact `icon` for tight places), `EVENT_TYPES`, `SIGNUP_STEPS`, `STATUS_GLYPHS`. Where the product already has its own visible wording (`Recent graduate`, `Staff or faculty`), the page keeps the product's string and uses the table only to pick the drawing.
- Restyle by colour and size only. Do not redraw, outline, fill the ring, add a second ring, rotate or stretch. One colour per glyph.
- Meaning lives in the drawing, in `title` and in the words beside it; the kit's rule is "never visible text at rest", but where the product shows the word (a member card says "Mentor") keep it.
- Touch targets are 44 px even when the drawing is smaller.
- The landing page keeps its own copy (`components/landing/Glyph.tsx`, `lib/landing/glyphs.ts`) because the WebGL scene rasterises the same strings. The drawings are the kit's, character for character, and so are these (a pixel diff of all 18 against the kit's own renderer: 0 pixels differ). Do not fork them again.

### Disc: which ring where

`Disc` is the `.lm-disc` ring that `Entry` already draws round its glyph slot. A Glyph carries its own ring; an Icon carries none.

| You have | Put it in | Why |
|---|---|---|
| a Glyph on its own (a hero, an audience orbit, an empty state, a card's identity) | nothing: `<Glyph name="…" size={48} />` | it has its ring |
| a Glyph in a list row or any slot that draws a ring | a `Disc`, with `<Glyph ring={false} size={28 \| 34} />` | one ring only: a ring in a ring is two nested borders |
| an Icon that is the identity of a row (sidebar, entry, settings row, a login step) | `<Disc size="sm \| md \| lg">` with the icon at 18 / 20 / 24 | the ring is the target and the lit state |
| an Icon on a button, a link, a menu row, a meta line | nothing | a disc is for identity, not for every icon |

`Disc` sizes: `sm` 36, `md` 44 (default), `lg` 56, all with a 1.5 px firm edge; `lit` glows warm (the current or chosen one; at most one per view). `Entry` wraps its `glyph` prop in a Disc for you: pass it an Icon (20) or a figure-only Glyph (28).

## 4. Names added by the icon pass

Appended to `names.ts` (nothing renamed or removed): **`video`** (an online event), **`pound`** (an amount, the £ the product uses), **`pointer`** (a click), **`ring`** (the open ring: unchecked, not yet), **`approx`** (≈), **`help`** (?), **`star-filled`**, **`linkedin`**, **`instagram`**.

## 5. Catalogue: every name

**Destinations**

| name | draws | for |
|---|---|---|
| `home` | a house; the door is the gap | Home, "Return to home" |
| `community` | a post: avatar, a line, two lines in a box with a missing corner | Community feed |
| `committee` | a person with a spark | Meet the Committee |
| `members` | three people | Members directory |
| `foundry-ai` | two sparks | Foundry AI |
| `connections` | three nodes, lines stop short | Connections |
| `messaging` | a speech bubble | Messaging |
| `opportunities` | a briefcase, seam and latch | Opportunities |
| `events` | a calendar whose day is a spark | Events |
| `vcs` | three bars on a baseline | Grants & VCs |
| `notifications` | a bell, the rim breaks on the right | Notifications |
| `calendar` | a calendar with date dots | Calendar |
| `activity` | a pulse line | My activity |
| `submissions` | a page with a tick | My submissions |
| `settings` | a gear, one valley open | Settings |
| `profile` | a person in an open ring | your profile, the account chip |
| `sign-out` | a door with an arrow leaving | Sign out |
| `admin` | a key, the shaft leaves the ring | the Admin hatch |

**Arrows and chevrons**: `arrow-left` `arrow-right` `arrow-up` `arrow-down` (go, back, next), `arrow-up-right` (leaves the site, the short form after link text), `chevron-left` `chevron-right` `chevron-up` `chevron-down` (disclosure, stepper, menu), `expand` `collapse` (double chevrons: fold a panel to its edge; a plain chevron would read as previous/next).

**Things you do**

| name | draws / for |
|---|---|
| `plus` `minus` `close` `check` | add, remove, dismiss, done |
| `search` | a lens whose handle leaves through the opening |
| `filter` | a funnel with a missing corner |
| `sort` | an up arrow and a down arrow |
| `bookmark` `bookmark-filled` | save; saved (the ribbon closes) |
| `edit` | a page and the pencil coming through it |
| `trash` | a bin, the wall breaks below the lid |
| `copy` | two sheets; `download` `upload` a tray and an arrow |
| `share` | three nodes; `external` a box and the arrow out of it |
| `link` | two links; `mail` an envelope; `send` a paper plane |
| `refresh` | a ring with an arrow where it opens |
| `more` | three dots; `menu` three lines; `grid` four panes; `list` bullets and lines |
| `eye` `eye-off` | visible, hidden |
| `lock` `shield` `flag` `ban` | locked, protected, report, block |
| `undo` | an arrow back round a corner |
| `calendar-plus` | add to calendar |
| `user-plus` `user-check` | invite, accepted or verified |
| `sliders` | adjust |

**States and marks**: `info` `warning` `error` `success` (always with a word), `ring` (not yet), `help` (not enough evidence), `approx` (related).

**Things**: `clock` `pin` (a place) `video` (online) `globe` `user` `users` `pound` (an amount) `pointer` (a click) `github` `linkedin` `instagram` (brand marks) `image` `file` `star` `star-filled` `spark` `tag`.

## 6. What replaces what

Line numbers are from the last commit **before** the port (`d1b0a81`); find a row by the file and the words in it, not by the line. A page agent's own file is the only one it edits.

### 6.1 The 48 inline SVGs

**App shell** (`components/app`)

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `Sidebar.tsx` `const I` L84–155, drawn by `Icon({d})` L157 (18 px, viewBox 20, stroke 1.4) | `home` roof and door | Home, and "Return to home" in review | `home` |
| | three lines | Community | `community` |
| | star | Meet the Committee | `committee` |
| | two people | Members | `members` |
| | two sparkles | Foundry AI | `foundry-ai` |
| | three nodes | Connections | `connections` |
| | speech bubble | Messaging (behind the flag) | `messaging` |
| | briefcase | Opportunities | `opportunities` |
| | calendar | Events | `events` |
| | four bars | Grants & VCs | `vcs` |
| | bell | Notifications | `notifications` |
| | **a clock face** | Calendar (the page is a calendar) | `calendar` (the clock was a mismatch; `clock` stays for time) |
| | pulse line | My activity | `activity` |
| | page with a fold | My submissions | `submissions` |
| | circle with eight ticks | Settings | `settings` |
| `Sidebar.tsx` L344 (14 px) | chevron left / right | "Collapse navigation" / "Expand navigation" | `chevron-left` expanded, `chevron-right` collapsed (or `collapse` / `expand`) |
| `Sidebar.tsx` L385 (14 px) | head and shoulders | the profile chip's fallback when there is no initial | `user` |
| `AppShell.tsx` L78 (16 px) | three lines | "Open navigation" | `menu` |

**Arrows that point on** (`→`-shaped SVGs)

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `app/settings/page.tsx` L95, 105, 115, 125 (15 px) | arrow right, nudges right on hover | the four link cards: Edit your profile, Your submissions, Saved opportunities, Contact the team | `arrow-right` 16, keep the hover nudge |
| `app/login/LoginClient.tsx` L592 (15 px) | arrow right | a role chooser row (title, blurb, arrow) | `arrow-right` 16 |
| `app/not-found.tsx` L66 (14 px) | arrow right | after "Back to home" | `arrow-right` 16 |
| `components/Hero.tsx` L78 (14 px) | arrow right | after "Join Foundry" | `arrow-right` 16 |

**Close and dismiss**

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `app/profile/CvProcessingDialog.tsx` L100 | X, 14 px | dialog "Close" | `close` 20 in the `lm-iconbtn` ring |
| `app/profile/GithubDialog.tsx` L169 | X | dialog "Close" | `close` 20 |
| `components/members/MemberDialog.tsx` L105 | X | dialog "Close" over the photo | `close` 20 |
| `components/SubmittedBanner.tsx` L25 | X | "Dismiss" | `close` 20 |
| `components/connections/ConnectControl.tsx` L595 | X (16 grid) | the confirm popover's close | `close` 18 |
| `components/forms/SearchableMultiSelect.tsx` L179 (10 px) | X | remove a selected chip | `close` 14 |
| `components/intake/controls.tsx` L196 and L359 (9 px) | X | remove a chip (skill, sector) | `close` 14, keep the 28 px target and its extended hit area |

**Controls: chevrons, ticks, a clock**

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `components/committee/CommitteeGallery.tsx` L108, L123 (16 px) | chevron left, right | "Previous committee member", "Next committee member" | `chevron-left`, `chevron-right` 20 |
| `components/filters/FilterBar.tsx` L300 (11 px) | chevron down, turns 180° when open | the filter menus | `chevron-down` 16, rotate when open |
| `components/filters/FilterBar.tsx` L312 (14 px) | funnel | the "Filters" button | `filter` 18 |
| `components/forms/SearchableMultiSelect.tsx` L104 (12 px) | chevron down, turns when open | the select's trigger | `chevron-down` 16 |
| `components/forms/SearchableMultiSelect.tsx` L154 (10 px) | tick | an option is chosen | `check` 14 |
| `components/connections/EmailCopy.tsx` L77 | tick | "copied" | `check` 16 |
| `components/connections/EmailCopy.tsx` L81 | two sheets | copy the address | `copy` 16 |
| `components/MarkActionPill.tsx` L74 (13 px) | tick when on, an empty circle when off | "mark as applied" toggle | `check` when on, `ring` when off |
| `components/connections/ConnectControl.tsx` L374 (16 grid) | clock | the "Pending" button's lead | `clock` 16 |

**Listing meta, actions and links out**

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `app/events/EventsClient.tsx` L295 (18 px) | calendar | marks an event card's title | `events` 18 (or `calendar`) |
| `app/events/EventsClient.tsx` L306 (14 px) | map pin | the location meta | `pin` 16 |
| `app/events/EventsClient.tsx` L315 (14 px) | video camera | an online event | `video` 16 |
| `app/vcs/VcsClient.tsx` L229 (14 px) | **`$` sign** | amount and stage meta | `pound` 16 (the product is in £) |
| `app/my-submissions/MySubmissionsClient.tsx` L215 (11 px) | eye | views | `eye` 16 |
| `app/my-submissions/MySubmissionsClient.tsx` L224 (11 px) | tick in a box | clicks | `pointer` 16 |
| `components/AddToCalendarMenu.tsx` L97 (13 px) | calendar | the "Add to calendar" trigger | `calendar-plus` 16 |
| `components/BookmarkButton.tsx` L27 (15 px) | ribbon, filled when saved | bookmark toggle (`aria-pressed`) | `bookmark` / `bookmark-filled` 18 |
| `app/opportunities/page.tsx` L113 (14 px) | ribbon | "Your bookmarks" link | `bookmark` 16 |

**Social and brand**

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `components/Footer.tsx` L66 | LinkedIn mark (filled) | link to LinkedIn | `linkedin` 18 |
| `components/Footer.tsx` L74 | Instagram mark (outline) | link to Instagram | `instagram` 18 |
| `components/SocialLinks.tsx` L55 | LinkedIn mark | a member's LinkedIn | `linkedin` 16 |
| `components/SocialLinks.tsx` L63 | GitHub mark | a member's GitHub | `github` 16 |
| `components/SocialLinks.tsx` L71 | globe | a member's portfolio | `globe` 16 |

**Illustration**

| File and line | Today | Means | Replace with |
|---|---|---|---|
| `app/login/LoginClient.tsx` L681 and L999 (22 px in a 48 px ring) | envelope | "Enter your code", "Check your inbox" | `mail` 24 inside `<Disc size="lg">` |
| `app/messaging/page.tsx` L39 (28 px in a 64 px square) | speech bubble with lines | the "Coming soon" page | `messaging` 24–28 inside a `Disc lg` (or a glyph-sized drawing) |

**Keep as they are** (not icons)

| File and line | What | Why |
|---|---|---|
| `app/login/LoginClient.tsx` L48 | the Google "G", four brand colours | a third-party mark with its own fills; the one literal-colour SVG left. Do not run it through `Icon` |
| `components/connections/ConnectionGraph.tsx` L252 | the network graph | a data drawing, not an icon |

### 6.2 Unicode characters used as icons

Keep the words; draw the arrow. Where the same character is in a Playwright accessible name, see 6.4.

| Character | Where (baseline) | Replace with |
|---|---|---|
| `←` before a back link | `AdminPageHeader` L32 ("Admin home", used by the admin pages, and spelled out in `admin/{connections,edits,events,graduates,members,opportunities,reports,users,vcs}/page.tsx`); `admin/{events,opportunities,vcs}/new/page.tsx` ("Back to queue"); `admin/page.tsx` L43 ("Back to site"); `ai-notice` ("Foundry AI"); `contact` L43 ("Settings"), L97 ("Back to home"); `profile` L134 ("Settings"); `cookies`, `privacy`, `terms` ("Back"); `login/LoginClient` L348 ("Back to home"), L650 ("Back"); `{events,opportunities,vcs}/[id]/edit` ("Your submissions"); `my-bookmarks` L40 ("Browse all opportunities"); `ListingDetailShell` L37 (`← {backLabel}`); `IntakeNavButtons` L29 ("Back"); `ui/Pager` L37 ("Previous"); `Sidebar` L370 (the Admin hatch) | `arrow-left` 16, before the label, `aria-hidden` |
| `→` after a label | `CalendarClient` L371 and `FullPageLink` L17 ("Open full page"); `PostCard` L118 ("View in …"); `events/page` L46, `opportunities/page` L58, `vcs/page` L69 (the CTA labels "Post an event", "Post an opportunity", "Suggest a VC or grant", passed as strings); `my-bookmarks` L53 ("Browse opportunities"); `Apply` L109, L151 ("Continue", "Join Foundry"); `IntakeDoneScreen` L17; `IntakeNavButtons` L35 ("Finish", "Continue"); `ui/Pager` L48 ("Next"); `home/page` L153, L192 and `messaging/page` L80 (`<span aria-hidden>→</span>`) | `arrow-right` 16, after the label |
| `↗` after a label | `EventReviewCard` L90 (`{ev.lumaLink} ↗`), `OpportunityReviewCard` L160 (`{o.applyUrl} ↗`), `VcReviewCard` L120 (`{v.link} ↗`) and L126, `PosterContactDetails` L30 and `EventsClient` L231, `events/[id]/page` L100, `OpportunitiesClient` L287, `opportunities/[id]/page` L111 (all "LinkedIn"); "RSVP on Luma" (`EventsClient` L257, `EventActions` L39); "Apply", "Email to apply" (`foundry-ai/ResultList` L208, L215; `OpportunitiesClient` L317; `OpportunityActions` L77); "Open application portal" (`OpportunitiesClient` L309, `OpportunityActions` L69); "Open link" (`VcsClient` L198, `VcActions` L32); "Open" (`MyActivityClient` L153); "Google Calendar" (`AddToCalendarMenu` L79) | `arrow-up-right` 16, after the label (`external` where a box-and-arrow reads better as a standalone control) |
| `▾` `▸` disclosure | `EventsClient` L202, `OpportunitiesClient` L256, `VcsClient` L174 (`{open ? "▾ Hide details" : "▸ Show details"}`); `admin/events/EventReviewCard` L79, `admin/vcs/VcReviewCard` L84 (same words); `admin/opportunities/OpportunityReviewCard` L101 ("Hide full details" / "Show full details"); `forms/SignupDisclosures` L48 (`{emailNoticeOpen ? "▾" : "▸"}`) | `chevron-right` 16, turned 90° when open (`rotate-90`), before the label; the words stay `Show details` / `Hide details` |
| `▴` `▾` | `AddToCalendarMenu` L64 (open ? ▴ : ▾) | `chevron-down` 16, turned 180° when open |
| `◀` `▶` | `CalendarClient` L238, L247 (aria-labels "Previous month", "Next month") | `chevron-left`, `chevron-right` 20 |
| `✕` `×` as a close button | `SiteBanner` L103 ("Dismiss this notice"), `ui/Toast` L82 ("Dismiss"), `CalendarClient` L328 ("Close"), `AiSettingsCard` L141 (`Remove {label}` chip) | `close` 16–20; the button keeps its `aria-label` |
| `✓` `≈` `?` `–` | `foundry-ai/ResultList` L23–26 (`STATE_MARK`: met, related experience, not enough evidence, not shown; rendered in `<span aria-hidden>`) | `check`, `approx`, `help`, `minus` (14), the label words beside them stay |
| `★` | `intake/controls` L433 (the core-skill toggle, `aria-pressed`); `github/RepoPicker` L247 (`★ {stargazers}`) | `star-filled` when core / for the count; `star` for a core toggle that is off |
| `+` | `intake/controls` L333 (a "found in your CV" chip's lead); `admin/page` L96–98 (the labels "+ Opportunity", "+ Event", "+ VC / grant") | `plus` 14–16. For the admin labels the visible `+` is part of the button's name: keep it as text, or put it in visually hidden text if the icon replaces it |
| `•` | `admin/edits/EditsReview` L138 (a red dot after a field that changes time or place) | `flag` 14 in the danger colour, with visually hidden text "Time or place changed" |

### 6.3 Characters that stay characters

Typography and content, not icons: the middle dot `·` between meta items, the ellipsis `…`, the em and en dashes, `£`, `§`, `©`, the `×` in an image's "1200×800" (`PostComposer` L154); arrows **inside a sentence** that name a path or a key ("Settings → Usage analytics", "Settings → Delete account", "Community → My posts", "(or ← →)" on the committee page, the landing sample bio "Ex-McKinsey → founded a climate fintech"); `lib/email.ts` (emails need literal characters and hex); test files; comments.

Also not icons but worth knowing: the CSS spinner in `ui/Updating.tsx` becomes `OrbitGlyph spin="fast"`; the coloured dots by listing kind in `CalendarClient` (`KIND_DOT`) may become `Icon` marks, `LISTING_KINDS[].icon` (`opportunities`, `events`, `vcs`) at 14–16.

### 6.4 Where a spec pins an arrow (decide before you replace)

Two Playwright specs match an accessible name **including** the character:

- `e2e/urlfilters.spec.ts` L203: `getByRole("link", { name: "← All opportunities" })` (the `← {backLabel}` link in `ListingDetailShell`).
- `e2e/urlfilters.spec.ts` L232: `getByRole("link", { name: "Open full page →" })` (`FullPageLink`).

An `aria-hidden` icon removes the character from the name and both specs would fail. Either keep the character in the name as visually hidden text (`<span className="sr-only">← </span>` before "All opportunities", `<span className="sr-only"> →</span>` after "Open full page"; this is what a screen reader hears today), or loosen the two selectors to the words. The brief says these names stay; the cheaper and safer fix is the first.

## 7. Adding or changing an icon

1. Draw it on the 24 grid with a 2-unit margin, stroke 1.75, round caps and joins. A silhouette gets exactly one opening, 3.8 units wide on the centreline, upper right (or where a part leaves the figure). Small closed things (under r 3) are solid dots instead.
2. Add the name to `names.ts` **at the end** (never rename or remove: call sites depend on it) and the drawing to `drawings.tsx` (the record's type will not compile without it). Brand marks and solid parts opt into a fill with the `SOLID` spread.
3. `pnpm exec vitest run src/design-system/icons` fails if a name has no drawing, a drawing has no name, a drawing carries a colour of its own or leaves the grid.
4. Look at it at 16, 20 and 24 px on the night and on the light plate in `/admin/design-system` (and at 16 px zoomed in): the opening must read as a choice, not a defect. Add it to a group in `IconsGallery.tsx`.
