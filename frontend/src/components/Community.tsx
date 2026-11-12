"use client";

import { SectionHead } from "@/components/SectionHead";

/* ── Data ─────────────────────────────────────────────────────────── */
const SKILLS = [
  "Machine learning", "Full-stack dev", "Bioengineering", "Product",
  "Hardware", "Finance / VC", "Design", "Sales / GTM",
  "Regulatory", "Clinical research", "Deep tech", "Climate / Energy",
];

const SECTORS = [
  "Biotech / Health", "Climate / Energy", "AI / ML",
  "Deeptech", "Fintech", "Consumer", "Defence",
];

const ACTIVE_SKILLS  = new Set(["Machine learning", "Bioengineering", "Hardware"]);
const ACTIVE_SECTORS = new Set(["Biotech / Health", "AI / ML"]);

const PROFILES = [
  {
    initials: "SA", name: "Sofia A.",  role: "Current student",
    bio: "Building sensor fusion for surgical robotics",
    skills: ["Hardware", "Machine learning"], looking: "Co-founder",
  },
  {
    initials: "JK", name: "James K.",  role: "Alumni founder",
    bio: "Ex-McKinsey → founded a climate fintech, raised seed",
    skills: ["Finance / VC", "Product"], looking: "Funding",
  },
  {
    initials: "ML", name: "Maria L.",  role: "Mentor",
    bio: "Director of Product @ scale-up, 10 yrs in healthtech",
    skills: ["Product", "Clinical research"], looking: "Just here to help",
  },
  {
    initials: "RP", name: "Rishi P.",  role: "Recent grad",
    bio: "Full-stack dev, building a dev tool for clinical trials",
    skills: ["Full-stack dev", "Regulatory"], looking: "Beta users",
  },
];

/* ── Sub-components ───────────────────────────────────────────────── */
function Chip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center whitespace-nowrap rounded-lg border border-accent bg-accent px-3 py-1 text-[0.775rem] font-medium text-bg-primary"
          : "inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 py-1 text-[0.775rem] text-text-secondary"
      }
    >
      {label}
    </span>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-strong text-[0.75rem] font-semibold text-text-primary">
      {initials}
    </div>
  );
}

// A cell in the directory table, not a floating card. The hairline between
// cells is the grid's own `gap-px` showing through, so four of these read as
// one ruled sheet rather than four identical boxes with their own borders.
function ProfileCell({ initials, name, role, bio, skills, looking }: typeof PROFILES[0]) {
  return (
    <div className="bg-bg-secondary p-6 transition-colors duration-150 hover:bg-bg-card-hover">
      <div className="mb-4 flex items-center gap-3">
        <Avatar initials={initials} />
        <div className="min-w-0">
          <div className="text-[0.9rem] font-medium text-text-primary">{name}</div>
          <div className="text-[0.775rem] text-text-muted">{role}</div>
        </div>
      </div>

      <p className="mb-4 text-[0.825rem] leading-relaxed text-text-secondary">{bio}</p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {skills.map((s) => <Chip key={s} label={s} />)}
      </div>

      <div className="flex items-baseline gap-2 border-t border-border-subtle pt-3">
        <span className="label-wide text-text-muted">Looking for</span>
        <span className="text-[0.8rem] text-text-primary">{looking}</span>
      </div>
    </div>
  );
}

/* ── Section ──────────────────────────────────────────────────────── */
export default function Community() {
  return (
    <section id="community" className="border-y border-border-subtle bg-bg-secondary px-8 py-24">
      <div className="mx-auto max-w-[1200px]">
        {/* Treatment 2 of 5: scale contrast. The second line is the same
            weight, set much larger — the emphasis is in the size step, not
            in a colour or an italic. */}
        <SectionHead label="Community">
          <h2 className="leading-[0.98] tracking-[-0.035em] text-text-primary">
            <span className="block text-[clamp(1.4rem,2.2vw,1.9rem)] font-normal text-text-secondary">
              Build your profile.
            </span>
            <span className="block text-[clamp(2.4rem,4.4vw,3.8rem)] font-semibold">
              Get found.
            </span>
          </h2>
        </SectionHead>

        <div className="grid grid-cols-1 items-start gap-x-16 gap-y-14 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="mb-9 max-w-[52ch] text-[0.9rem] leading-[1.75] text-text-secondary">
              Your profile shows what you&apos;re building, what you&apos;re good at, and what
              you&apos;re looking for — skills, sectors, and intent. Smart matching surfaces
              the right people at the right time.
            </p>

            <div className="mb-7">
              <p className="label-wide mb-3 text-text-muted">Skills · pick up to 5</p>
              <div className="flex flex-wrap gap-1.5">
                {SKILLS.map((s) => <Chip key={s} label={s} active={ACTIVE_SKILLS.has(s)} />)}
              </div>
            </div>

            <div>
              <p className="label-wide mb-3 text-text-muted">Sector focus · pick up to 2</p>
              <div className="flex flex-wrap gap-1.5">
                {SECTORS.map((s) => <Chip key={s} label={s} active={ACTIVE_SECTORS.has(s)} />)}
              </div>
            </div>
          </div>

          {/* Placeholders, not real members (PRODUCT.md): labelled so the
              homepage never reads as showing who is in the directory. */}
          <div>
            <p className="label-wide mb-3 text-text-muted">Example profiles</p>
            <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2">
              {PROFILES.map((p) => <ProfileCell key={p.name} {...p} />)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
