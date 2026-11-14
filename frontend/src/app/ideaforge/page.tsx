import type { Metadata } from "next";

// Public landing page for IdeaForge, the society's pre-seed incubator. Its
// only job right now is to send people to the Tally application form.
// Linked out rather than embedded so the CSP needs no frame-src change.
const APPLY_URL = "https://tally.so/r/xXXeW5";

export const metadata: Metadata = {
  title: "IdeaForge",
  description: "IdeaForge is Imperial Entrepreneurs' pre-seed incubator. Apply to join the next cohort.",
};

export default function IdeaForgePage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-6 sm:px-8 py-16">
      <div className="max-w-[640px] mx-auto">
        <div className="mb-10 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Imperial Entrepreneurs</p>
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-tight">IdeaForge</h1>
          <p className="text-[0.95rem] text-text-secondary mt-4 leading-relaxed">
            Our pre-seed incubator. Build your startup alongside other Imperial founders and pitch to investors at
            the end of the programme.
          </p>
        </div>

        <a
          href={APPLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-5 py-2.5 rounded-lg bg-accent text-bg-primary text-[0.9rem] font-medium no-underline transition-colors hover:bg-accent-light"
        >
          Apply now →
        </a>
      </div>
    </main>
  );
}
