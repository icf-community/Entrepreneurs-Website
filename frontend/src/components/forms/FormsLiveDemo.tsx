"use client";

import { useState, type ReactNode } from "react";
import { ChipGroup as IdChipGroup, type ChipItem } from "@/components/forms/ChipGroup";
import { ContactEmailSection } from "@/components/forms/ContactEmailSection";
import { Field } from "@/components/forms/Field";
import SearchableMultiSelect from "@/components/forms/SearchableMultiSelect";
import { SignupDisclosures } from "@/components/forms/SignupDisclosures";
import { Switch } from "@/components/forms/Switch";
import { ChipGroup, FilterPanel, RangeFilter, SearchInput } from "@/components/filters/FilterBar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Chip } from "@/components/ui/Chip";
import { FieldGroup, FormSection } from "@/components/ui/FormSection";
import { FormActions } from "@/components/ui/FormActions";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { Radio } from "@/components/ui/Radio";
import { SearchField } from "@/components/ui/SearchField";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

// ════════════════════════════════════════════════════════════════════
// The stateful half of the Forms section of /admin/design-system: the demos that need to be
// touched to show anything (a chip that toggles, a pick that opens, a switch that travels). The
// static states live in app/admin/design-system/FormsGallery.tsx. Everything here holds its own
// local state and talks to nothing: no URL, no server action.
// ════════════════════════════════════════════════════════════════════

const SKILLS: ChipItem[] = [
  "3D modelling / animation", "Academic research", "Accessibility design", "Accounting", "Actuarial science", "Aerospace engineering",
  "Affiliate marketing", "API design", "Applied mathematics", "Applied physics", "AR/VR development", "Automation / scripting",
  "Backend development", "Battery / energy storage", "Biochemistry", "Bioengineering", "Blockchain / Web3", "Brand strategy",
  "Business development", "Cloud engineering", "Compliance", "Computer vision", "Copywriting", "Corporate finance",
  "Customer success", "Cybersecurity", "Data engineering", "Data science", "Deep learning", "Design systems",
  "Embedded systems", "Fluid dynamics", "Frontend development", "Fundraising", "Genomics", "Grant writing",
  "Machine learning", "Product design", "Python programming", "Quantum computing", "Robotics software", "UX design",
].map((name, i) => ({ id: i + 1, name }));

const COURSES = [
  "BEng Aeronautical Engineering", "BEng Electrical Engineering", "BSc Mathematics", "MBA", "MEng Biomedical Engineering",
  "MEng Computing", "MSc Business Analytics", "MSc Climate Change, Management and Finance", "MSc Environmental Technology",
  "MSc Finance", "MSc Innovation and Entrepreneurship", "MSc Machine Learning", "MRes Bioengineering", "PhD Chemical Engineering",
];

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-caption text-text-muted">{children}</p>;
}

function useSet<T>(initial: T[] = []) {
  const [value, setValue] = useState<Set<T>>(() => new Set(initial));
  const toggle = (item: T) =>
    setValue((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item); else next.add(item);
      return next;
    });
  return [value, toggle, setValue] as const;
}

/** Search: the pill with a glass, and a clear button once there is something to clear. */
export function SearchDemo() {
  const [empty, setEmpty] = useState("");
  const [filled, setFilled] = useState("climate fintech seed");
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="grid content-start gap-2">
        <SearchField label="Search opportunities, empty" placeholder="Search by role, company, location or skill" value={empty} onChange={setEmpty} />
        <Caption>Empty. Type to see the clear button arrive.</Caption>
      </div>
      <div className="grid content-start gap-2">
        <SearchField label="Search opportunities, filled" placeholder="Search by role, company, location or skill" value={filled} onChange={setFilled} />
        <Caption>Filled. The clear button empties the box and keeps focus in it.</Caption>
      </div>
    </div>
  );
}

/** Choices that can be touched: a checkbox group with its "select all", radio cards, and a plain radio list. */
export function ChoiceDemo() {
  const [items, setItems] = useState({ events: true, jobs: false, grants: false });
  const [audience, setAudience] = useState("graduates");
  const [apply, setApply] = useState("email");
  const count = Object.values(items).filter(Boolean).length;
  const setAll = (on: boolean) => setItems({ events: on, jobs: on, grants: on });
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div className="grid content-start gap-5">
        <Checkbox label="Select all" indeterminate={count > 0 && count < 3} checked={count === 3} onChange={(e) => setAll(e.target.checked)} />
        <div className="grid gap-4 border-l border-border-subtle pl-6">
          <Checkbox label="Events" checked={items.events} onChange={(e) => setItems({ ...items, events: e.target.checked })} />
          <Checkbox label="Opportunities" hint="Roles posted by members and companies." checked={items.jobs} onChange={(e) => setItems({ ...items, jobs: e.target.checked })} />
          <Checkbox label="Grants and VCs" checked={items.grants} onChange={(e) => setItems({ ...items, grants: e.target.checked })} />
        </div>
        <Checkbox label="Show recruiters lines from my CV" hint="Needs a CV on your profile first." disabled />
        <Checkbox label="I'm 18 or over" defaultChecked disabled />
        <Caption>Checkbox: the native input redrawn. Its words are the target. The dash is the &ldquo;some of them&rdquo; state. The last two are disabled.</Caption>
      </div>
      <div className="grid content-start gap-7">
        <Field label="Who is this job for?" required group>
          <div className="grid gap-3 sm:grid-cols-3">
            {[["students", "Students"], ["graduates", "Graduates"], ["both", "Both"]].map(([value, label]) => (
              <Radio key={value} card name="demo-audience" value={value} label={label} checked={audience === value} onChange={() => setAudience(value)} />
            ))}
          </div>
        </Field>
        <FieldGroup legend="How should applicants apply?" description="A plain list for options that need a second line.">
          <Radio name="demo-apply" value="email" label="Contact me directly" checked={apply === "email"} onChange={() => setApply("email")} />
          <Radio name="demo-apply" value="link" label="Application portal link" hint="Applicants are sent to your careers page." checked={apply === "link"} onChange={() => setApply("link")} />
        </FieldGroup>
        <Caption>Radio: a ring with a small lit body. Arrow keys move between radios that share a name; the group is named by its legend. A short exclusive list reads best as cards.</Caption>
      </div>
    </div>
  );
}

/** Switches in every state the settings pages use. */
export function SwitchDemo() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(true);
  const [c, setC] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
      <div className="grid content-start gap-2">
        <Switch id="demo-sw-off" checked={a} busy={false} onChange={setA} label="Suggest me to members building their network" hint="Off: you stay out of those suggestions." />
        <Caption>Off, and live. Space toggles it.</Caption>
      </div>
      <div className="grid content-start gap-2">
        <Switch id="demo-sw-on" checked={b} busy={false} onChange={setB} label="Let recruiters find me" hint="On: the knob's ring lights and a lit body appears in it." />
        <Caption>On.</Caption>
      </div>
      <div className="grid content-start gap-2">
        <Switch id="demo-sw-disabled" checked={c} busy={false} disabled onChange={setC} label="Show recruiters lines from my CV" hint="Needs a CV on your profile first." />
        <Caption>Disabled: no fill, the quiet rule, a muted ring.</Caption>
      </div>
      <div className="grid content-start gap-2">
        <Switch
          id="demo-sw-busy"
          checked={busy}
          busy={busy}
          onChange={(next) => {
            setBusy(next);
            window.setTimeout(() => setBusy(false), 1800);
          }}
          label="Accept new connection requests"
          hint="Turn it on: the request is in flight for two seconds."
        />
        <Caption>Loading: the ring goes dotted and turns while the save is in flight.</Caption>
      </div>
    </div>
  );
}

/** Chips: a toggle, a lit value that removes itself, and a disabled one. */
export function ChipDemo() {
  const [on, toggle] = useSet<string>(["Fintech"]);
  const sectors = ["AI / ML", "Biotech / Health", "Climate / Energy", "Consumer", "Deeptech", "Defence", "Fintech"];
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="lm-label">Sectors</p>
        <div className="flex flex-wrap gap-2">
          {sectors.map((s) => (
            <Chip key={s} pressed={on.has(s)} onClick={() => toggle(s)}>
              {s}
            </Chip>
          ))}
          <Chip disabled>Space (soon)</Chip>
        </div>
        <Caption>Toggle chips are buttons with aria-pressed. Chosen is amber with a drawn tick, never colour alone. The last one is disabled.</Caption>
      </div>
      <div className="grid gap-2">
        <p className="lm-label">Chosen values</p>
        <div className="flex flex-wrap gap-2">
          <Chip lit removable size="sm" title="Remove MEng Computing">MEng Computing</Chip>
          <Chip lit removable size="sm" title="Remove MSc Finance">MSc Finance</Chip>
        </div>
        <Caption>A chosen value whose press removes it: lit, with a drawn cross. Small, for a row of tags.</Caption>
      </div>
    </div>
  );
}

/** A long set kept short: only what is chosen shows, a ring opens the rest. */
export function PickDemo() {
  const [skills, toggle] = useSet<number>([41, 27]);
  return (
    <div className="grid gap-2">
      <IdChipGroup label="Skills" hint="optional" items={SKILLS} selected={skills} onToggle={toggle} />
      <Caption>
        {SKILLS.length} skills here, about 170 in the product. Closed, only the chosen ones show and a ring opens the rest under a search box;
        open, the whole set scrolls inside a recessed panel. Escape closes it and returns to the ring.
      </Caption>
    </div>
  );
}

export function MultiSelectDemo() {
  const [courses, setCourses] = useState<Set<string>>(new Set(["MEng Computing"]));
  return (
    <div className="grid gap-2">
      <SearchableMultiSelect
        label="Course"
        options={COURSES}
        selected={courses}
        onChange={setCourses}
        placeholder="Filter by course: search or pick"
        emptyText="No course matches that search."
      />
      <Caption>A trigger in the field&apos;s face, a raised list with a search box, arrow keys through the options. The chosen values are lit chips below.</Caption>
    </div>
  );
}

/** The whole filter chrome, with local state instead of the URL. */
export function FilterDemo() {
  const [q, setQ] = useState("");
  const [roles, toggleRole, setRoles] = useSet<string>();
  const [skills, toggleSkill, setSkills] = useSet<string>(["Machine learning"]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const active = roles.size + skills.size + (from ? 1 : 0) + (to ? 1 : 0);
  const matching = Math.max(3, 48 - active * 9);
  return (
    <div>
      <SearchInput label="Search the demo directory" placeholder="Search by name, course, skill, sector, or what they're working on" value={q} onChange={setQ} />
      <FilterPanel
        activeCount={active}
        onClear={() => { setRoles(new Set()); setSkills(new Set()); setFrom(""); setTo(""); }}
        resultCount={<>{active ? `${matching} of 48` : "48"}<span className="sr-only"> members match</span></>}
      >
        <ChipGroup
          label="Role"
          options={[{ value: "student", label: "Students" }, { value: "alum", label: "Alumni" }]}
          selected={roles}
          onToggle={toggleRole}
        />
        <ChipGroup
          label="Skills"
          options={SKILLS.map((s) => ({ value: s.name, label: s.name }))}
          selected={skills}
          onToggle={toggleSkill}
        />
        <RangeFilter
          label="Graduation year"
          hint=" — range 2019–2028"
          type="number"
          bounds={{ min: 2019, max: 2028 }}
          from={from}
          to={to}
          fromLabel="Demo graduation year from"
          toLabel="Demo graduation year to"
          fromPlaceholder="From 2019"
          toPlaceholder="To 2028"
          onFromChange={setFrom}
          onToChange={setTo}
        />
      </FilterPanel>
    </div>
  );
}

/** A form as the product writes it: one card, titled groups, the fields, and the row that ends it. */
export function FormDemo() {
  const [useCustom, setUseCustom] = useState(false);
  const [custom, setCustom] = useState("");
  const [visible, setVisible] = useState(true);
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const missing = submitted && !description.trim();
  return (
    <FormSection
      as="form"
      title="Share a role with the network"
      headingAs="h4"
      description="Submissions go to the admin queue for review before they appear on the Opportunities tab."
      onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
      noValidate
    >
      <Field label="Role title" required>
        <Input type="text" defaultValue="Product designer, climate fintech" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Location type" required>
          <Select defaultValue="hybrid">
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="City / region" hint="Required">
            <Input type="text" defaultValue="London" />
          </Field>
        </div>
      </div>
      <Field label="Job description" required hint={`${description.length}/5000`} error={missing ? "Job description is required." : undefined}>
        <Textarea rows={4} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className="resize-none" />
      </Field>
      <ContactEmailSection
        signupEmail="demo@imperial.ac.uk"
        useCustomContact={useCustom}
        onUseCustomContactChange={setUseCustom}
        customContactEmail={custom}
        onCustomContactEmailChange={setCustom}
        contactEmailVisible={visible}
        onContactEmailVisibleChange={setVisible}
        description="We'll use the email you signed up with by default. Tick below to use a different inbox."
        visibleLabel="Make this contact email visible to community members on the listing."
        visibleHelp="If unchecked, applicants will have to reach out via LinkedIn or the application portal below."
      />
      <FormActions align="end">
        <Button type="button" variant="quiet" size="md">Cancel</Button>
        <Button type="submit" size="md">Submit for review</Button>
      </FormActions>
    </FormSection>
  );
}

/** The signup checkbox and the disclosure under it. */
export function DisclosureDemo() {
  const [agreed, setAgreed] = useState(false);
  return (
    <Panel tone="inset" className="p-6">
      <SignupDisclosures agreed={agreed} onChange={setAgreed} />
    </Panel>
  );
}
