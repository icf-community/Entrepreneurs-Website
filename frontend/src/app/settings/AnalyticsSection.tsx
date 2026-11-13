"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ANALYTICS_CHANGE_EVENT, analyticsOptedOut, setAnalyticsOptOut } from "@/lib/analytics/track";

// The stored choice is browser-only, so read it the way Sidebar reads its
// collapsed state: server snapshot null, client snapshot from storage, and
// a subscription to the change event setAnalyticsOptOut fires.
function subscribe(cb: () => void) {
  window.addEventListener(ANALYTICS_CHANGE_EVENT, cb);
  return () => window.removeEventListener(ANALYTICS_CHANGE_EVENT, cb);
}

// Settings → Analytics: the member's way to object to our cookieless usage
// analytics (Privacy §3, §10). Per device, because the choice is stored in
// this browser; the privacy policy says so.
export default function AnalyticsSection() {
  // null on the server: the stored choice is only readable in the browser.
  const off = useSyncExternalStore<boolean | null>(subscribe, analyticsOptedOut, () => null);
  const toggle = () => setAnalyticsOptOut(!off);

  return (
    <div className="rounded-2xl bg-bg-card border border-border p-8 space-y-5">
      <div>
        <div className="text-lead font-medium text-text-primary mb-1">Usage analytics</div>
        <p className="text-body text-text-muted leading-relaxed">
          {off
            ? "Off on this device. We don't record which pages you use here."
            : "We record which pages and features are used, without cookies, to improve Foundry. This choice applies to this device."}{" "}
          <Link href="/cookies" className="underline underline-offset-2">Cookie Policy</Link>
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={off === null}
        className="px-5 py-2.5 rounded-lg bg-tint-2 border border-border-strong text-text-primary text-body cursor-pointer transition-colors hover:bg-tint-4 disabled:opacity-60"
      >
        {off ? "Turn analytics back on" : "Turn off analytics"}
      </button>
    </div>
  );
}
