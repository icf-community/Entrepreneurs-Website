import type { Metadata } from "next";

// Public landing page for IdeaForge, the society's pre-seed incubator. Its
// only job right now is to send people to the Tally application form.
// Linked out rather than embedded so the CSP needs no frame-src change.
// Set this to the Tally form URL when applications open; until then the page
// shows the opening date instead of the button.
const APPLY_URL: string | null = null;

export const metadata: Metadata = {
  title: "IdeaForge",
  description:
    "IdeaForge is Imperial Entrepreneurs' student-led pre-seed incubator. Build a startup from scratch over one term, no experience required. Applications open 1 December.",
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
  return APPLY_URL ? (
    <a
      href={APPLY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center px-5 py-2.5 rounded-lg bg-accent text-bg-primary text-[0.9rem] font-medium no-underline transition-colors hover:bg-accent-light"
    >
      Apply now →
    </a>
  ) : (
    <p className="text-[0.9rem] text-text-primary font-medium">Applications open 1 December.</p>
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

        <div className="mt-14 pt-8 border-t border-border-subtle">
          <ApplyCta />
        </div>
      </div>
    </main>
  );
}
