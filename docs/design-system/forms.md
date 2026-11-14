# Forms (Lumen)

One family for every control that takes input or makes a choice: fields, search, checkbox, radio, switch, chips, the disclosure that keeps a
long chip set short, the searchable multi-select, and the shells that group them.

- **Defined once** in `frontend/src/design-system/forms.css` (reads `tokens.css` only). Change how every input in the product looks there.
- **Consumed through** `forms/styles.ts` (`inputCls`, `labelCls`), the components in `components/forms` and `components/filters`, and the
  primitives in `components/ui`.
- **Living reference:** `/admin/design-system`, section "Forms". It renders the real components in every state.

## The idea

A field is a pane of the night with an edge that wakes up.

| | |
|---|---|
| **Rest** | a quiet tint inside a firm hairline (`border-strong`, 3:1 on the page and on a panel), radius 12 px, at least 48 px tall |
| **Pointed at** | the edge warms toward amber (`--lm-edge-hover`); the fill steps up one tint |
| **Focus** | a cream (sun) edge, 2 px, and a wide faint amber halo with a pool of light under it, like light falling on the field. It replaces the global ring for fields: never two rings, never none |
| **Chosen** | amber: a lit wash, a lit edge (`--lm-edge-lit`, 3.9:1), a cream word, and a drawn tick or lit body. Never colour alone |
| **Wrong** | the danger edge, a drawn mark (`Icon name="error"`) and a sentence in `<p role="alert">`. Focus keeps the cream edge and turns the halo red |
| **Off** | no fill, the quiet rule instead of the firm edge, muted ink, a not-allowed cursor. Quieter by structure, not only by opacity |

Everything is a class plus data attributes, so a raw `<input className={inputCls}>` and the `<Input>` primitive are the same thing.

## What exists

| You need | Use | File |
|---|---|---|
| a label above a control, with an optional hint and error | `Field` | `components/forms/Field.tsx` |
| the error sentence on its own (control outside a `Field`) | `FieldError` | same file |
| a single-line input (text, email, url, number, date, time, file) | `Input`, or `className={inputCls}` | `components/ui/Input.tsx` |
| several lines | `Textarea` | `components/ui/Textarea.tsx` |
| one choice from a short list, natively | `Select` | `components/ui/Select.tsx` |
| one yes or no | `Checkbox` | `components/ui/Checkbox.tsx` |
| one of a few exclusive options | `Radio` (`card` for 2 to 3 short ones) | `components/ui/Radio.tsx` |
| a setting that takes effect now | `Switch` | `components/forms/Switch.tsx` |
| a pill you can switch on | `Chip` | `components/ui/Chip.tsx` |
| a set of chips, short or long | `ChipSet`, via `ChipGroup` (ids) or the filters' `ChipGroup` (strings) | `components/ui/ChipSet.tsx` |
| a search box | `SearchField`; in filters `SearchInput` (its clear button is a tab stop; `clearFocusable={false}` takes it out where the box sits above a list the keyboard Tabs into, as in `SearchableMultiSelect`) | `components/ui/SearchField.tsx` |
| a very long list with a search box | `SearchableMultiSelect` | `components/forms/SearchableMultiSelect.tsx` |
| the filter chrome of a list page | `FilterPanel`, `ChipGroup`, `ChipChoice`, `RangeFilter` | `components/filters/FilterBar.tsx` |
| the card a form sits in | `FormSection` | `components/ui/FormSection.tsx` |
| a titled cluster of fields inside a form | `FieldGroup` | same file (`ui/FormSection.tsx`) |
| the row that ends a form | `FormActions` | `components/ui/FormActions.tsx` |

Around a form: `EditStatusNote`, `QueuedRevisionBanner`, `RevisionQueuedNotice`, `ContactEmailSection`, `EducationForm`,
`SignupDisclosures`, `TurnstileWidget` (all in `components/forms`).

## Anatomy of a field (the contract e2e relies on)

```tsx
<Field label="Role title" required hint="optional note" error={errors.title}>
  <Input type="text" value={title} onChange={...} />
</Field>
```

renders

```html
<div data-invalid>                       <!-- only when there is an error -->
  <label class="block">
    <span class="lm-label mb-2">Role title <span class="lm-label__req">*</span><span class="lm-label__hint">optional note</span></span>
    <input class="lm-field" aria-invalid="true" aria-describedby="…">   <!-- the two aria attributes only while in error -->
  </label>
  <p id="…" role="alert" class="lm-error"><svg aria-hidden/>Role title is required.</p>   <!-- OUTSIDE the label -->
</div>
```

- The control is **inside** the label, so every field is named and `getByLabel(/^Role title/)` matches. The required star and the hint stay inside
  the label's span. Do not move them out.
- The error is **outside** the label, so it does not become part of the control's name, and `role="alert"` announces it when it appears.
  `Field` ties it to the control with `aria-describedby` (a description, not a name) and marks it `aria-invalid`, for a single `input`,
  `textarea`, `select`, `Input`, `Textarea` or `Select` child. Anything else is left as written.
- `data-invalid` is what `showFieldErrors()` looks for, and what the stylesheet reads to turn the edge to danger.
- Several controls under one question (a radio set) take `group`: `<Field group label=… error=…>` renders `fieldset` and `legend`.
- Ids that specs use (`#email`, `#password`, `#first-name`, …) are the page's; none of these components invents an id except for
  `aria-describedby` and `aria-controls` pairs, made with `useId`.

## States

| State | How it looks | How you get it |
|---|---|---|
| Default | tint-1 fill, `border-strong` edge, `text-muted` placeholder | nothing |
| Hover | edge warms, fill steps up | automatic, pointer devices only. Shown in the guide with `data-state="hover"` |
| Focus | cream edge + amber halo | automatic (`:focus`). Shown in the guide with `data-state="focus"` |
| Filled | primary ink | a value |
| Error | danger edge, drawn mark, sentence | `<Field error="…">`, or `invalid` on a primitive, or `aria-invalid="true"` |
| Disabled | no fill, quiet rule, muted ink | `disabled` |
| Read-only | no fill, quiet rule, readable ink, still focusable and selectable | `readOnly` |
| Loading | the field breathes (opacity only) | `aria-busy="true"` |
| Chosen | amber + tick | `aria-pressed="true"` on a chip, `:checked` on a box, ring or switch |
| Busy switch | the knob's ring goes dotted and turns; the track keeps its state | `<Switch busy>` |
| Empty list | "No matches." in the list or the pick | automatic |

Motion is only opacity, transform and the individual `translate` / `rotate` properties, on the system's one curve, and lands on its end state
under `prefers-reduced-motion`. A forced-colours block keeps every drawn tick, dot and chevron visible.

## Which one

- **Switch or checkbox.** A switch is a setting that takes effect the moment you flip it (the settings pages). A checkbox is an answer
  that is submitted with the form, or one of several things you may tick.
- **Radio cards, a radio list, or a select.** Two or three short, exclusive options: cards (`card`). Options that need a second line: a plain
  radio list with `hint`. Four or more, or long labels: a `Select`.
- **Select or searchable multi-select.** A native `Select` for a short list you pick one from. `SearchableMultiSelect` when the list is
  long enough to need a search box (courses) and you may pick several.
- **Chips or a pick.** Twelve chips or fewer are a plain wrap. More than that (`collapseAfter`, 12) is a pick: only what is chosen shows, plus a
  ring that opens the rest under a search box. The chips are the same elements either way, so nothing is lost to a screen reader.
- **FormSection or Panel.** `FormSection` is a Panel with the form's padding, a title and a gap between fields. Use `Panel` for anything
  that is not a form.
- **FieldGroup or Field group.** `FieldGroup` is a titled cluster with a hairline above it (the contact email block). `<Field group>` is a
  single question whose answer is several controls (a radio set).

## Do and do not

| Do | Do not |
|---|---|
| Put the label above the control, in sentence case | Set labels in tracked capitals, or use the placeholder as the label |
| Keep a required star inside the label's span | Move the star, the hint or the error text into or out of the label |
| Give a bare control (a table's checkbox, a search box) an `aria-label` | Leave an input without a programmatic name |
| Use `className={`${inputCls} resize-none`}` to adjust a field: utilities written after it win | Add a second focus ring, outline or glow to a field |
| Use `Chip` for a toggle, with `aria-pressed` | Draw a chosen state with colour alone, or use a div with `role="button"` |
| Use `Switch` for a setting, `Checkbox` for an answer | Use a switch in a form that is submitted later |
| Put `FormActions` last, with one primary action | Put two primary buttons in one form |
| Use `Icon name="error"` and a sentence for an error | Show an error as a red border alone |
| Keep the 48 px height; use `compact` (44) only in a dense row | Go below 44 px for anything pressable |
| Use `Radio card` for 2 to 3 exclusive options | Use cards for a long list |
| Put a long chip set in `ChipSet` (it collapses itself) | Render 170 chips in one wrap |
| Underline a link inside a sentence | Rely on colour to mark an in-text link |

## Classes, attributes and tokens

All in `forms.css`, in the components layer, so utilities written after them win. Two small blocks are unlayered on purpose (they must beat
`base.css`): the global focus ring is dropped for fields, and the browser's date and time icons are replaced.

| Class | What |
|---|---|
| `.lm-label`, `.lm-label__req`, `.lm-label__hint` | the caption above a control |
| `.lm-error` | the error sentence and its drawn mark |
| `.lm-field` | input, textarea, select, or a button that opens a list (`data-trigger`). `data-size="sm"` (44 px), `data-state="hover|focus"` (guide only), `data-spin="off"` (no number steppers) |
| `.lm-static` | a value shown in a field's shape that is not a control |
| `.lm-search`, `.lm-search__icon`, `.lm-search__clear` | the search pill |
| `.lm-check`, `.lm-radio`, `.lm-switch` | the redrawn native inputs |
| `.lm-choice`, `.lm-choice__text`, `.lm-choice__hint`, `data-card` | a control with its words as one target |
| `.lm-chip`, `.lm-chip__label`, `.lm-chip__x` | a chip. `aria-pressed="true"` or `data-lit` lights it; `data-size="sm"` |
| `.lm-pick`, `.lm-pick__head`, `.lm-pick__toggle`, `.lm-pick__list`, `.lm-pick__empty` | the long-set disclosure; `data-open` |
| `.lm-ms`, `.lm-ms__pop`, `.lm-ms__head`, `.lm-ms__list`, `.lm-ms__opt`, `.lm-ms__box`, `.lm-ms__empty` | the searchable multi-select |
| `.lm-count`, `.lm-chev`, `.lm-chev--right` | the count disc in the Filters button; the class of an `<Icon name="chevron-down">` that flips with the `aria-expanded` of its button (`--right` points right when closed: a disclosure) |
| `.lm-formsec`, `.lm-group`, `.lm-actions` | the shells |

Tokens it reads (from `tokens.css`): `--color-border-strong`, `--color-tint-1..3`, `--color-text-*`, `--color-sun`, `--color-warm`,
`--color-lit-muted`, `--color-lit-glow`, `--color-accent-light`, `--color-danger`, `--color-danger-muted`, `--radius-lg`, `--radius-pill`,
`--font-sans`, the type tokens, and the motion tokens. It defines two of its own, from those: `--lm-edge-hover` and `--lm-edge-lit`.

One thing that does not follow a token: a `<select>`'s chevron is a background image (a select takes no pseudo-element and the label that
holds it takes no wrapper), and a background image cannot read a custom property. So `--lm-select-chevron*` take no hue at all: the stroke is
white at three opacities (0.72 at rest, 1 when pointed at or focused, 0.38 disabled), which on the night reads as text-secondary, ink and a
dim ink. The marks a control draws on itself (the tick and dash, the calendar and clock in a date field, the datalist arrow) are masks, so
they take whatever colour their element has. Standalone glyphs (the chevron on a button, the plus and cross of a pick and a tag, the search
glass, the error mark) are `<Icon>`s, so the icon set owns their drawing. Every colour mix in this file is `in oklab`
(see `tokens.guard.test.ts`).

## Accessibility

- Edge 3:1 against the page and a panel (the tokens test pins `border-strong`). The chosen edge is stronger than `--color-lit-line` on
  purpose: that hairline is 2.3:1 on a panel, and a chosen control is a boundary too.
- Focus is a 2 px cream edge plus a halo on fields, and the global 2 px ring (offset 3) on everything else. A card-shaped radio rings the whole
  card.
- Targets: fields 48, compact 44, chips 40 (36 small), switch 54 x 32, the pick's ring 40, the search clear button 40. All pressable things are
  at least 24 px (we aim for 44).
- Names: every input has a programmatic name. The search box and the pick's search box are named by `aria-label`; the pick's ring is named
  "All <things>" and carries `aria-expanded` and `aria-controls`.
- State is never colour alone: a chosen chip has a tick, a chosen box a tick or dot, an error a mark and a sentence, a disabled control loses its
  fill and its firm edge.
- `SearchableMultiSelect` keeps its listbox behaviour (`role="listbox"` wraps only the options, with `aria-multiselectable`) and adds arrow keys,
  Home and End; options are still reachable with Tab.
- Enter inside the search box of a pick or of the multi-select does not submit a form that contains them.

## Migrating a page

1. `<input className={inputCls}>`, `<select className={inputCls}>`, `<textarea className={`${inputCls} resize-none`}>` already look right. Swap to
   `Input`, `Select`, `Textarea` when you touch them.
2. A hand-rolled radio or checkbox label becomes `Radio` or `Checkbox` (`card` for a short exclusive set). Keep the same `name`, `value` and
   `onChange`; the accessible name stays the label's words.
3. `form.space-y-5 rounded-2xl bg-bg-card border border-border p-8` becomes `FormSection as="form"` with a `FormActions` row.
4. A block with a heading and a border-top, such as "Contact email", becomes a `FieldGroup`. Do not put the border or padding on a bare
   `<fieldset>`: a fieldset draws its legend across its own top border.
5. A local `inputCls` copy (login, settings, contact, reset password) becomes the shared one from `@/components/forms/styles`.
6. A long set of chips goes through `ChipGroup`; do not map it by hand.

Things this family did not change: the names, types, ids, labels, required flags and options of any field; `role="switch"`, `aria-pressed`,
`aria-expanded` on the Filters button, "Clear all", the `role="status"` count; the error structure above; URL-as-state in `useUrlFilters`.
