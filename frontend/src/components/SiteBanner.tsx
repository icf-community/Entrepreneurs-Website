"use client";

import { useEffect, useState } from "react";

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

const TONE: Record<Banner["severity"], string> = {
  info: "border-border-strong bg-bg-card text-text-primary",
  warning: "border-[#e0a100]/60 bg-[#e0a100]/10 text-[#ffd97a]",
  critical: "border-[#ff4d4d]/60 bg-[#ff4d4d]/10 text-[#ffb3b3]",
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
    <div
      role={banner.severity === "critical" ? "alert" : "status"}
      className={`flex items-start gap-3 border-b px-4 py-2.5 text-[0.825rem] sm:px-8 ${TONE[banner.severity]}`}
    >
      <p className="min-w-0 flex-1 leading-relaxed">
        {banner.message}
        {banner.linkUrl && (
          <>
            {" "}
            <a
              href={banner.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              More
            </a>
          </>
        )}
      </p>
      {canDismiss && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this notice"
          className="shrink-0 cursor-pointer rounded-md border border-border-strong px-1.5 text-text-muted transition-colors hover:border-accent hover:text-text-primary"
        >
          ✕
        </button>
      )}
    </div>
  );
}
