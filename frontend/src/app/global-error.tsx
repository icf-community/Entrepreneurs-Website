"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Roundel } from "@/design-system/logo/Roundel";

// global-error renders only when the root layout itself throws — so we
// can't rely on layout.tsx, fonts, or globals.css. Plain inline styles
// only. This is the last line of defence.
//
// The palette below is therefore the one copy of the design tokens that has
// to be maintained by hand (tokens.guard.test.ts allows raw values in this file,
// and only this one among the pages, for that reason). The literals mirror the
// Lumen lights: the night (--color-void, #04080d), star white (--color-star), and
// the ink steps (--color-text-primary, -secondary, -muted) as they land on the night.
// Change them together. The roundel is inline SVG in currentColor, so it needs no
// stylesheet either.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // instrumentation-client.ts initialises Sentry independently of the root
  // layout, so this still reports even though the layout itself crashed.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: "#04080d",
          color: "#eef1f5",
          fontFamily: "'Helvetica Neue', Arial, system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <div style={{ color: "#ffffff", marginBottom: "1.5rem", display: "flex", justifyContent: "center" }}>
            <Roundel size={56} label="Imperial Entrepreneurs" />
          </div>
          <div style={{ color: "#a3aab4", fontSize: "0.8rem", fontWeight: 500, marginBottom: "1rem" }}>
            Application error
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 400, margin: "0 0 1rem", lineHeight: 1.2 }}>
            Something went very wrong.
          </h1>
          <p style={{ color: "#b9bfc7", fontSize: "0.95rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            The page couldn&apos;t be rendered. Please refresh, or come back in a moment.
          </p>
          {/* Plain anchor on purpose: global-error renders when the Next.js
              client may be broken, so we can't rely on next/link routing. */}
          {/* eslint-disable @next/next/no-html-link-for-pages -- block form, not
              -next-line, because the react-doctor suppression comment below must
              itself sit immediately above the <a> for react-doctor to recognize it,
              leaving no line free for an eslint-disable-next-line here too */}
          {/* react-doctor-disable-next-line react-doctor/nextjs-no-a-element -- global-error renders outside the root layout/Router context (replaces <html>/<body>); next/link is not guaranteed to work here, plain <a> is correct */}
          <a
            href="/"
            style={{
              display: "inline-block",
              padding: "0.8rem 1.6rem",
              backgroundColor: "#ffffff",
              color: "#04080d",
              borderRadius: 999,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            Reload home
          </a>
          {/* eslint-enable @next/next/no-html-link-for-pages */}
          {error.digest && (
            <p style={{ marginTop: "2rem", fontSize: "0.75rem", color: "#9aa1ab" }}>
              Error ID: <span style={{ fontVariantNumeric: "tabular-nums" }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
