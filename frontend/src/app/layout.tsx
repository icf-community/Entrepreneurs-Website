import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { SITE_URL, SITE_NAME } from "@/lib/structuredData";

// Canonical host: the apex 307-redirects to www, so www is the indexable origin.


// One grotesque for the whole app. The wordmark builds its hierarchy from
// weight and tracking inside a single family, so a second display face would
// be arguing with the logo rather than extending it. Archivo is variable, so
// every step from 400 to 700 costs the same single file.
const archivo = Archivo({
  subsets: ["latin"],
  // Archivo is variable on BOTH weight and width, and the width axis is the
  // point. The wordmark is a condensed grotesque; at the default width this
  // family is a competent neutral sans and looks like every other one. Pulling
  // `wdth` down to ~80 on display sizes is what makes a heading read as
  // belonging to that lockup rather than merely sharing a page with it.
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

// Measured values only — dates, counts, money, IDs. Two weights is the whole
// range this needs; it never sets a heading or a paragraph.
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Imperial Entrepreneurs — Foundry | Imperial College Startup Community",
    // Child pages set their own title; this appends the brand for the SERP.
    template: "%s | Imperial Entrepreneurs",
  },
  description:
    "Imperial Entrepreneurs is the founder community at Imperial College London — connect with student founders, alumni, mentors, and investors through Foundry.",
  applicationName: SITE_NAME,
  keywords: ["Imperial Entrepreneurs", "Imperial College", "Foundry", "student founders", "startup community", "Imperial startups"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Imperial Entrepreneurs — Foundry",
    description:
      "The founder community at Imperial College London. Connect with student founders, alumni, mentors, and investors through Foundry.",
    url: SITE_URL,
    locale: "en_GB",
    // Dedicated 1200x630 export. This file is served RAW to every scraper —
    // next/image never touches it — so it is sized and compressed for the
    // wire. The full-resolution artwork would be ~1.5 MB, which several
    // scrapers (WhatsApp, iMessage) skip outright, losing the preview.
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Imperial Entrepreneurs" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Imperial Entrepreneurs — Foundry",
    description: "The founder community at Imperial College London.",
    images: ["/og-image.png"],
  },
};

// Matches --color-bg-primary so mobile browser chrome blends into the page
// instead of framing it in white.
export const viewport: Viewport = {
  themeColor: "#08080a",
};

// Origins the app opens a connection to on nearly every page. Warming the
// TCP+TLS handshake here saves a round trip on the first request to each.
// Derived from the same env as the CSP (see lib/csp.ts) so they can't drift.
const PRECONNECT_ORIGINS = [
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "https://challenges.cloudflare.com" : undefined,
]
  .map((value) => {
    if (!value) return null;
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  })
  .filter((origin): origin is string => origin !== null);


// `export const dynamic = "force-dynamic"` used to sit here, and the
// `await headers()` below used to read the nonce for the JSON-LD tag.
// Both are gone (C2 Finding 6, 2026-09-08), and removing the headers()
// call is the half that actually mattered: reading a dynamic API in the
// ROOT layout opts every route in the application out of static
// rendering, whether or not force-dynamic is also present. That is why
// /privacy — a static legal page reading nothing — measured as the
// second-slowest route in the app at every load level.
//
// Routes that genuinely need per-request rendering still get it, and get
// it honestly: anything calling cookies() (which is every authenticated
// page, via the Supabase server client) is dynamic automatically. Routes
// that are public AND touch no dynamic API now render statically, and
// each one must therefore appear in csp.ts's STATIC_CSP_ROUTES — a
// statically rendered page cannot carry a per-request nonce, so without
// the nonce-free policy its own bundle would be blocked by
// strict-dynamic. csp.test.ts asserts that correspondence; if you make a
// route static without listing it there, its JavaScript will not run.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`} data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        {/* First thing in the tab order on every page: lets a keyboard or
            screen-reader user jump the nav instead of tabbing through it on
            each navigation. Hidden until it takes focus. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-bg-primary focus:text-[0.85rem] focus:font-medium focus:no-underline"
        >
          Skip to content
        </a>
        {/* React 19 hoists these into <head> — no hand-written <head> needed
            (and Next.js discourages one in a root layout). */}
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
        {/* suppressHydrationWarning is load-bearing, not a papered-over bug.
            The CSP spec has browsers *hide* the nonce after parsing: the
            content attribute is emptied (getAttribute -> "") while the value
            survives on the .nonce IDL property. That exists so an attacker
            who can inject CSS cannot exfiltrate the nonce with a
            `script[nonce^="a"]` selector. React hydrates by comparing the
            content attribute, so it sees "" against the server's real value
            and reports a mismatch on every page load. The difference is
            correct and expected; the warning is not actionable. */}
        {/* The Organization/WebSite JSON-LD that used to live here has moved
            to app/page.tsx. It had to: emitting it from the root layout meant
            reading the per-request nonce with headers(), and that single call
            made every route in the app dynamic. Site-level schema belongs on
            the canonical homepage anyway — search engines want it once, on
            "/", not repeated on every URL — so this is where it should have
            been. It needs no nonce there because "/" is served the nonce-free
            static policy (STATIC_CSP_ROUTES). */}
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
