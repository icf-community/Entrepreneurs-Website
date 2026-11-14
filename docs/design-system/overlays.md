# Overlays and feedback (Lumen)

Everything that sits over a page or answers an action: the dialog and the drawer, the popover and the menu, the tooltip, the toast, the notice
(every banner and callout), the empty state, the spinner and the skeletons.

- **Defined once** in `frontend/src/design-system/overlays.css` (reads `tokens.css` only). Change how every overlay in the product looks there.
- **Consumed through** the components in `frontend/src/components/ui` (and `SiteBanner`, `SegmentError`, `ListingGoneNotice`, `PendingRevisionNotice`,
  `SubmittedBanner`, `FilteredListLoadingSkeleton`, `forms/Banners` in `components`).
- **Living reference:** `/admin/design-system`, section "Overlays and feedback". Every piece in every state, the live ones clickable, the ones that only exist
  while open (a dialog's panel, a menu, a tooltip's bubble) also drawn at rest.

## The idea

An overlay is **raised**; feedback is **a tone drawn in light**.

| | |
|---|---|
| **Raised** | `bg-raised`, a hairline, a whisper of warm light along the top edge (a gradient hairline on a dialog, an inset highlight on the small ones), and the one soft shadow, `--shadow-pop`. No other shadow is used here |
| **Backdrop** | a deep night wash with a touch of warm light from above (`.lm-dialog::backdrop`), the page's own atmosphere seen through glass. No blur |
| **Tone** | `info` the cold light, `lit` amber (look at this), `danger`, `success`. A tone colours a hairline, a wash and a drawn icon in a ring. Never a coloured stripe, and never colour alone: there are always words |
| **Motion** | transform and opacity, one curve, 140 to 420 ms. Every keyframe ends on the element's resting style, so reduced motion (which zeroes the durations) and a finished animation look identical. The two idle loops are slow: the skeleton's sweep (4.2 s, mostly rest) and the orbit spinner |
| **Targets** | every control is 44 px to hit (the small "i" is drawn at 28 px with a 44 px hit area) |

## Choosing

| The task | Use | Why |
|---|---|---|
| must interrupt and hold focus: a confirmation, a short form that has to be finished or abandoned | `Dialog` | a native modal: it traps focus and makes the page inert |
| a panel on one edge: a filter panel, a detail pane | `Sheet` | the same dialog, drawn as a drawer |
| a few links, a short form, some extra explanation behind a button | `Popover` | a disclosure: no interruption, no trap |
| a list of commands | `Menu` | `role="menu"` with arrow keys |
| one sentence that explains a control or a value | `Tooltip` / `InfoTip` | out of the row that would otherwise carry it |
| an outcome that has nowhere else to appear | `useToast` | one sentence |
| a message that belongs to a place (above a form, over a page, inside a card) | `Notice` | one banner for all of them |
| a list with nothing to list | `EmptyState` | |
| waiting, and the shape of the result is known | `Skeleton` family | sized to the real thing |
| waiting, and it is not | `Spinner` | |

**Prefer a Popover or a disclosure to a modal whenever the task needs neither interruption nor protected focus.** A modal is expensive: it hides the page, traps the
keyboard and has to be dismissed. If the user can carry on without answering, do not make them.

## What exists

### Dialog (`ui/Dialog.tsx`, `ui/dialogCloser.ts`)

```tsx
{open && (
  <Dialog label="Delete your post" tone="danger" onClose={close} className="w-full max-w-[30rem] p-7">
    <div className="flex items-start justify-between gap-4">
      <h2 className="font-display text-title text-text-primary">Delete this post?</h2>
      <DialogClose className="-mr-2 -mt-2" />
    </div>
    …
    <Button variant="quiet" size="md" onClick={closeDialog}>Cancel</Button>
  </Dialog>
)}
```

| Prop | |
|---|---|
| `onClose`, `label`, `className`, `containerClassName`, `children` | unchanged from before |
| `tone` | `default` or `danger` (the panel's edge and its top light in the danger tone) |

- **Behaviour is untouched**: native `<dialog>`, `showModal()` on mount, the `close` listener, the body scroll lock, a click outside closes (the panel stops propagation),
  `closeDialog` and `dialogCloser` unchanged. Mounting it opens it.
- **Pass only layout in `className`** (width, padding, overflow). The surface, border, radius and shadow are the Dialog's. A utility passed here still wins
  (that is how a bottom sheet on a phone asks for `rounded-t-2xl sm:rounded-2xl`), so a page that has not been migrated keeps looking as it asked to.
- **`DialogClose`** is the close control: a round ring with `Icon name="close"`, named **"Close"**, closing the dialog it is inside (so the browser restores focus to the
  trigger). It replaces the five hand-written close buttons (`aria-label="Close"` stays, which is what `dialog.spec` clicks). `disabled` is supported
  (`ConnectControl` disables it while sending). It also works inside a Sheet.
- **The trigger is never touched**: no class, no attribute. `dialog.spec` compares `outerHTML.slice(0, 200)` of the trigger before and after.

### Sheet (`ui/Sheet.tsx`)

```tsx
{open && <Sheet label="Filters" title="Filters" side="right" onClose={() => setOpen(false)}>…</Sheet>}
```

A drawer from the left or right (`side`, default right), 22 rem wide at most (90 vw on a phone), inner corners round, outer edge flush with the screen. With a `title` it
draws a sticky header (the title and the Close ring, `closeLabel` to rename it); without one, put `<DialogClose />` in the content.

- **Native `<dialog>` only**, opened with `showModal()`: a real focus trap, Escape, focus back to the trigger, the page inert. No `role="dialog"` or `aria-modal` div anywhere
  (an e2e spec forbids them).
- **Mount it to open it, and unmount it to close it**, exactly like `Dialog`. **Never keep a closed Sheet in the DOM**: `dialog.spec` counts `dialog` elements
  (`openDialog` only clicks the trigger while there are none, and it expects zero after closing).

### Popover and Menu (`ui/Popover.tsx`)

```tsx
<Popover label="Add to calendar" icon="calendar-plus" panelClassName="w-64 p-1.5">
  <a className="lm-pop__item" href="…">Google Calendar</a>
  <a className="lm-pop__item" href="…">Apple Calendar or Outlook</a>
</Popover>

<Menu label="More actions" iconOnly placement="bottom-end">
  <MenuItem icon="edit" onSelect={edit}>Edit post</MenuItem>
  <MenuItem icon="flag" href="/contact">Report</MenuItem>
  <MenuSeparator />
  <MenuItem icon="trash" tone="danger" onSelect={remove}>Delete post</MenuItem>
</Menu>
```

| Prop | |
|---|---|
| `label` | the button's text; with `iconOnly` it is the button's accessible name instead |
| `icon`, `iconOnly`, `variant`, `size`, `caret`, `className` | how the button looks: any `Button` variant and size, a leading icon, a chevron; or the round ring icon button |
| `placement` | `bottom-start` (default), `bottom-end`, `top`, `right`, … (flips near an edge) |
| `panelClassName`, `panelLabel` | the panel's classes (width, padding); a name for a Popover's panel (`role="group"`) |
| `defaultOpen`, `onOpenChange` | |
| `children` | the panel; a function receives `{ close }` |

| | Popover | Menu |
|---|---|---|
| Button | `aria-expanded`, `aria-controls` | the same, and `aria-haspopup="menu"` |
| Panel | any content; claims no role (an e2e spec checks that Add to calendar is not a `menu`) | `role="menu"` named by its button; items are `role="menuitem"` (`MenuItem`) |
| Opens | click, Enter, Space; **focus stays on the button** and the next Tab goes into the panel (it follows the button in the DOM) | click, Enter, Space or Down (first item), Up (last item); focus moves to an item |
| Inside | Tab as usual | Up, Down (wrap), Home, End, type-ahead; Enter or Space choose; Tab closes |
| Closes | Escape (focus back to the button), a press outside, focus leaving the panel, `close()` | the same, and choosing an item (focus back to the button) |

The panel is a native `popover="manual"` element, so it lives in the **top layer**: never clipped by an ancestor's overflow, above everything, including the modal dialog it may
sit in. `popover="manual"` rather than `auto` on purpose: the browser's light dismiss and a React-owned `aria-expanded` disagree about a click on the button (it closes on
pointerdown, then the click opens it again). Open, close, Escape, outside press and focus are handled in `ui/anchored.ts`. It is placed by a little JavaScript that
**flips to the other side near an edge and slides to stay on screen** (`ui/floating.ts`, unit-tested); CSS anchor positioning is not in Firefox or Safari yet, so it is not
relied on. Where the Popover API is missing, the panel is a fixed element with a z-index.

The panel is **always in the DOM** (hidden by `display`), so the words in it stay findable and the owner's local content-contract script (`compare.mjs`, not in this repository) counts them as kept.

Rows in a Popover panel may use `.lm-pop__item` (a link or a button, 44 px, same hover and focus) without `role="menuitem"`.

### Tooltip and InfoTip (`ui/Tooltip.tsx`)

```tsx
<Tooltip content="Only people you have connected with can see your email address.">
  <Button variant="quiet" size="sm">Who can see this?</Button>
</Tooltip>

Looking for <InfoTip label="About Looking for">Roles you would like to be matched with.</InfoTip>
```

Opens on hover after **350 ms** (no second wait when you move from one tooltip to the next), on keyboard focus at once (`:focus-visible` only, so focus handed back after a dialog
closes does not pop one), and on a **tap** on a touch screen (a second tap or a tap elsewhere closes). **Escape** dismisses it without moving the pointer or the focus; the pointer
can travel onto the bubble without it closing (WCAG 1.4.13). One at a time.

The trigger is the one child: a button or a link (a keyboard has to reach it) that passes `aria-describedby` through to its element (everything in `components/ui` does).
The bubble is `role="tooltip"`, always in the DOM, and the trigger's `aria-describedby` always points at it. `InfoTip` is the small "i" button (28 px drawn, 44 px hit) with `label`
as its name.

A tooltip is for a sentence, **not for anything a person needs in order to act**: on a touch screen it takes a tap to see.

### Toast (`ui/Toast.tsx`)

`ToastProvider` and `useToast()` are unchanged: `toast("Couldn't update your bookmark. Please try again.", "error")`, tones `error`, `success`, `info`.

A pill: the tone is a drawn glyph (`Icon`) and a hairline in the tone's light, the dismiss control is a quiet ring named **"Dismiss"**, and a hairline along the bottom edge runs out
over the five seconds (hidden under reduced motion; the toast still dismisses itself). The always-mounted live regions are untouched: errors in `role="alert"`, the rest in
`role="status"`, both present before anything is announced. `ToastView` is the one-toast drawing, for the style guide and for a test.

A toast is for an outcome with nowhere else to appear. **Not while a form or dialog is open** (show the error beside it), and never for anything that needs a reply.
It sits in the normal layer (z-index 100), so, as before, it is behind an open modal dialog.

### Notice (`ui/Notice.tsx`)

The one banner every callout is built from.

```tsx
<Notice tone="lit" role="status" title="Your CV is still processing" action={<Button variant="ghost" size="sm">Check status</Button>}>
  It is already saved. Matching starts once it has been read.
</Notice>
```

| Prop | |
|---|---|
| `tone` | `info` (default), `lit`, `danger`, `success` |
| `icon` | an `IconName`; each tone has its own default; `false` draws none |
| `title`, `children`, `action` | a heading line, the words, a button or link below them |
| `onDismiss`, `dismissLabel` | a 44 px dismiss ring; pass the label the old banner had ("Dismiss this notice") |
| `shape` | `box` (default) or `bar` (full-bleed, the incident banner) |
| `role` | `alert`, `status` or none. **The caller chooses it**: only the caller knows how the notice arrives. Notice adds no role and no hidden text, so what a screen reader announces is exactly `children` |

In-text links inside it keep their underline (`.lm-notice__text a`). A server component unless `onDismiss` is used.

Built on it, one family: `ErrorBanner` (alert, danger), `SuccessBanner` (status, success), `SiteBanner` (bar; info is info, warning is lit, critical is danger and cannot be dismissed),
`SegmentError` (an `ErrorBanner`, the one primary "Try again", the error id as a measured value; `SegmentErrorView` is the drawing without the reporting),
`PendingRevisionNotice` (info, clock, status), `SubmittedBanner` (success, dismissible), `ListingGoneNotice` (a compact `EmptyState`).

### EmptyState (`ui/EmptyState.tsx`)

A glyph in a ring with an orbit hairline round it, one small amber body on the orbit (it circles once every 40 s, and rests at 50°, a little above and to the right, under reduced motion), a title, one line and an action. It replaces about twenty pasted cards, and takes the old card's
sentence as `children`, so adopting it changes no words:

```tsx
<EmptyState icon="opportunities">No opportunities posted yet.</EmptyState>
<EmptyState icon="search" title="Nothing matches those filters." action={<Button variant="ghost" size="md">Clear all</Button>}>
  Clear the filters to see everyone you're connected to.
</EmptyState>
```

`icon`, `title` (`titleAs` for a heading), `action`, `size="compact"` (inside a card that is not itself empty), `bare` (no surface of its own: inside a Panel, which must never hold
another panel). A server component. The copy lives in `children` in its own element, so a spec's `getByText(/^Nothing yet\./)` still finds it.

### Spinner and Updating (`ui/Spinner.tsx`, `ui/Updating.tsx`)

`Spinner` is the orbit glyph turning (`size` `sm`/`md`/`lg`, takes the colour of its text). It **keeps turning, slowly, under reduced motion**: a frozen spinner reads as a hung
request. Without `label` it is decorative; with one it is a polite status. `Updating` (the dimmed-list indicator) keeps its `role="status"` and its text, and now draws a small ring
holding the spinner.

### Skeleton (`ui/Skeleton.tsx`, `FilteredListLoadingSkeleton`)

`Skeleton`, `SkeletonRegion`, `CardGridSkeleton`, `RowListSkeleton`, `FilterBarSkeleton`, `TableSkeleton`, `PageHeaderSkeleton`, `FormSkeleton`: same names and props, redrawn as quiet tinted
blocks (rings where an avatar or glyph goes, via `shape="ring"`) with a very slow sweep of light that **stops under reduced motion**. `PageHeaderSkeleton` is drawn to PageHead's size
(the rule, a context line, the title at `text-display`, the lede) so nothing jumps.

What the specs count on **stays**: a region is `role="status" aria-busy="true"` with a "Loading…" label (the specs wait for `[aria-busy="true"]` to be gone), and every block keeps the
class `animate-pulse` (`home.spec` asserts there are none left once a page has settled). Tailwind's pulse itself is switched off by one unlayered rule in `overlays.css`
(`.lm-skel.animate-pulse { animation: none }`: a utility outranks any components-layer rule, so this rule cannot live in the layer), and the sweep is on the block's `::after`.

## Class hooks

`lm-dialog` `lm-dialog__panel` `lm-wash` (the backdrop's wash, for a static specimen), `lm-sheet` `lm-sheet__layer` `lm-sheet__panel` `lm-sheet__head` `lm-sheet__title`,
`lm-pop` `lm-pop__trigger` `lm-pop__item` `lm-pop__sep`, `lm-tip` `lm-tip__bubble` `lm-infotip`, `lm-toasts` `lm-toast` `lm-toast__timer`,
`lm-notice` (`data-tone`, `data-shape`) `lm-notice__icon` `lm-notice__text` `lm-notice__action` `lm-notice__x`, `lm-empty` (`data-size`, `data-bare`) `lm-empty__glyph`,
`lm-spinner` `lm-updating`, `lm-skel` (`data-shape`) `lm-skel-head`. Variants are data attributes (`data-tone`, `data-kind`, `data-side`, `data-open`), never long utility strings.
(`.lm-scrim` is the shell's, for the navigation drawer: the overlay wash is `.lm-wash`.)

## Adopting it in a page

- **Dialog consumers**: drop `rounded-* bg-* border* shadow-*` from `className` and keep the layout; replace the hand-written close button with `<DialogClose />`
  (`disabled={sending}` where it was disabled); a removal or "danger zone" dialog takes `tone="danger"` instead of a red `border-*`.
- **Toasts, `ErrorBanner`, `SuccessBanner`, `SiteBanner`, the skeletons**: nothing to do, they are redrawn in place.
- **A pasted empty card** becomes `<EmptyState>` with the same sentence as `children`.
- **Small explanatory text that crowds a row** moves into an `InfoTip` or a `Tooltip` (it stays in the DOM).
- **Add to calendar** becomes a `Popover` (not a `Menu`: `focus.spec` asserts there is no `role="menu"` there and that Tab from the button reaches a link).
  An overflow "more" button becomes a `Menu iconOnly`.
- **A filter panel** that should not sit inline on a phone becomes a conditionally mounted `Sheet` (the listing pages keep theirs as an inline disclosure because their "Filters" button and its `aria-expanded` are pinned by the specs). **The phone's navigation drawer is not a Sheet**: it is the same labelled rail the desktop shows (`shell.css`, `AppShell`), and while it is open the page behind it is `inert`; its button names ("Open navigation", "Close navigation") are the shell's.
- **`FilteredListLoadingSkeleton`** carries the container classes the list pages use today (`px-4 sm:px-8 py-10 sm:py-12`, `max-w-[1200px]`). If the pages change theirs, change them there too.

## Rules that are easy to break

- **React Compiler is on** (`reactCompiler: true`), and the hooks lint rules come with it: no ref reads in render, no setState in an effect. The popover and tooltip code keep
  their listeners native, attached in effects and read through `useEffectEvent`, for that reason.
- **A function cannot cross from a server component into a client one** (`onDismiss`, `onSelect`, `onClose`): a server page uses `href` items and static notices, and puts
  anything with a handler in a small `"use client"` child (the style guide does exactly that, `OverlaysDemos.tsx`).
- **`color-mix` is always `in oklab`.** `in oklch` with `transparent` paints a missing hue as red on our dark surfaces. A guard test enforces it.
- **No `role="dialog"` or `aria-modal` div, ever.** A `Sheet` or `Dialog` is a native `<dialog>`; a Popover panel has no dialog role.
- **A Popover's panel is not a `Menu`.** `role="menu"` promises arrow-key navigation; use it only through `Menu`.
- **Do not put an opaque background on a page wrapper**: the atmosphere is the night (and overlays are raised surfaces, so they are the exception).

## Verified

`pnpm typecheck` and `eslint` clean for every file in the family; React Doctor 100/100 on each; `ui/floating.test.ts` (ten cases: flip, slide, clamp, alignment).
In a real browser, on the real pages: the assertions of `dialog.spec.ts` and the focus checks of `adversarial/focus.spec.ts` against `/members` with the redrawn Dialog; the
failed-bookmark toast of `resilience.spec.ts` on `/opportunities` (desktop, phone, reduced motion); `banner.spec.ts`'s flow against `SiteBanner` on `/home` and `/login` with
`/api/banner` mocked in the browser; the throttled-navigation flow of `loading.spec.ts` on `/members` and `/opportunities`; Popover, Menu, Tooltip (mouse, keyboard and touch)
and Sheet on the style guide, including the flip at the bottom edge; axe (WCAG 2.2 AA) on the section at rest and with a menu, a popover and a tooltip open, at 1440 and 390,
no violations of any impact; reduced motion measured (the sweep stops, the spinner keeps turning, a toast rests visible).

## Not done, and why

- `PendingRevisionNotice` and `ListingGoneNotice` only appear in a page when a listing has a revision waiting or has disappeared, so they were checked in the style guide, not on a live page.
- `ShellError` has no look of its own (it wraps `SegmentError` in the app shell), so it is unchanged.
- No closing animation: a dialog, sheet or popover goes at once (the element unmounts or hides), where it enters with motion.
- A Popover or Menu stays pinned on screen if its button scrolls out of view; it does not close.
- The full-page screenshot of `/admin/design-system` is taller than Chromium renders faithfully (about 16,000 px), so the style guide's own snapshot cannot be trusted at the bottom of the page.
  This section was reviewed from element screenshots of `#overlays` (the section carries that id).
