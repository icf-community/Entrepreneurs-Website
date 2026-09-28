"use client";

import { useState } from "react";
import Link from "next/link";
import { ErrorBanner } from "@/components/forms/Banners";
import { settle } from "@/lib/settle";
import { exportMyData } from "./actions";
import { track } from "@/components/analytics/PostHogProvider";

// Settings → "Download my data" (launch programme F-x2). The server action
// returns the JSON; the browser saves it as a file, so nothing is stored
// or linked anywhere on our side.
export default function DataExportSection() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setError(null);
    setPending(true);
    const res = await settle(exportMyData());
    setPending(false);
    if (!res.ok) { setError(res.error); return; }
    track("data_export_downloaded");
    const url = URL.createObjectURL(new Blob([res.json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl bg-bg-card border border-border p-8 space-y-5">
      <div>
        <div className="text-[0.95rem] font-medium text-text-primary mb-1">Your data</div>
        <p className="text-[0.8rem] text-text-muted leading-relaxed">
          A copy of everything we hold about you, as a JSON file. <Link href="/privacy" className="underline underline-offset-2">Privacy notice</Link>
        </p>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <button
        type="button"
        onClick={download}
        disabled={pending}
        aria-busy={pending}
        className="px-5 py-2.5 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.825rem] cursor-pointer transition-colors hover:bg-white/[0.10] disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Download my data"}
      </button>
    </div>
  );
}
