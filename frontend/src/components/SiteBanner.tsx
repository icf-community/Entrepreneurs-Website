"use client";

import { useEffect, useState } from "react";
import { Notice, type NoticeTone } from "@/components/ui/Notice";

// ════════════════════════════════════════════════════════════════════
// Foundry · Incident banner (launch programme F-x4)
//
// The one message an admin can put in front of everyone from
// /admin/banner. Fetched from /api/banner, which the CDN holds for 15s,
// so rendering it on every page costs almost nothing. Plain text only:
// the message is set by an admin, but it is still never rendered as HTML.
//
// Info and warning can be dismissed; the dismissal is remembered per
// banner version, so a new message shows again. Critical can't be
// dismissed. Storage can be unavailable (private mode, blocked site data):
// every access is wrapped, and the banner then simply stays visible.
//
// Drawn as a full-bleed Notice strip. The severities are lights, not
// colours: info is the cold light, warning is amber, critical is danger.
// ════════════════════════════════════════════════════════════════════

type Banner = {
  message: string;
  severity: "info" | "warning" | "critical";
  linkUrl: string | null;
  version: number;
};

const DISMISSED_KEY = "foundry:banner-dismissed";

function readDismissed(): number | null {
  try {
    const v = window.localStorage.getItem(DISMISSED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

const TONE: Record<Banner["severity"], NoticeTone> = {
  info: "info",
  warning: "lit",
  critical: "danger",
};

export function SiteBanner() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/banner")
      .then((r) => (r.ok ? r.json() : { banner: null }))
      .then(
        (body: { banner: Banner | null }) => {
          if (cancelled) return;
          setDismissed(readDismissed());
          setBanner(body.banner);
        },
        () => {},
      );
    return () => { cancelled = true; };
  }, []);

  if (!banner) return null;
  const canDismiss = banner.severity !== "critical";
  if (canDismiss && dismissed === banner.version) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(banner.version));
    } catch {
      // Storage unavailable: hide it for this page view only.
    }
    setDismissed(banner.version);
  };

  return (
    <Notice
      shape="bar"
      tone={TONE[banner.severity]}
      role={banner.severity === "critical" ? "alert" : "status"}
      onDismiss={canDismiss ? dismiss : undefined}
      dismissLabel="Dismiss this notice"
    >
      {banner.message}
      {banner.linkUrl && (
        <>
          {" "}
          <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer">
            More
          </a>
        </>
      )}
    </Notice>
  );
}
