// Sentry — browser runtime. Loaded automatically by Next.js on the client.
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set. EU residency comes from the DSN.
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
    // tracesSampler's own header for why.
    tracesSampler,
    // No session replay / PII capture — we keep client telemetry minimal.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enabled: process.env.NODE_ENV === "production",
    // G6: production / preview / development, so a preview deploy's errors
    // never read as production's.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  });
}

// Required by Next.js so Sentry can instrument client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
