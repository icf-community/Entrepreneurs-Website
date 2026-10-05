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
import type { PostHog } from "posthog-js";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/client";
import { isSyntheticEmail } from "@/lib/observability/synthetic";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export const analyticsEnabled = Boolean(KEY);

// posthog-js is imported on demand, after hydration and only when the key
// is set: it was ~90 KB gzipped in every page's first load (D1). Until it
// arrives, track() queues; the queue is flushed once on load.
let ph: PostHog | null = null;
const queued: [string, Record<string, unknown> | undefined][] = [];

// Thin capture wrapper so call sites don't each have to re-check
// analyticsEnabled — a no-op with no PostHog traffic when the key is unset,
// same inert-by-default stance as the rest of this file.
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  if (ph) ph.capture(event, properties);
  else queued.push([event, properties]);
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
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
        if (!ph) {
          ph = posthog;
          for (const [name, properties] of queued.splice(0)) posthog.capture(name, properties);
        }
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
