import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { LegalDocument, LegalSection as Section } from "../privacy/LegalDocument";

// Cookie Policy — PECR / UK GDPR. Foundry sets strictly-necessary cookies
// only (Supabase auth session, password-recovery marker, Cloudflare
// security) and runs PostHog analytics cookielessly (persistence: memory),
// so no consent banner is required. Tables reflect the cookies and browser
// storage keys actually set (Sidebar, SiteBanner, useIntakeDraft, analytics/track).

export const metadata = {
  title: "Cookie Policy · Foundry",
};

const LAST_UPDATED = "12 November 2026";

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

// PECR covers any storage on your device, not just cookies.
const STORAGE: Cookie[] = [
  {
    name: "foundry:intake:draft:…",
    provider: "Foundry",
    purpose: "Saves the answers you have typed into the post-approval intake so you don't lose them if you leave the page. Holds what you typed, on this device only.",
    duration: "Until you finish the intake",
  },
  {
    name: "foundry.nav.collapsed",
    provider: "Foundry",
    purpose: "Remembers whether you collapsed the side menu.",
    duration: "Until you clear your browser storage",
  },
  {
    name: "foundry:banner-dismissed",
    provider: "Foundry",
    purpose: "Remembers that you closed a site notice, so it isn't shown again.",
    duration: "Until you clear your browser storage",
  },
  {
    name: "foundry-analytics-off",
    provider: "Foundry",
    purpose: "Remembers that you turned analytics off in Settings.",
    duration: "Until you turn analytics back on",
  },
];

export default function CookiesPage() {
  return (
    <LegalDocument back={{ href: "/login", label: "Back" }} kicker="Legal" title="Cookie Policy" updated={LAST_UPDATED}>
          <Section title="1. The short version">
            <p>
              Foundry is operated under the name &ldquo;Imperial Entrepreneurs&rdquo; by <strong>IC Founders Ltd</strong>,
              a company limited by guarantee registered in England and Wales (company number <strong>17171277</strong>),
              registered office 71–75 Shelton Street, Covent Garden, London, WC2H 9JQ (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
            </p>
            <p className="mt-2">
              Foundry uses only <strong>strictly necessary</strong> cookies — the ones required to sign you in and
              keep the site secure — plus a few items in your browser&rsquo;s storage that remember things you did
              on the site, and our product analytics run <strong>without cookies</strong>. Because we set no
              advertising, marketing, or non-essential tracking cookies, UK law (PECR) does not require us to ask for
              your consent or show a cookie banner.
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
            <CookieTable label="The cookies we set" nameHead="Cookie" rows={COOKIES} />
            <p className="mt-3 text-body text-text-muted">
              All of these are classed as strictly necessary: they are needed to provide the service you have
              asked for (signing in) or to keep it secure.
            </p>
          </Section>

          <Section title="3a. What we keep in your browser&rsquo;s storage">
            <CookieTable label="What we keep in your browser's storage" nameHead="Key" rows={STORAGE} />
            <p className="mt-3 text-body text-text-muted">
              Each of these is there because you did something on the site, and none is sent to us or to anyone
              else. If you use a shared computer, finish the intake, or clear the browser&rsquo;s site data, so your
              draft answers are not left behind.
            </p>
          </Section>

          <Section title="4. Analytics without cookies">
            <p>
              We use PostHog to understand which pages and features are used so we can improve Foundry. We have
              configured it to run <strong>cookielessly</strong> — it keeps no cookie and no device identifier on
              your browser, and events are tied to a pseudonymous account ID rather than your name or email. We do
              not use session recording, autocapture of form contents, or any advertising analytics. You can turn
              analytics off at any time in <strong>Settings → Usage analytics</strong>; that choice applies to the
              device you make it on.
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
    </LegalDocument>
  );
}

// Both tables of the policy are this one: the system's Table, a named focusable region (so a keyboard can pan it where it is wider than the
// screen), which below 640 px of its own width stacks into one card per row with every cell captioned by its column. The names are set in the
// body face, not a monospace: Lumen has none.
function CookieTable({ label, nameHead, rows }: { label: string; nameHead: string; rows: Cookie[] }) {
  return (
    <div className="mt-2">
      <Table label={label}>
        <THead>
          <TR>
            <TH>{nameHead}</TH>
            <TH>Set by</TH>
            <TH>Purpose</TH>
            <TH>Duration</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((c) => (
            <TR key={c.name}>
              <TD label={nameHead} primary nowrap>{c.name}</TD>
              <TD label="Set by" nowrap>{c.provider}</TD>
              <TD label="Purpose">{c.purpose}</TD>
              <TD label="Duration">{c.duration}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
