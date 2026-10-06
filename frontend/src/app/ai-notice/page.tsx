import Link from "next/link";

// ════════════════════════════════════════════════════════════════════
// How Foundry AI search works (AI-plan §12, §13). Every AI screen links
// here for the detail, so the screens themselves can stay at one sentence
// (F22).
//
// FACTUAL DRAFT FOR OWNER REVIEW. This describes what the code does; it is
// not legal copy. The controller reviews the wording, the processor
// section and the lawful-basis framing before any AI flag is switched on
// in production (docs/owner-decisions.md, A0.2).
// ════════════════════════════════════════════════════════════════════

export const metadata = {
  title: "How AI search works · Foundry",
};

const LAST_UPDATED = "6 October 2026";

export default function AiNoticePage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-6 sm:px-8 py-16">
      <div className="max-w-[720px] mx-auto">
        <Link href="/foundry-ai" className="text-[0.8rem] text-text-muted no-underline hover:text-text-secondary transition-colors">
          ← Foundry AI
        </Link>
        <div className="mt-6 mb-10 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Foundry AI</p>
          <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">How AI search works</h1>
          <p className="text-[0.825rem] text-text-muted mt-3">Last updated: {LAST_UPDATED}.</p>
        </div>

        <article className="space-y-8 text-[0.875rem] text-text-secondary leading-relaxed [overflow-wrap:anywhere]">
          <Section title="What it does">
            <p>Foundry AI runs three searches:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong className="text-text-primary">Find candidates</strong>: for a job you posted, it suggests members whose profiles show what the job needs.</li>
              <li><strong className="text-text-primary">Build your network</strong>: it suggests members who share your interests or can help with what you need.</li>
              <li><strong className="text-text-primary">Find opportunities</strong>: it suggests open jobs that match your own profile.</li>
            </ul>
            <p className="mt-2">It only suggests. It never contacts anyone, applies for anything or rejects anyone.</p>
          </Section>

          <Section title="Who can find you">
            <p>
              Nobody, unless you choose. In <Link href="/settings#ai" className="underline">Settings</Link> there are three separate
              choices, all off until you turn them on: letting recruiters find you, being suggested to members building their
              network, and letting recruiters see up to two short lines from your CV. Turning one off removes you from that
              search straight away; someone who already has results on screen may still see them until they reload.
            </p>
            <p className="mt-2">Your own job matches use your profile whether or not you choose to be found.</p>
          </Section>

          <Section title="What it uses">
            <ul className="list-disc space-y-1 pl-5">
              <li>The skills, sectors and course on your profile, and what you say you&apos;re working on.</li>
              <li>Your interests and hobbies, for network suggestions only.</li>
              <li>What you say you can help with or want help with, if you add them.</li>
              <li>Your CV&apos;s skills, projects and roles, if you uploaded one and agreed to CV processing.</li>
              <li>The GitHub languages and projects you chose to show, if you connected GitHub.</li>
            </ul>
            <p className="mt-2">
              It never uses your name, email, photo, links or contact details to match, and never your age, gender,
              ethnicity, nationality, religion, health, disability, sexuality or politics. It does not use who you are
              connected to, or how often anyone has viewed you.
            </p>
            <p className="mt-2">
              You can see exactly what it uses in <Link href="/settings#ai" className="underline">Settings</Link>, under
              &ldquo;See exactly what AI search uses&rdquo;.
            </p>
          </Section>

          <Section title="What the number means">
            <p>
              Each result shows an evidence match out of 100: how much of what was asked for the profile clearly shows. It is
              not a rating of the person, their ability or their chances. Something missing from a profile isn&apos;t the
              same as someone lacking it, so results also say which must-haves are shown, related, unclear or not shown,
              and anyone who doesn&apos;t show a must-have is listed separately rather than ranked as meeting it.
            </p>
          </Section>

          <Section title="Where processing happens">
            <p>
              Matching runs on Foundry&apos;s own servers. To read a search and check evidence, short extracts are sent to
              OpenAI with names, contact details and links removed first, and with storage turned off on each request.
              We set daily spending and usage limits, so AI search can pause for the rest of a day.
            </p>
          </Section>

          <Section title="How long it's kept">
            <ul className="list-disc space-y-1 pl-5">
              <li>Your AI chats, criteria and results: 7 days from each message, then deleted.</li>
              <li>Saved candidate matches: 7 days from the search.</li>
              <li>Cached evidence checks: up to 30 days, and gone as soon as the profile changes or the choice is turned off.</li>
            </ul>
            <p className="mt-2">
              You can delete one chat, one message, or all your AI history at any time from the Foundry AI page. Deleting your
              account deletes all of it.
            </p>
          </Section>

          <Section title="Questions or a bad result">
            <p>
              If a suggestion looks wrong, or you want to know more about how you were matched, <Link href="/contact" className="underline">contact the team</Link>.
              A person will look at it.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-[1.15rem] text-text-primary tracking-tight mb-2">{title}</h2>
      {children}
    </section>
  );
}
