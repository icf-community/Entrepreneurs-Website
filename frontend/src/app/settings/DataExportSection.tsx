"use client";

import { useState } from "react";
import Link from "next/link";
import { ErrorBanner } from "@/components/forms/Banners";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/design-system/icons/Icon";
import { settle } from "@/lib/settle";
import { exportMyData } from "./actions";
import { track } from "@/lib/analytics/track";
import { SettingsSection } from "./SettingsSection";

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
    <SettingsSection
      title="Your data"
      description={
        <>
          A copy of everything we hold about you, as a JSON file.{" "}
          <Link href="/privacy" className="underline underline-offset-2">Privacy notice</Link>
        </>
      }
    >
      <div className="grid justify-items-start gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={download}
          loading={pending}
          leading={<Icon name="download" size={18} />}
        >
          {pending ? "Preparing…" : "Download my data"}
        </Button>
      </div>
    </SettingsSection>
  );
}
