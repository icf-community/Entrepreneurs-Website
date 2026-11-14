"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ANALYTICS_CHANGE_EVENT, analyticsOptedOut, setAnalyticsOptOut } from "@/lib/analytics/track";
import { SettingsSection } from "./SettingsSection";

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
    <SettingsSection
      title="Usage analytics"
      description={
        <>
          {off
            ? "Off on this device. We don't record which pages you use here."
            : "We record which pages and features are used, without cookies, to improve Foundry. This choice applies to this device."}{" "}
          <Link href="/cookies" className="underline underline-offset-2">Cookie Policy</Link>
        </>
      }
    >
      <Button type="button" variant="ghost" size="md" onClick={toggle} disabled={off === null}>
        {off ? "Turn analytics back on" : "Turn off analytics"}
      </Button>
    </SettingsSection>
  );
}
