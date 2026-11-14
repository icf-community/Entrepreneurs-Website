# Data display and structure (Lumen)

One family for everything that shows what the product knows and where you are in it: tabs, avatars, counters, tables, expandable cards,
definition lists, pagers, progress, dividers and sections. Before it there were seven hand-rolled tab strips, about twelve local avatar and badge
copies, four hand-built tables, fifteen admin text tiles, five copies of the expandable listing card, a Fact grid and three step indicators.

- **Defined once** in `frontend/src/design-system/data.css` (reads `tokens.css` only). Change how every tab, table or stat looks there.
- **Consumed through** the components in `frontend/src/components/ui`.
- **Living reference:** `/admin/design-system`, section "Data display and structure". It renders the real components in every state, with
  content like the product's.

## The idea

Two devices from the logo recur, so the family reads as one hand:

| Device | What it is | Where it appears |
|---|---|---|
| **The hairline with a lit end** | a rule of `--color-border` and a 5 px point of warm light, as at the head of every masthead | `Divider`, `Section` (`rule`), the current tab's rule, a progress bar's leading edge, the pager's position |
| **The ring** | a circle of `--color-border-strong` that turns lit when it is the chosen thing | `Avatar`, `Meter`, `StepDots`, the pager's current number |

And one rule of construction: **state is read off ARIA, not off a class**, wherever the markup already carries it (`aria-current`,
`aria-pressed="true"`, `aria-selected="true"`, `aria-expanded`). So a site that must keep its own markup, and its exact semantics, can take the
look with a class string and change nothing else. Colour is never the only carrier of state: the current tab has a drawn rule and a point of
light, a chosen segment an outline and a dot, the chosen table row an edge, an open card a turned chevron and a different word.

Amber (`warm`) means chosen or lit, cream (`sun`) is the focus ring and the one action, and no component here uses a hue that is not a token. Every
colour mix in `data.css` is `in oklab` (see the note in `tokens.css`).

## What exists

| You need | Use | File |
|---|---|---|
| a strip of links where the URL is the state | `LinkTabs` | `components/ui/LinkTabs.tsx` |
| toggle buttons, or a place you are, changed on the client | `ButtonTabs` | `components/ui/Tabs.tsx` |
| a true ARIA tablist with panels | `Tabs`, `TabList`, `Tab`, `TabPanel` | `components/ui/Tabs.tsx` |
| the tab look on markup you already have | `tabsClass()`, `tabClass` | `components/ui/tabsClass.ts` |
| a count inside a tab's label | `TabCount` | `components/ui/Tabs.tsx` |
| a person: photo or initials in a ring | `Avatar`, `AvatarStack` | `components/ui/Avatar.tsx` |
| a labelled number, optionally drawn against a limit | `Stat` in a `StatGrid` | `components/ui/Stat.tsx` |
| rows that share columns | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` | `components/ui/Table.tsx` |
| a card with more behind it | `Disclosure` | `components/ui/Disclosure.tsx` |
| a panel opened by a button of your own | `Collapse` | same file |
| terms and what they mean (the Fact grid) | `DefinitionList`, `Definition` | `components/ui/DefinitionList.tsx` |
| previous / next under a paged list | `Pager` (same props as ever) | `components/ui/Pager.tsx` |
| progress toward finishing something | `ProgressBar` | `components/ui/ProgressBar.tsx` |
| where a quantity stands in a known range | `Meter` (`MeterGlyph` for the drawing alone) | `components/ui/Meter.tsx` |
| where you are in a short flow, or a grouped rail | `StepDots` | `components/ui/StepDots.tsx` |
| a rule between two things | `Divider` | `components/ui/Divider.tsx` |
| a part of a long page, with its own title row | `Section`, in a `.lm-sections` wrapper | `components/ui/Section.tsx` |

Only `Tabs`/`ButtonTabs`, `Avatar` and `Disclosure` need a client boundary (state or handlers); `LinkTabs`, `Stat`, `Table`, `DefinitionList`,
`Meter`, `ProgressBar`, `StepDots`, `Divider`, `Section` and `tabsClass` are server-safe and render with no JavaScript. `StepDots` and `ButtonTabs`
take a callback only when you want the steps or tabs to act.

## Tabs

One look, three kinds of markup. **Pick the markup by what the control is**, never by how it should look: a spec, a screen reader and a
keyboard user depend on it.

| The control is | Use | Semantics it carries |
|---|---|---|
| a list of places and the URL says which (`/community`, `/community/mine`) | `LinkTabs` | `<nav aria-label>` of a `<ul>` of links, `aria-current="page"` on the current one |
| a place you are, but changed by a button (a client navigation with `url.apply`) | `ButtonTabs semantics="current"` | `<nav aria-label>` of buttons, `aria-current="page"` on the current one, no `aria-pressed` |
| a filter or a view of the page you are on | `ButtonTabs semantics="pressed"` (default) | a group of buttons, `aria-pressed` on every one |
| panels of one page, switched in place | `Tabs` + `TabList` + `Tab` + `TabPanel` | `role=tablist` / `tab` / `tabpanel`, roving tabindex, arrow keys |

```tsx
<ButtonTabs
  label="Report status" semantics="current"
  items={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]}
  value={status} disabled={url.pending}
  onSelect={(next) => url.apply({ status: next, page: null })}
/>
<ButtonTabs variant="segmented" items={[…"Month", "List"]} value={view} onSelect={setView} />
<LinkTabs label="Community views" items={[{ value: "all", href: "/community", label: "All posts" }, …]} value="all" />
<Tabs value={mode} onValueChange={switchMode} panels={false}>
  <TabList label="Search mode"><Tab value="network">Build your network</Tab>…</TabList>
</Tabs>
```

- `variant="line"` (default): text tabs on a hairline; the current one draws an amber rule from its left end and lights a point at the end of it (the
  masthead's gesture; it lands on its end state under reduced motion). `variant="segmented"`: a pill that holds two or three short choices; the chosen
  one is outlined in amber light with a soft fill and a point of light at the front of the label (it sits in padding, so choosing never moves a word).
- `size="sm"`, `fill` (share the container's width), `disabled` (the whole group; the current tab keeps its light, so a strip disabled during a
  navigation does not blink), a `disabled` item, `title` and `ariaLabel` per item.
- A count or a note belongs **in the label**, so it stays part of the accessible name: `label: <>All <TabCount>· 12</TabCount></>`. `TabCount` is just a
  quieter span.
- `ButtonTabs` calls `onSelect` with the clicked value **also when it is already current**: a site that re-applies its URL state on every click keeps doing so.
- `Tabs`: controlled (`value` + `onValueChange`) or not (`defaultValue`). `activation="manual"` (default) moves focus with the arrow keys and selects
  with Enter or Space, so a tab that costs a request is never fired by passing over it; `"auto"` selects as focus arrives. Home and End jump. Only the
  selected tab is in the Tab order; Tab then lands on the visible panel (focusable unless `focusable={false}`). `panels={false}` when the tabs switch
  something that is not a `TabPanel`, so no `aria-controls` points at nothing. Hidden panels stay in the DOM (`keepMounted`).
- **Never add `role="tab"` to a button or a link a spec expects to be a button or a link.** Only `foundry-ai/ModeTabs` has `role=tablist` today.
- Own markup: `<div className={tabsClass({ variant: "segmented" })}><button aria-pressed={on} className={tabClass}>`. The state style follows the ARIA
  attribute the markup already has.

## Avatar

A person in a ring: a photo, or their initials in the display face. `size` xs 20 · sm 32 · md 44 · lg 64 · xl 96 (one letter at xs). `lit`: the ring glows,
the current or chosen person. `tone="lit"`: a small amber marker for who posted or organised. `ring={false}` when something else draws the ring; an
Avatar placed in an `Entry`'s glyph disc takes the disc's ring automatically (`.lm-disc > .lm-avatar`), so there is never a ring in a ring.

- The photo is a real `<img>` with the alt text it always had, **empty**, because the name is written beside it. Give `alt` only where the name is not
  (then the initials carry it too, as `role="img"`).
- `src` may be a signed URL. If it fails to load (they expire) the initials take its place; a new `src` gets its own try.
- **A face with no photo is drawn in a light.** `Avatar` sets `data-hue="warm" | "sun" | "cool"` from `hueOf(name)` (`ui/avatarHue.ts`; pure, so a server component can call it, as the sidebar's profile chip does) and `data.css` turns that into the initials' colour, a ring that takes a 46 % share of it and a 12 % wash. Two in five names get no hue and stay neutral, so a list reads as a few warm faces in a quiet crowd. The hue comes from the **first name only** (the same person is "Ada", "Ada Okafor" and "Ada O." in different places) and is dropped for a photo, a `lit` avatar and `tone="lit"` (those stay amber). An avatar in an `Entry`'s glyph disc keeps the colour on its initials and the **disc** wears the ring and wash (`.lm-disc:has(> .lm-avatar[data-hue])` in `components.css`, which sets only the two variables the disc reads, so a lit or pointed-at ring still wins): one ring, never a ring in a ring. Pass `name` (the full name, or the first), not just `initials`; `MemberPhoto` passes the first name. The three lights are `--color-person-*` in `tokens.css`.
- `AvatarStack`: overlapping faces and a `+N` count. The faces are decorative, and the names are in the DOM as visually hidden text (or `label`).

## Stat and StatGrid

A label and a measured value, the unit of every admin counter. A `StatGrid` is **one ruled sheet** (a single surface with hairlines between its cells), not a
wall of cards, and it reflows to the room it has (`min` sm, md, lg; two tiles to a row on a phone for `sm`). Markup is a description list: `dt` the
label, `dd` the value (and a second `dd` for `hint`), so a screen reader hears "Matching spend today: $1.84 of $5.00".

- `meter={{ value, max, kind: "ring" | "bar" }}` draws the value against its limit. **The drawing is decorative** (`aria-hidden`): the figures stay in the
  text, so nothing depends on seeing it. Use it only where there is a limit to draw against; give `tone="danger"` to a value that has crossed it.
- `size="sm"` for long values ("p50 412ms · p95 1,860ms"). The AI admin's 15 tiles are `StatGrid min="sm"`; the connections admin's three counters are a
  plain `StatGrid`.

## Table

Real `<table>` semantics, drawn quietly: hairline rows, a tinted header that stays put when the region has a `maxHeight`, a row that lights when pointed
at, an amber edge on a `selected` row (and `aria-selected`), comfortable density or `density="compact"`.

```tsx
<Table label="Members with blocks or upheld reports">
  <THead><TR><TH>Member</TH><TH numeric>Signals</TH><TH><span className="sr-only">Actions</span></TH></TR></THead>
  <TBody>
    <TR><TD label="Member" primary>Elena Petrova</TD><TD label="Signals" numeric>3</TD><TD actions><Button …/></TD></TR>
  </TBody>
</Table>
```

- The scroll region is `role="region"`, named by `label` and `tabIndex={0}`, so a keyboard can pan a wide table (axe `scrollable-region-focusable`). The
  cookies page and the connections admin already did this by hand; the members and edits tables did not.
- **Stacking.** Below 640 px of the table's *own* width (a container query, so a table in a dialog or a narrow column stacks too) every row becomes a
  card, with **the same DOM**: the header row steps aside (visually hidden, kept for assistive technology) and each cell prints its `label` before its
  value. Give each `TD` its column's name as `label`; mark the first cell `primary` and it becomes the card's title; mark a cell of buttons `actions`
  (left-aligned and wrapped in a card, right-aligned in the table). An empty cell vanishes from the card, with its rule. `narrow="scroll"` keeps the
  sideways scroll at every width instead, for dense numeric tables (`minWidth` sets where it starts); an edge of the region with more table beyond it is
  lit softly.
- Explicit ARIA roles sit on every part (`table`, `rowgroup`, `row`, `columnheader`/`rowheader`, `cell`). They are redundant on purpose: browsers (Safari with
  VoiceOver on a phone, above all) drop table semantics once CSS changes an element's display, and the stacked layout does. They are read from a map in
  `Table.tsx` so a linter that flags a role equal to the tag's default does not take the repair for noise.
- `maxHeight` gives the region a height and its own vertical scroll; it is ignored once the table stacks (a column of cards scrolls with the page).
- `e2e` reads `tbody tr` (50 rows on page one of `/admin/members`) and `thead`/`tbody` by tag; both still hold.

## Disclosure and Collapse

The expandable card. The header is **one button** (`aria-expanded`, `aria-controls`) holding the whole summary, so the card's title is read once and the
control keeps the accessible name it always had: the summary, then "Show details" (or "Hide details" when open) and anything in `trailing`. The chevron
turns, and the panel opens by the grid-rows trick, so its height animates without being measured.

```tsx
<Disclosure
  as="article" id={`o-${o.id}`}
  summary={<>title, meta, tags</>}
  closedLabel="Show details" openLabel="Hide details"
  trailing={<>· Apply by {deadline}</>}
  accessory={<BookmarkButton … />}   // on the card's corner, outside the button: a click on it never toggles the card
  footer={<ApprovalActions … />}     // always visible, under the panel
  open={open} onOpenChange={setOpen} // optional: own the state (see below)
  lazy                               // optional: see below
>
  {details}
</Disclosure>
```

- **The label changes** with the state: `a11y.spec.ts` finds `getByRole("button", { name: /Show details/ })` and then `/Hide details/`. Keep both words.
- **Closed content.** By default the details stay in the DOM, hidden from sight and the keyboard (`visibility` and `inert`). `urlfilters.spec.ts`
  ("the card on the list starts collapsed") asserts that the **description is not on the page until the card is opened** (`not.toContainText`), which
  `textContent` would fail if the text were merely hidden. So the opportunity card (and any card with that assertion) passes **`lazy`**: the children are
  mounted only while the panel is open or closing, and unmount once it has closed.
- Pass the details as `children` in both modes. Do **not** write `{open && …}` yourself: it unmounts them before the panel can close, and the close
  becomes a snap.
- **State.** `open` + `onOpenChange` when opening has side effects that live in the page (the freshness check and the `expand` analytics event in the
  listing cards keep running from the page's own effect keyed on its `open`); `defaultOpen` otherwise.
- The card is a `Panel` (`tone`, e.g. `lit` for a society event) with `size="sm"` for tighter padding. The trigger's focus ring is drawn inside the card's
  edge (the `--focus-offset` the global ring reads), so it is never clipped.
- `Collapse` is the panel alone, for a separate button that is not the whole header (the AI result's "Why this match" / "Hide evidence"): keep
  `aria-expanded` and `aria-controls` on your own button and give the panel its `id`.

## DefinitionList

The terms and meanings on a listing's page. Real `<dl>`, each pair wrapped in a `div`. A term is a small sentence-case label (no tracked capitals), the
definition is the thing. **A `Definition` with an empty value renders nothing** (as `Fact` did), so a page can list every possible fact and let the
missing ones fall away. `layout="grid"` (default) reflows to the room; `layout="inline"` is a ruled column, term left and definition right, for dialogs;
`min` sm, md, lg; `strong` for definitions in primary ink. Or pass `items={[{ term, definition }]}` (terms are the keys, so they must differ).

## Pager

`Pager` keeps its name and its props (`url`, `page`, `total`, `pageSize`, `label`), its landmark (`nav` named by `label`), its button names ("Previous",
"Next", with the arrows now drawn icons) and its sentence ("Page N of M", still one run of text for `toContainText("Page 1 of")`). It renders nothing when
everything fits on one page. It is two ghost `Button`s (ring buttons) either side of the sentence, the current number lit in its own ring, and a hairline gauge
under it with a point of light at the current position (decoration, `aria-hidden`). On a phone the sentence takes its own row above the two buttons, which
share the width, so nothing is wider than the screen at 320 px. It adds no `role="status"` or live region: `admin.spec.ts` takes `getByRole("status").first()`.

## ProgressBar, Meter and StepDots

- **ProgressBar**: progress toward finishing something. A hairline track, a lit fill, a point of light at the leading edge; `role="progressbar"` with a name
  (`label`) and a value (`valueText` for words like "Step 1 of 2"). `start` and `end` carry the visible words; `layout="inline"` puts them on the bar's
  line (the intake's "62% profile complete"), `"stacked"` under it (the onboarding's "1 / 2" and "50%"). No `value` is indeterminate: a short light
  travels, and under reduced motion it is a still, dim, full-width light, plainly not a half-done bar. `size` sm, md; `tone` lit, success.
- **Meter**: where a quantity stands in a known range, not progress. A ring that fills, or a bar. The semantics are the platform's own `<meter>`, visually
  hidden and named (`label`, `valueText`); the ring is its picture, and `children` put the figure where it is seen. `tone` is meaning: lit, success, danger
  (a quantity past its limit), info. `size` sm 32, md 48, lg 72 (ring). `MeterGlyph` is the drawing alone, decorative, for `Stat`.
- **StepDots**: where you are in a short flow. Done steps are lit, the current one is a lit ring, the rest hollow, joined by a hairline that lights as it is
  travelled. Horizontal for a few steps (labels visually hidden but read, or `showLabels`); `orientation="vertical"` is a rail of 44 px rows with a `num`
  ("01", or "—" for a screen that is not a question), which is part of the step's name, as it always was. The current step is never pressable and carries
  `aria-current="step"`; with `onSelect` every other step is a button (the intake rail lets you jump). For a rail in groups render one `StepDots` per group
  under its own heading and pass `done` (the ids travelled across all groups).

## Divider and Section

- **Divider**: the hairline with a lit end (`end` "end", "start", "none"), decorative (`aria-hidden`) by default; `decorative={false}` makes it
  `role="separator"`. `vertical` is a plain hairline between items in a row. Between two rows of a list, a plain `border-border-subtle` is quieter.
- **Section**: a labelled landmark (`aria-labelledby` the title), a title row in the display face (`level` 2: Funnel Display light at the title size; 3:
  regular at the lead size), an optional `description` under the title and `actions` at the right; `rule` adds the masthead's hairline across the top. A page
  has one h1 (`PageHead`); Sections are its h2s. **One rhythm**: put sections in a wrapper with the class `lm-sections` and the gap between them is
  `--section-gap` (about 55 to 75 px, fluid), the same on every page; inside a section the title row and the content are `--section-gap-inner` apart.

## Classes, attributes and tokens

| Family | Classes | State and variants |
|---|---|---|
| Tabs | `lm-tabs`, `lm-tab`, `lm-tab__count`, `lm-tabpanel` | `lm-tabs--segmented`, `--sm`, `--fill`; state from `[aria-current]`, `[aria-pressed="true"]`, `[aria-selected="true"]` |
| Avatar | `lm-avatar`, `lm-avatar__img`, `lm-avatars`, `lm-avatars__more` | `data-size`, `data-lit`, `data-tone="lit"`, `data-ring="none"`, `data-hue` |
| Stat | `lm-statgrid`, `lm-stat`, `lm-stat__label`, `__value`, `__hint`, `__ring`, `__bar` | `data-min` (grid), `data-size`, `data-tone`, `data-meter` |
| Table | `lm-tablebox` (the container), `lm-tablescroll` (the region), `lm-table` | `data-narrow="stack"\|"scroll"`, `data-density="compact"`, `data-tall`; on rows `data-selected`; on cells `data-label`, `data-numeric`, `data-primary`, `data-actions`, `data-nowrap`; `--lm-table-min`, `--lm-table-max` |
| Disclosure | `lm-disclosure` (a `lm-panel`), `__trigger`, `__summary`, `__state`, `__label`, `__chev`, `__body`, `__foot`, `__accessory`; `lm-collapse`, `__inner` | `data-open`, `data-pad="sm"`, `data-accessory` |
| DefinitionList | `lm-deflist` | `data-layout="inline"`, `data-min`, `data-tone="strong"` |
| Pager | `lm-pager`, `__status`, `__now`, `__total`, `__gauge` | `--lm-p` (0 to 1) |
| ProgressBar | `lm-progress`, `__row`, `__track`, `__fill`, `__point`, `__foot`, `__text` | `data-size`, `data-tone`, `data-indeterminate`; `--lm-p` |
| Meter | `lm-meter`, `__svg`, `__track`, `__arc`, `__bar`, `__barfill`, `__text` | `data-variant="bar"`, `data-size`, `data-tone`; `--lm-p` |
| StepDots | `lm-steps`, `lm-step`, `__dot`, `__num`, `__label` | `data-orientation`; on each `li` `data-state="done\|current\|todo"` |
| Divider / Section | `lm-divider`; `lm-sections`, `lm-section`, `__head`, `__titles`, `__title`, `__desc`, `__actions` | `data-end`, `data-vertical`; `data-rule`, `data-level` |

Tokens: `--section-gap`, `--section-gap-inner` (data.css). Everything else is read from `tokens.css`: `--color-lit*` for the chosen thing,
`--color-border*` for the hairlines, `--color-warm` for the light itself, `--radius-*`, `--duration-*` and `--ease-out`.

Motion is the logo's: the rule draws (`rule-draw`) and its point lights (`rule-light`), both from `motion.css`; progress, the pager's gauge and the meter's
arc move by `transform` (or a dash length) with `--ease-out`; the only loop is the indeterminate bar's. Under `prefers-reduced-motion` everything lands on its end state.

## Accessibility

- Targets: line tabs 44 px, segments 38 (30 small) inside a 3 px pill, table action buttons 44 (36 in a compact table), the pager's buttons 44, step buttons
  32 (44 as a rail row). All pressable things are at least 24 px (we aim for 44).
- Names: a `Table`'s region is named, a `ProgressBar` and a `Meter` have a required `label`, `StepDots` and the tab strips are named lists or landmarks, an
  `Avatar` is silent unless you give it `alt`, a `Stat`'s drawing is hidden and its text is the value.
- `Table` is focusable as a scroll region and stacks without losing its semantics (see above); the stacked cards are labelled by their own cells.
- Forced colours (Windows high contrast): backgrounds and shadows are not painted there, so a chosen tab, segment, row, progress fill, meter and step carry their state in
  a border or fill of the system's `Highlight` (the block at the end of `data.css`).
- The gallery section passes axe (WCAG 2.2 AA, no violations) at 1440, 390 and 320 px and has no horizontal overflow from 320 to 1440 px.
- Keyboard on true tabs: Tab reaches the selected tab, arrows move between tabs, Home and End jump, Enter or Space selects (`activation="manual"`), Tab
  again enters the panel. The roving tabindex is derived from the selected value, so it needs no state of its own.

## Migrating a page

| Site | Today | Becomes |
|---|---|---|
| `app/connections/ConnectionsClient` tab nav | `<nav aria-label="Connections views">` of buttons with `aria-current="page"`, label "Requests (n)" | `ButtonTabs semantics="current" label="Connections views"`, `onSelect` keeps `url.apply({ tab, cursor: null })` |
| `app/connections` `ViewToggle` (Cards / Network) | buttons with `aria-pressed`, disabled while pending, hidden below `sm` | `ButtonTabs variant="segmented" size="sm" disabled={url.pending}` (the wrapper that hides it below `sm` stays the page's) |
| `app/admin/reports` status tabs | `<nav aria-label="Report status">` of buttons with **no** state attribute | `ButtonTabs semantics="current"`: adds `aria-current="page"`, as `admin/connections` already has (names unchanged) |
| `app/admin/connections` status tabs | the same nav, buttons with `aria-current="page"` | `ButtonTabs semantics="current"` |
| `app/my-activity` | a `div` of buttons, no state attribute, labels with a `· n` count | `ButtonTabs semantics="pressed"` with `TabCount` (adds `aria-pressed`; the name keeps the count) |
| `app/calendar` List / Month | buttons, no state attribute | `ButtonTabs variant="segmented" size="sm"` (adds `aria-pressed`) |
| `app/login` `ModeToggle` | two buttons with `aria-pressed` ("Sign up", "Log in") | `ButtonTabs variant="segmented" fill` (`auth.spec.ts` clicks the "Log in" button by name) |
| `app/foundry-ai/ModeTabs` | `role=tablist` / `tab`, `aria-selected`, no arrow keys | `Tabs panels={false}` + `TabList label="Search mode"` + `Tab` (gains the roving tabindex and arrows; `activation="manual"`, so nothing fires while arrowing) |
| (none today) | | `LinkTabs` is for the pages that gain real route tabs, e.g. `/community` and `/community/mine` |
| `PosterAvatar` (VCs), `OrganiserAvatar` (events), `Community`'s `Avatar`, `CardAvatar` (AI results), the profile and intake photo previews | a letter in a circle in several shapes, or a bare `<img alt="">` | `Avatar` (`size="xs"` for the 20 px ones, `lg` for the 64 px previews; inside an `Entry` glyph it drops its own ring by itself) |
| `app/admin/ai/AiAdminClient` `Stat` ×15 | text tiles in a `grid sm:grid-cols-3` | `StatGrid min="sm"` of `Stat size="sm"`; spend and request tiles take `meter` |
| `app/admin/connections` `Stat` ×3 | tiles in `grid gap-px border bg-border` | `StatGrid` of `Stat` |
| `admin/connections` senders, `admin/members`, `admin/edits`, `cookies` ×2 | `<table>` with its own wrapper | `Table` (`label` = the old region label; `TD label` for the stack; `narrow="scroll"` for the edits diff if its three columns must stay columns) |
| `OpportunityCard`, `EventCard`, `VcCard` (the list pages), the admin review cards | a button with "▸ Show details", `{open && …}` | `Disclosure` (`lazy` for the cards `urlfilters.spec.ts` asserts on; `open`/`onOpenChange` where opening has effects) |
| `foundry-ai/ResultList` "Why this match" | a button with `aria-expanded`/`aria-controls`, `{open && …}` | the same button, `Collapse id={detailsId} open={open}` |
| `ListingDetailShell` `Fact`, the calendar dialog's `dl` | a div per fact, tracked-capital label; a hand-built `dl` | `DefinitionList` + `Definition` (grid), `layout="inline"` for the dialog |
| `Pager` | two flat buttons and a sentence | unchanged call sites; the look is the new one |
| `IntakeProgressBar`, onboarding `ProgressBar` | hand-built bars | `ProgressBar` (`layout="inline"`, `end="{pct}% profile complete"`; `start="1 / 2" end="50%"` with `valueText="Step 1 of 2"`) |
| `intake/StepRail` | a `nav` of groups, `aria-current="step"` row, buttons | the same `nav` and group headings, one vertical `StepDots` per group with `done` passed, `onSelect={onJump}` |
| hand-written section heads (`mt-12 rule-draw pt-6` + a small label) | | `Section rule` inside `lm-sections` |

Things this family did not change: the names, labels and roles of the existing controls (every item above keeps the accessible name it has today, except
that two sites gain a state attribute they lacked), URL-as-state (`useUrlFilters`), the `data-testid`s, `<article>` for cards, the ids that specs read
(`#o-<id>`), and the rows `tbody tr` counts.

## Things worth knowing

- **`base.css` is mostly unlayered, and unlayered CSS beats `@layer components` and Tailwind's utilities.** The global `:focus-visible { outline-offset }`
  beats a component's own `outline-offset`, so a component that needs a different ring offset sets the `--focus-offset` variable the global rule reads (the
  disclosure's trigger does). (The `p { text-wrap: pretty }` and `h1, h2, h3 { text-wrap: balance }` defaults used to bite too, because `text-wrap` resets
  `white-space: nowrap`; they now sit in `@layer base`, so `truncate` and `whitespace-nowrap` work on a `<p>`.)
- A **table that stacks** relies on a container query (Chrome 105, Safari 16, Firefox 110 and later). Where unsupported it simply stays a table with its
  scroll region, which is still correct.
- `Disclosure` needs a **client boundary** only because it keeps state; a page that passes it `open` still owns the state.
- The gallery's sample photographs are SVGs drawn in the file (the CSP allows no third-party images).
