// Sentry — server runtime.
//
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set, so local dev and CI builds
// run with no Sentry traffic. EU data residency is determined by the DSN
// itself (use an ingest URL from a Sentry EU-region org, e.g.
// https://...@o123.ingest.de.sentry.io/...).
import * as Sentry from "@sentry/nextjs";
import { tracesSampler } from "./src/lib/observability/tracesSampler";
import { scrubBreadcrumb, scrubEvent } from "./src/lib/observability/scrubEvent";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Personal data never leaves the process: emails, tokens and query strings
    // are redacted from events, transactions and breadcrumbs (scrubEvent.ts).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    // A small trace sample, authenticated routes only — see
    // tracesSampler's own header for why. Keeps us inside the free-tier
    // performance quota while still getting production latency signal.
    tracesSampler,
    // Don't phone home in development.
    enabled: process.env.NODE_ENV === "production",
    // G6: production / preview / development, so a preview deploy's errors
    // never read as production's.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
