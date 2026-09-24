import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { STATIC_CSP_ROUTES, buildStaticCsp } from "./src/lib/csp";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
];

// Every authenticated route segment. `no-store` here is what actually
// answers the "does bfcache show a stale member-only page after logout"
// question — the middleware's own session re-check only runs on a real
// network request, and bfcache restores without one. Scoped to these
// segments rather than site-wide so the public marketing pages keep normal
// caching behaviour.
const AUTHENTICATED_SEGMENTS = [
  "home", "profile", "settings", "admin", "calendar", "community", "intake",
  "onboarding", "members", "opportunities", "events", "vcs", "messaging",
  "my-activity", "my-bookmarks", "my-submissions", "pending", "rejected", "connections",
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      ...AUTHENTICATED_SEGMENTS.map((segment) => ({
        source: `/${segment}/:path*`,
        headers: [{ key: "Cache-Control", value: "no-store" }],
      })),
      ...AUTHENTICATED_SEGMENTS.map((segment) => ({
        source: `/${segment}`,
        headers: [{ key: "Cache-Control", value: "no-store" }],
      })),
      // Pure-content public pages. proxy.ts's matcher skips these, so no
      // middleware runs on them at all — which means no per-request nonce
      // and, more to the point, no supabase.auth.getUser() round trip on
      // every anonymous view. The CSP therefore has to come from here
      // instead, or these pages would ship with no policy at all.
      //
      // See buildStaticCsp for exactly what is weaker about this policy
      // and why it is confined to these three routes.
      ...STATIC_CSP_ROUTES.map((route) => ({
        source: route,
        headers: [{ key: "Content-Security-Policy", value: buildStaticCsp() }],
      })),
    ];
  },
};

// Uploads source maps to Sentry at build time so production stack traces
// resolve to real source instead of minified bundles. Skips the upload (and
// stays silent about it) when SENTRY_AUTH_TOKEN isn't set — same
// inert-unless-configured stance as the Sentry.init() calls themselves, so a
// local build or a fork's CI run never needs Sentry credentials.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
  },
});
