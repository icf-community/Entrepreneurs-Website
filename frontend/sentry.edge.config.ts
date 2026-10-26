// Sentry — edge runtime (middleware, edge routes).
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set. See sentry.server.config.ts.
import * as Sentry from "@sentry/nextjs";
import { tracesSampler } from "./src/lib/observability/tracesSampler";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // A small trace sample, authenticated routes only — see
    // tracesSampler's own header for why.
    tracesSampler,
    enabled: process.env.NODE_ENV === "production",
    // G6: production / preview / development, so a preview deploy's errors
    // never read as production's.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
