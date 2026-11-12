import Link from "next/link";
import { SectionHead } from "@/components/SectionHead";

/* ── Data ─────────────────────────────────────────────────────────── */
const STEPS = [
  {
    step: "01",
    title: "Identity",
    desc: "Name, Imperial email, and your role in the ecosystem.",
  },
  {
    step: "02",
    title: "Your work",
    desc: "A one-line bio, skills, sector focus, and what you're looking for.",
  },
  {
    step: "03",
    title: "Visibility",
    desc: "Choose what you're open to — intros, work opportunities, co-founder conversations.",
  },
];

const ROLE_OPTIONS = [
  "Current student", "Recent grad", "Alumni founder", "Mentor", "Angel investor",
];

/* ── Sub-components ───────────────────────────────────────────────── */

// The three numbers survive because the signup really is ordered and the
// reader needs to know there are three of them. What went is the treatment:
// a gold-ringed circle per step with a dotted vertical connector threaded
// behind it. A number in the reference column of a ruled row says the same
// thing without the costume.
function Step({ step, title, desc }: typeof STEPS[number]) {
  return (
    <div className="grid grid-cols-[2.5rem_1fr] gap-x-5 border-b border-border-subtle py-4 last:border-b-0">
      <span className="data text-[0.8rem] text-text-muted">{step}</span>
      <div>
        <div className="text-[0.9rem] font-medium text-text-primary">{title}</div>
        <p className="mt-1 text-[0.825rem] leading-relaxed text-text-secondary">{desc}</p>
      </div>
    </div>
  );
}

// A field in the mocked form. The real form's inputs are boxes; drawing boxes
// inside this panel would nest a card in a card, so the mock states each field
// on a rule instead — which is also how a spec sheet shows a blank to fill.
function MockField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="label-wide mb-2 text-text-muted">{label}</p>
      <p className="border-b border-border-strong pb-2 text-[0.85rem] text-text-secondary">{value}</p>
      {hint && <p className="mt-2 text-[0.7rem] leading-relaxed text-text-muted">{hint}</p>}
    </div>
  );
}

/* Mocked form preview — mirrors the actual signup form's structure */
function FormPreview() {
  return (
    <div className="border border-border bg-bg-secondary">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-4">
        <span className="label-wide text-text-primary">Member profile signup</span>
        <span className="data text-[0.72rem] text-text-muted">Step 1 / 3</span>
      </div>

      {/* Progress as a segmented rule: three equal spans, the first filled.
          The old version had both a filled progress bar and a row of three
          dots underneath, saying the same thing twice. */}
      <div className="grid grid-cols-3 gap-px bg-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i === 0 ? "h-0.5 bg-accent" : "h-0.5 bg-bg-secondary"} />
        ))}
      </div>

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-5">
          <MockField label="First name" value="John" />
          <MockField label="Last name" value="Doe" />
        </div>

        <MockField
          label="Imperial email"
          value="username@imperial.ac.uk"
          hint="Students: @imperial.ac.uk or @ic.ac.uk. Alumni: sign in with Google, admin-verified before access."
        />

        <div>
          <p className="label-wide mb-2 text-text-muted">I am a…</p>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_OPTIONS.map((r) => (
              <span
                key={r}
                className={
                  r === "Current student"
                    ? "rounded-lg border border-accent bg-accent px-3 py-1 text-[0.75rem] font-medium text-bg-primary"
                    : "rounded-lg border border-border px-3 py-1 text-[0.75rem] text-text-muted"
                }
              >
                {r}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t border-border-subtle pt-5">
          <span className="rounded-lg border border-border px-4 py-1.5 text-[0.775rem] font-semibold text-text-muted">
            Continue →
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Section ──────────────────────────────────────────────────────── */
export default function Apply() {
  return (
    <section id="apply" className="px-8 py-24 pb-32">
      <div className="mx-auto max-w-[1200px]">
      {/* Treatment 5 of 5: a heavy pair, then the tail dropped all the way to
          the field-label register. The shortest line gets the smallest type,
          which is the opposite of what a headline usually does — and the
          reason it lands. */}
      <SectionHead label="Apply">
        <h2 className="text-[clamp(2rem,3.6vw,3.1rem)] leading-[1.06] tracking-[-0.035em] text-text-primary">
          <span className="block font-semibold">Join Foundry in</span>
          <span className="block font-semibold">a few minutes.</span>
          <span className="label-wide mt-4 block text-text-secondary">That&apos;s it.</span>
        </h2>
      </SectionHead>

      <div className="grid grid-cols-1 items-start gap-x-16 gap-y-14 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="mb-9 max-w-[54ch] text-[0.95rem] leading-[1.75] text-text-secondary">
            Current students get in instantly with an Imperial email. Alumni sign in
            with Google and are admitted after a quick admin check. Then build your
            profile and start meeting people.
          </p>

          <div className="mb-10 border-t border-border-subtle">
            {STEPS.map((s) => <Step key={s.step} {...s} />)}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-7 py-3.5 text-[0.9rem] font-semibold text-bg-primary no-underline transition-colors duration-150 hover:bg-accent-dim"
            >
              Join Foundry →
            </Link>
            <span className="text-[0.8rem] text-text-muted">
              Free · Imperial students &amp; verified alumni
            </span>
          </div>
        </div>

        <FormPreview />
      </div>
      </div>
    </section>
  );
}
