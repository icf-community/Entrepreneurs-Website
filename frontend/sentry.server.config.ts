// Sentry — server runtime.
//
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set, so local dev and CI builds
// run with no Sentry traffic. EU data residency is determined by the DSN
// itself (use an ingest URL from a Sentry EU-region org, e.g.
// https://...@o123.ingest.de.sentry.io/...).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Errors only — no performance tracing (keeps us inside the free-tier
    // error quota without consuming the separate performance budget).
    tracesSampleRate: 0,
    // Don't phone home in development.
    enabled: process.env.NODE_ENV === "production",
    // G6: production / preview / development, so a preview deploy's errors
    // never read as production's.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
