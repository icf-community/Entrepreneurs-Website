import type { Metadata } from "next";

// Public landing page for IdeaForge, the society's pre-seed incubator. Its
// only job right now is to get people to the Tally application form, which is
// embedded at the bottom of the page. Tally handles the form's password
// protection itself, inside the iframe. Embedding relies on tally.so being in
// the CSP frame-src (src/lib/csp.ts).
const TALLY_FORM_ID = "e5QW2l";
const FORM_URL = `https://tally.so/r/${TALLY_FORM_ID}`;
const EMBED_URL = `https://tally.so/embed/${TALLY_FORM_ID}?alignLeft=1&hideTitle=1`;

export const metadata: Metadata = {
  title: "IdeaForge",
  description:
    "IdeaForge is Imperial Entrepreneurs' student-led pre-seed incubator. Build a startup from scratch over one term, no experience required.",
};

const STATS = [
  { value: "300+", label: "applicants" },
  { value: "20", label: "teams selected" },
  { value: "62%", label: "building in AI or HealthTech" },
];

const TIMELINE = [
  {
    when: "January",
    title: "Launch & foundation",
    body: "Mentor pairing, workshops on product development, customer discovery and sales, and fireside chats with founders.",
  },
  {
    when: "February",
    title: "Growth & refinement",
    body: "Marketing, pitching masterclasses and fundraising sessions with VCs. Semi-final presentations at the end of the month.",
  },
  {
    when: "March",
    title: "Launch preparation",
    body: "Office hours with VCs and founders, final product sprints and go-to-market strategy.",
  },
  {
    when: "Late March",
    title: "Demo Day",
    body: "Teams pitch their MVPs to an investor panel.",
  },
];

const STREAMS = ["AI", "ClimateTech", "HealthTech", "FinTech", "Consumer", "Robotics"];

function ApplyCta() {
  return (
    <a
      href="#apply"
      className="inline-flex items-center px-5 py-2.5 rounded-lg bg-accent text-bg-primary text-[0.9rem] font-medium no-underline transition-colors hover:bg-accent-light"
    >
      Apply now ↓
    </a>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="label-wide text-text-secondary mb-5">{label}</h2>
      {children}
    </section>
  );
}

export default function IdeaForgePage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-6 sm:px-8 py-16">
      <div className="max-w-[640px] mx-auto">
        <div className="mb-10 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Imperial Entrepreneurs</p>
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-tight">IdeaForge</h1>
          <p className="text-[0.95rem] text-text-secondary mt-4 leading-relaxed">
            Our flagship, fully student-led pre-seed incubator. Build a startup from scratch over one term, with
            mentors, workshops and founder talks, then pitch to investors at Demo Day. No experience required.
          </p>
        </div>

        <ApplyCta />

        <Section label="Last cohort">
          <dl className="grid grid-cols-3 items-start gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col-reverse">
                <dt className="text-[0.8rem] text-text-muted mt-2 leading-snug">{s.label}</dt>
                <dd className="font-display text-[clamp(1.5rem,3vw,2rem)] leading-none text-text-primary">{s.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section label="The programme">
          <ol className="space-y-6">
            {TIMELINE.map((t) => (
              <li key={t.when} className="border-l border-border-subtle pl-5">
                <p className="text-[0.75rem] text-text-muted uppercase tracking-wide">{t.when}</p>
                <h3 className="text-[1rem] text-text-primary font-medium mt-1">{t.title}</h3>
                <p className="text-[0.875rem] text-text-secondary mt-1 leading-relaxed">{t.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section label="Streams">
          <ul className="flex flex-wrap gap-2">
            {STREAMS.map((s) => (
              <li key={s} className="px-3 py-1 rounded-lg border border-border-subtle text-[0.85rem] text-text-secondary">
                {s}
              </li>
            ))}
          </ul>
        </Section>

        <Section label="Who can apply">
          <p className="text-[0.875rem] text-text-secondary leading-relaxed">
            Imperial students, researchers and alumni. Whether you&apos;re a first-year with a crazy idea or a
            final-year with a business plan, we&apos;ll teach you what you need to know.
          </p>
        </Section>

        {/* The orange is the IdeaForge brand colour from the original site. */}
        <section id="apply" className="mt-14 scroll-mt-8">
          <h2 className="label-wide text-text-secondary mb-5">Apply</h2>
          <div className="rounded-xl bg-[#ff4400] p-2 sm:p-3">
            <iframe
              src={EMBED_URL}
              title="IdeaForge application form"
              loading="lazy"
              className="block h-[720px] w-full rounded-lg bg-white"
            />
          </div>
          <p className="mt-3 text-[0.8rem] text-text-muted">
            Form not loading?{" "}
            <a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="text-text-secondary underline underline-offset-2">
              Open it in a new tab
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
