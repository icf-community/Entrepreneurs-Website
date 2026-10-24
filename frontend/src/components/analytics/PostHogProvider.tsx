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
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/client";
import { isSyntheticEmail } from "@/lib/observability/synthetic";
import { sanitiseAnalyticsEvent } from "@/lib/observability/analyticsUrls";
import { POSTHOG_KEY, POSTHOG_HOST, flushQueuedTracking } from "@/lib/analytics/track";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    let cancelled = false;
    let unsubscribe = () => {};

    void (async () => {
      const supabase = createClient();

      // G8: a load-test or prod-window test account never reaches PostHog —
      // not even the $pageview that init sends — so the stored session
      // (read locally, no network) is checked before posthog-js is loaded.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (isSyntheticEmail(session?.user.email)) {
        Sentry.setTag("synthetic", "true");
        return;
      }

      const { default: posthog } = await import("posthog-js");
      if (cancelled) return;
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        // Cookieless: no cookies, no localStorage device id.
        persistence: "memory",
        // We capture pageviews manually-free via history API; keep it simple.
        capture_pageview: true,
        capture_pageleave: true,
        // Don't autocapture rage clicks / form contents — minimise PII.
        autocapture: false,
        // EU residency is enforced by api_host; disable cross-region GeoIP.
        disable_session_recording: true,
        // F19: no AI conversation or job ids in page URLs sent with an identity.
        before_send: (event) => sanitiseAnalyticsEvent(event),
      });

      // A test account that signs in later in this tab is opted out before
      // identify, so not even its id is sent.
      const identify = (user: { id: string; email?: string }) => {
        if (isSyntheticEmail(user.email)) {
          posthog.opt_out_capturing();
          Sentry.setTag("synthetic", "true");
          return;
        }
        posthog.identify(user.id);
      };

      // Subscribing emits INITIAL_SESSION with the stored session first, so
      // this also identifies the current member. No getUser() here: that was
      // a network call to Supabase Auth on every page load, for analytics
      // only (D1).
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          posthog.reset();
          Sentry.setTag("synthetic", undefined);
        } else if (session?.user) {
          identify(session.user);
        }
        // track() goes straight to PostHog only from here on, after the
        // first identify, so queued events are attributed to the member.
        flushQueuedTracking(posthog);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
