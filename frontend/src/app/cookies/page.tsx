import Link from "next/link";

// Cookie Policy — PECR / UK GDPR. Foundry sets strictly-necessary cookies
// only (Supabase auth session, password-recovery marker, Cloudflare
// security) and runs PostHog analytics cookielessly (persistence: memory),
// so no consent banner is required. Table reflects the cookies actually set.

export const metadata = {
  title: "Cookie Policy · Foundry",
};

const LAST_UPDATED = "29 August 2026";

type Cookie = { name: string; provider: string; purpose: string; duration: string };

const COOKIES: Cookie[] = [
  {
    name: "sb-…-auth-token",
    provider: "Supabase",
    purpose: "Keeps you signed in by storing your authenticated session. Without it you cannot stay logged in.",
    duration: "Session / until sign-out or expiry",
  },
  {
    name: "pw-recovery",
    provider: "Foundry",
    purpose: "A short-lived marker set only during the password-reset flow so the reset page knows you arrived from a valid recovery link.",
    duration: "A few minutes; cleared after reset",
  },
  {
    name: "__cf_bm",
    provider: "Cloudflare",
    purpose: "Tells humans from bots to protect the site from automated abuse.",
    duration: "About 30 minutes",
  },
  {
    name: "cf_clearance / cf_chl_*",
    provider: "Cloudflare Turnstile",
    purpose: "Records that you passed the anti-bot challenge when submitting a form, so you are not re-challenged.",
    duration: "Transient / short-lived",
  },
];

export default function CookiesPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-16">
      <div className="max-w-[720px] mx-auto">
        <Link href="/login" className="text-[0.8rem] text-text-muted no-underline hover:text-text-secondary transition-colors">
          ← Back
        </Link>
        <div className="mt-6 mb-10 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Legal</p>
          <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
            Cookie Policy
          </h1>
          <p className="text-[0.825rem] text-text-muted mt-3">
            Last updated: {LAST_UPDATED}.
          </p>
        </div>

        <article className="space-y-6 text-[0.875rem] text-text-secondary leading-relaxed [overflow-wrap:anywhere]">
          <Section title="1. The short version">
            <p>
              Foundry is operated under the name &ldquo;Imperial Entrepreneurs&rdquo; by <strong>IC Founders Ltd</strong>,
              a company limited by guarantee registered in England and Wales (company number <strong>17171277</strong>),
              registered office 71–75 Shelton Street, Covent Garden, London, WC2H 9JQ (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
            </p>
            <p className="mt-2">
              Foundry uses only <strong>strictly necessary</strong> cookies — the ones required to sign you in and
              keep the site secure — and our product analytics run <strong>without cookies</strong>. Because we set
              no advertising, marketing, or non-essential tracking cookies, UK law (PECR) does not require us to ask
              for your consent or show a cookie banner.
            </p>
          </Section>

          <Section title="2. What cookies are">
            <p>
              Cookies are small text files a website stores on your device. Some are essential for a site to
              function (for example, to remember that you are logged in); others are used for analytics or
              advertising. We use only the essential kind.
            </p>
          </Section>

          <Section title="3. The cookies we set">
            {/* Focusable so a keyboard user can scroll the table sideways on a
                phone (axe scrollable-region-focusable, D4). */}
            <div tabIndex={0} role="region" aria-label="The cookies we set" className="overflow-x-auto mt-2 rounded-xl border border-border-subtle">
              <table className="w-full text-left text-[0.8rem] border-collapse">
                <thead>
                  <tr className="bg-bg-card text-text-primary">
                    <th className="px-3 py-2 font-medium border-b border-border-subtle">Cookie</th>
                    <th className="px-3 py-2 font-medium border-b border-border-subtle">Set by</th>
                    <th className="px-3 py-2 font-medium border-b border-border-subtle">Purpose</th>
                    <th className="px-3 py-2 font-medium border-b border-border-subtle">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {COOKIES.map((c) => (
                    <tr key={c.name} className="align-top">
                      <td className="px-3 py-2 border-b border-border-subtle font-mono text-[0.75rem] text-text-primary whitespace-nowrap">{c.name}</td>
                      <td className="px-3 py-2 border-b border-border-subtle whitespace-nowrap">{c.provider}</td>
                      <td className="px-3 py-2 border-b border-border-subtle">{c.purpose}</td>
                      <td className="px-3 py-2 border-b border-border-subtle">{c.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[0.8rem] text-text-muted">
              All of these are classed as strictly necessary: they are needed to provide the service you have
              asked for (signing in) or to keep it secure.
            </p>
          </Section>

          <Section title="4. Analytics without cookies">
            <p>
              We use PostHog to understand which pages and features are used so we can improve Foundry. We have
              configured it to run <strong>cookielessly</strong> — it keeps no cookie and no device identifier on
              your browser, and events are tied only to a pseudonymous account ID. We do not use session recording,
              autocapture of form contents, or any advertising analytics.
            </p>
          </Section>

          <Section title="5. What we do not use">
            <p>
              We do not use advertising cookies, marketing or retargeting pixels, social-media tracking cookies, or
              any third-party profiling. We do not sell or share your browsing data.
            </p>
          </Section>

          <Section title="6. Managing cookies">
            <p>
              You can block or delete cookies through your browser settings. Please note that blocking the
              essential cookies above will prevent you from signing in and using Foundry, because they are required
              for the service to work.
            </p>
          </Section>

          <Section title="7. Changes and contact">
            <p>
              We may update this policy if our use of cookies changes. For questions, contact{" "}
              <strong>contact@imperialentrepreneurs.com</strong>. See also our{" "}
              <Link href="/privacy" className="text-accent underline underline-offset-[3px] hover:text-accent-light">Privacy Policy</Link>.
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
      <h2 className="text-[1.05rem] text-text-primary font-medium tracking-tight mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
