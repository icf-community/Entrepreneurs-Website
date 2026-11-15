import type { Metadata } from "next";
import { PublicHeader } from "@/app/login/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Page } from "@/components/ui/Page";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { Timeline } from "@/components/ui/Timeline";
import { Icon } from "@/design-system/icons/Icon";

// Public landing page for IdeaForge, the society's pre-seed incubator. Its
// only job right now is to get people to the Tally application form, which is
// embedded at the bottom of the page. Tally handles the form's password
// protection itself, inside the iframe. Embedding relies on tally.so being in
// the CSP frame-src (src/lib/csp.ts).
//
// Drawn in Lumen like every other public page: the signed-out header (the brand and a
// way home), a Page frame with its column centred (there is no rail beside it), a
// PageHead, and Sections on the system's one rhythm. The words, the programme and the
// form are the page's own and are not touched here.
const TALLY_FORM_ID = "e5QW2l";
const FORM_URL = `https://tally.so/r/${TALLY_FORM_ID}`;
const EMBED_URL = `https://tally.so/embed/${TALLY_FORM_ID}?alignLeft=1&hideTitle=1`;

export const metadata: Metadata = {
  title: "IdeaForge",
  description:
    "IdeaForge is Imperial Entrepreneurs' student-led pre-seed incubator. Build a startup from scratch over one term, no experience required. Open applications start 1 December.",
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

export default function IdeaForgePage() {
  return (
    // No background of its own: the atmosphere is the night behind every page.
    <div className="flex min-h-screen flex-col">
      <PublicHeader>
        <ButtonLink href="/" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={16} />}>
          <span className="sr-only">← </span>Back to home
        </ButtonLink>
      </PublicHeader>

      <main id="main-content" tabIndex={-1} className="flex-1">
        <Page width="page" align="center">
          <PageHead
            context="Imperial Entrepreneurs"
            title="IdeaForge"
            lede="Our flagship, fully student-led pre-seed incubator. Build a startup from scratch over one term, with mentors, workshops and founder talks, then pitch to investors at Demo Day. No experience required."
          />

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href="#apply" size="md">
              Apply now
              <span className="sr-only"> ↓</span>
              <Icon name="arrow-down" size={16} />
            </ButtonLink>
            <p className="text-body font-medium text-text-primary">Open applications start 1 December.</p>
          </div>

          <div className="lm-sections mt-14">
            <Section title="Last cohort">
              <StatGrid min="sm">
                {STATS.map((s) => (
                  <Stat key={s.label} label={s.label} value={s.value} />
                ))}
              </StatGrid>
            </Section>

            <Section title="The programme">
              <Timeline items={TIMELINE} />
            </Section>

            <Section title="Streams">
              <ul className="flex flex-wrap gap-2">
                {STREAMS.map((s) => (
                  <li key={s}>
                    <Badge>{s}</Badge>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Who can apply">
              <p className="measure-prose text-body text-text-secondary">
                Imperial students, researchers and alumni. Whether you&apos;re a first-year with a crazy idea or a
                final-year with a business plan, we&apos;ll teach you what you need to know.
              </p>
            </Section>

            <Section id="apply" title="Apply" className="scroll-mt-8">
              {/* The Tally form is password-protected until open applications
                  start. The password is shared internally for fast-track
                  applications only, so it must never appear on this page. */}
              <p className="measure-prose text-body text-text-secondary">
                Open applications start 1 December. Until then the form is password-protected for fast-track applicants.
              </p>
              {/* The page's one lit panel, where the original site had an orange frame. Tally's form is a light page of its own, so the
                  frame sits on ink (the light ink) and the night stays round it. */}
              <Panel tone="lit" className="p-2 sm:p-3">
                <iframe
                  src={EMBED_URL}
                  title="IdeaForge application form"
                  loading="lazy"
                  className="block h-[720px] w-full rounded-lg bg-ink"
                />
              </Panel>
              <p className="text-caption text-text-muted">
                Form not loading?{" "}
                <a
                  href={FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-secondary underline underline-offset-2 hover:text-text-primary"
                >
                  Open it in a new tab
                </a>
                .
              </p>
            </Section>
          </div>
        </Page>
      </main>

      <PublicFooter />
    </div>
  );
}
