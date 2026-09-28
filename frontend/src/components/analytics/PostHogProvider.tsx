"use client";

// PostHog — privacy-friendly, cookieless product analytics.
//
// Inert unless NEXT_PUBLIC_POSTHOG_KEY is set, so dev/CI and any
// deployment without the key send zero analytics traffic. EU data
// residency via the eu.i.posthog.com host. Cookieless: persistence is
// kept in memory only, so no analytics cookies are set and the privacy
// policy's "cookieless analytics" claim holds.
//
// On auth state we call identify()/reset() so events tie to the logged-in
// member (by Supabase user id) without ever sending PII.

import { useEffect } from "react";
import posthog from "posthog-js";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/client";
import { isSyntheticEmail } from "@/lib/observability/synthetic";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export const analyticsEnabled = Boolean(KEY);

// Thin capture wrapper so call sites don't each have to re-check
// analyticsEnabled — a no-op with no PostHog traffic when the key is unset,
// same inert-by-default stance as the rest of this file.
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  posthog.capture(event, properties);
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;

    posthog.init(KEY, {
      api_host: HOST,
      // Cookieless: no cookies, no localStorage device id.
      persistence: "memory",
      // We capture pageviews manually-free via history API; keep it simple.
      capture_pageview: true,
      capture_pageleave: true,
      // Don't autocapture rage clicks / form contents — minimise PII.
      autocapture: false,
      // EU residency is enforced by api_host; disable cross-region GeoIP.
      disable_session_recording: true,
    });

    const supabase = createClient();

    // G8: a load-test or prod-window test account never reaches PostHog.
    // Checked before identify, so not even its id is sent.
    const identify = (user: { id: string; email?: string }) => {
      if (isSyntheticEmail(user.email)) {
        posthog.opt_out_capturing();
        Sentry.setTag("synthetic", "true");
        return;
      }
      posthog.identify(user.id);
    };

    // Identify the current session immediately, then track changes.
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) identify(data.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        posthog.reset();
        Sentry.setTag("synthetic", undefined);
      } else if (session?.user) {
        identify(session.user);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return <>{children}</>;
}
