import type { ReactNode } from "react";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";
import { Field } from "@/components/forms/Field";
import {
  ChipDemo, ChoiceDemo, DisclosureDemo, FilterDemo, FormDemo, MultiSelectDemo, PickDemo, SearchDemo, SwitchDemo,
} from "@/components/forms/FormsLiveDemo";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { Radio } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

// The Forms section of the design-system gallery (/admin/design-system). Owned by the forms family. The static states are rendered here, on
// the server; the demos that must be touched to show anything (a chip that toggles, a pick that opens) are in components/forms/FormsLiveDemo.

// The same Section as page.tsx, copied locally so the look cannot drift from it.
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-border-subtle py-12">
      <div className="grid gap-2">
        <h2 className="font-display text-heading text-text-primary">{title}</h2>
        {note ? <p className="measure-prose text-small text-text-secondary">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One family of controls: a card with a title, a line of when-to-use, and the demos. `bare` drops the card, for demos that are cards themselves. */
function Block({ title, note, bare = false, children }: { title: string; note?: string; bare?: boolean; children: ReactNode }) {
  const body = (
    <>
      <div className="grid gap-1.5">
        <h3 className="font-display text-title text-text-primary">{title}</h3>
        {note ? <p className="measure-prose text-small text-text-secondary">{note}</p> : null}
      </div>
      {children}
    </>
  );
  if (bare) return <div className="grid gap-7 px-1 pt-2">{body}</div>;
  return <Panel className="grid gap-7 p-6 sm:p-8">{body}</Panel>;
}

/** A demo with the name of its state under it. */
function Cell({ state, children }: { state: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2.5">
      {children}
      <p className="text-caption text-text-muted">{state}</p>
    </div>
  );
}

const GRID = "grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4";

export function FormsGallery() {
  return (
    <Section
      title="Forms"
      note="One family for every control that takes input or makes a choice. A field is a pane of the night with an edge that wakes up: pointing at it warms the edge, focus lights it (a cream edge and a wide faint amber halo), chosen is amber, wrong is the danger edge with a drawn mark and a sentence. Defined once, in forms.css."
    >
      <div className="grid gap-8">
        <Block
          title="Fields"
          note="A label above, then a control at least 48 px high with a firm edge (3:1). Everything is a class, so a plain <input className={inputCls}> and the <Input> primitive look the same. Hover needs a pointer, so it is shown here with data-state; the live one is the edge warming as you point."
        >
          <div className={GRID}>
            <Cell state="Default">
              <Field label="Company" required>
                <Input type="text" placeholder="e.g. Orbital Labs" />
              </Field>
            </Cell>
            <Cell state="Hover (shown static; live it needs a pointer)">
              <Field label="Company" required>
                <Input type="text" data-state="hover" defaultValue="Orbital Labs" />
              </Field>
            </Cell>
            <Cell state="Focus (shown static; live it is :focus)">
              <Field label="Company" required>
                <Input type="text" data-state="focus" defaultValue="Orbital Labs" />
              </Field>
            </Cell>
            <Cell state="Filled">
              <Field label="Company" required>
                <Input type="text" defaultValue="Orbital Labs" />
              </Field>
            </Cell>
            <Cell state="Error">
              <Field label="Company" required error="Company is required.">
                <Input type="text" />
              </Field>
            </Cell>
            <Cell state="Disabled">
              <Field label="Signup email">
                <Input type="email" defaultValue="demo@imperial.ac.uk" disabled />
              </Field>
            </Cell>
            <Cell state="Read-only">
              <Field label="Profile link">
                <Input type="text" defaultValue="foundry.imperial.ac.uk/members/sam-rivera" readOnly />
              </Field>
            </Cell>
            <Cell state="Loading (aria-busy: the field breathes)">
              <Field label="Luma link" hint="Checking it">
                <Input type="url" defaultValue="https://lu.ma/foundry-demo-night" readOnly aria-busy="true" />
              </Field>
            </Cell>
          </div>
        </Block>

        <Block
          title="Field types"
          note="Textarea, select, number, date, time and file are the same field in other shapes. The select keeps its native behaviour and draws its chevron in its own background, so the label that holds it still names it. Date, time and file are themed to the night."
        >
          <div className={GRID}>
            <div className="sm:col-span-2">
              <Cell state="Textarea. The counter sits in the label's hint, where a screen reader hears it with the name.">
                <Field label="Job description" required hint="146/5000">
                  <Textarea rows={4} defaultValue="We are building the calendar layer for climate fintech. You will own the design system, the onboarding flow and the dashboards investors see." className="resize-none" />
                </Field>
              </Cell>
            </div>
            <Cell state="Select">
              <Field label="Location type" required>
                <Select defaultValue="hybrid">
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                </Select>
              </Field>
            </Cell>
            <Cell state="Select, disabled">
              <Field label="Start year">
                <Select defaultValue="2027" disabled>
                  <option value="2027">2027</option>
                </Select>
              </Field>
            </Cell>
            <Cell state="Number">
              <Field label="Graduation year from" hint="range 2019–2028">
                <Input type="number" min={2019} max={2028} defaultValue={2024} />
              </Field>
            </Cell>
            <Cell state="Date">
              <Field label="Final date to apply" required>
                <Input type="date" defaultValue="2026-12-18" />
              </Field>
            </Cell>
            <Cell state="Time and date">
              <Field label="Starts at">
                <Input type="datetime-local" defaultValue="2026-12-02T18:30" />
              </Field>
            </Cell>
            <Cell state="File: the browser's button becomes one of ours">
              <Field label="Your CV">
                <Input type="file" />
              </Field>
            </Cell>
            <Cell state="Compact (44 px) for dense rows">
              <Field label="Deadline from">
                <Input type="date" compact defaultValue="2026-12-01" />
              </Field>
            </Cell>
            <Cell state="Error on a select">
              <Field label="Location type" required error="Pick where the role is based.">
                <Select defaultValue="">
                  <option value="" disabled>Choose one</option>
                  <option value="remote">Remote</option>
                </Select>
              </Field>
            </Cell>
          </div>
        </Block>

        <Block
          title="Search"
          note="A pill with a glass and a clear button. It always has an accessible name (a placeholder is not one), and the filter boxes keep their value in a debounced draft so the URL stays calm."
        >
          <SearchDemo />
        </Block>

        <Block
          title="Checkbox and radio"
          note="The native inputs, redrawn: still focusable, announced, clickable, counted by role. Chosen is amber with a drawn tick or a lit body. An error on the group turns every edge to danger."
        >
          <ChoiceDemo />
          <div className="grid gap-5 sm:max-w-xl">
            <Field label="Who is this job for?" required group error="Pick who this job is for.">
              <div className="grid gap-3 sm:grid-cols-3">
                <Radio card name="demo-audience-error" value="students" label="Students" />
                <Radio card name="demo-audience-error" value="graduates" label="Graduates" />
                <Radio card name="demo-audience-error" value="both" label="Both" />
              </div>
            </Field>
          </div>
        </Block>

        <Block
          title="Switch"
          note="For a setting that takes effect now. A pill track with a ring for a knob (the logo's ring); on, it travels and lights amber. Still a checkbox with role=switch underneath. A request in flight shows as a spinning knob, not as 'off'."
        >
          <SwitchDemo />
        </Block>

        <Block
          title="Chips"
          note="A pill you can switch on, for a short set of kinds. Chosen is amber (a lit wash, a lit edge, a cream word and a drawn tick). A set of more than twelve is kept short: see the pick below."
        >
          <ChipDemo />
          <PickDemo />
        </Block>

        <Block
          title="Searchable multi-select"
          note="For a list long enough to need a search box (the 200 courses). It is a popover: a field-faced trigger, a raised list, arrow keys, Escape to close. Not a native select."
        >
          <MultiSelectDemo />
        </Block>

        <Block
          title="Filter bar"
          note="The chrome every list page shares: a search pill, a Filters button that carries the count of what is applied, Clear all, the result count (a status region), and a panel that opens on arrival when filters are already in the URL. The long skills set is a pick."
        >
          <FilterDemo />
        </Block>

        <Block
          bare
          title="A form"
          note="One card (FormSection) with a title; fields in Field; a titled cluster in FieldGroup; the row that ends it in FormActions, with one primary action. Submit it empty to see the error arrive."
        >
          <FormDemo />
        </Block>

        <Block
          bare
          title="Notes and notices"
          note="The words that surround a form: what editing a listing will do, a review waiting (amber, never the danger red), the screen shown in place of the form, and the signup disclosure."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="grid content-start gap-2">
              <EditStatusNote status="approved" noun="opportunity" />
              <EditStatusNote status="pending" noun="event" />
              <div className="mt-4" />
              <QueuedRevisionBanner queuedAt="2026-11-10T09:30:00Z" />
            </div>
            <DisclosureDemo />
          </div>
          <RevisionQueuedNotice noun="event" remindAboutLuma lumaLink="https://lu.ma/foundry-demo-night" />
        </Block>
      </div>
    </Section>
  );
}
