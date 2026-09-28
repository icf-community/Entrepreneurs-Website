// Sentry — edge runtime (middleware, edge routes).
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set. See sentry.server.config.ts.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Errors only — no performance tracing (keeps us inside the free-tier
    // error quota without consuming the separate performance budget).
    tracesSampleRate: 0,
    enabled: process.env.NODE_ENV === "production",
    // G6: production / preview / development, so a preview deploy's errors
    // never read as production's.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
