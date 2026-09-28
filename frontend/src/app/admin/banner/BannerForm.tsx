"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { useToast } from "@/components/ui/Toast";
import { settle } from "@/lib/settle";
import { publishSiteBanner, clearSiteBanner } from "./actions";
import { track } from "@/components/analytics/PostHogProvider";

type Severity = "info" | "warning" | "critical";

type Current = {
  message: string;
  severity: Severity;
  linkUrl: string;
  hideAfter: string | null;
  enabled: boolean;
  updatedAt: string;
  updatedByName: string | null;
} | null;

const MAX = 200;

const PREVIEW_TONE: Record<Severity, string> = {
  info: "border-border-strong bg-bg-card text-text-primary",
  warning: "border-[#e0a100]/60 bg-[#e0a100]/10 text-[#ffd97a]",
  critical: "border-[#ff4d4d]/60 bg-[#ff4d4d]/10 text-[#ffb3b3]",
};

/** "2026-09-28T14:05" for a datetime-local input, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BannerForm({ current }: { current: Current }) {
  const router = useRouter();
  const toast = useToast();
  const [message, setMessage] = useState(current?.message ?? "");
  const [severity, setSeverity] = useState<Severity>(current?.severity ?? "info");
  const [linkUrl, setLinkUrl] = useState(current?.linkUrl ?? "");
  const [hideAfter, setHideAfter] = useState(toLocalInput(current?.hideAfter ?? null));
  const [busy, setBusy] = useState<null | "publish" | "clear">(null);
  const [error, setError] = useState<string | null>(null);

  const linkInvalid = linkUrl.trim() !== "" && !/^https:\/\/[^\s<>"]+$/.test(linkUrl.trim());
  const canPublish = message.trim().length > 0 && message.length <= MAX && !linkInvalid && busy === null;

  async function publish() {
    setBusy("publish");
    setError(null);
    const res = await settle(publishSiteBanner({
      message,
      severity,
      linkUrl,
      hideAfter: hideAfter ? new Date(hideAfter).toISOString() : "",
    }));
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    track("site_banner_published", { severity });
    toast("Banner published. It shows everywhere within a few seconds.", "success");
    router.refresh();
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    const res = await settle(clearSiteBanner());
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    track("site_banner_cleared");
    toast("Banner cleared.", "success");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-bg-card p-4 text-[0.8rem] text-text-muted">
        {current?.enabled ? (
          <>Live now{current.hideAfter ? `, hides at ${new Date(current.hideAfter).toLocaleString("en-GB")}` : ""}.</>
        ) : (
          <>No banner is showing.</>
        )}
        {current?.updatedByName && (
          <> Last changed by {current.updatedByName}, {new Date(current.updatedAt).toLocaleString("en-GB")}.</>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div>
        <label htmlFor="banner-message" className="block text-[0.8rem] text-text-secondary mb-1.5">
          Message
        </label>
        <textarea
          id="banner-message"
          value={message}
          maxLength={MAX}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="banner-message-count"
          className="w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.9rem] text-text-primary focus:border-accent focus:outline-none"
        />
        <p id="banner-message-count" className="mt-1 text-right text-[0.72rem] text-text-muted tnum">
          {message.length}/{MAX}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="banner-severity" className="block text-[0.8rem] text-text-secondary mb-1.5">
            Severity
          </label>
          <select
            id="banner-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.9rem] text-text-primary"
          >
            <option value="info">Info (members can dismiss)</option>
            <option value="warning">Warning (members can dismiss)</option>
            <option value="critical">Critical (stays until cleared)</option>
          </select>
        </div>
        <div>
          <label htmlFor="banner-hide" className="block text-[0.8rem] text-text-secondary mb-1.5">
            Hide automatically at (optional)
          </label>
          <input
            id="banner-hide"
            type="datetime-local"
            value={hideAfter}
            onChange={(e) => setHideAfter(e.target.value)}
            className="w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.9rem] text-text-primary"
          />
        </div>
      </div>

      <div>
        <label htmlFor="banner-link" className="block text-[0.8rem] text-text-secondary mb-1.5">
          Link for more detail (optional, https:// only)
        </label>
        <input
          id="banner-link"
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          aria-invalid={linkInvalid}
          aria-describedby={linkInvalid ? "banner-link-error" : undefined}
          placeholder="https://"
          className="w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.9rem] text-text-primary"
        />
        {linkInvalid && (
          <p id="banner-link-error" className="mt-1 text-[0.75rem] text-[#ff8080]">
            Use a full https:// address.
          </p>
        )}
      </div>

      <div>
        <p className="text-[0.8rem] text-text-secondary mb-1.5">Preview</p>
        <div className={`rounded-lg border px-4 py-2.5 text-[0.825rem] ${PREVIEW_TONE[severity]}`}>
          {message.trim() || <span className="text-text-muted">Your message will appear here.</span>}
          {linkUrl.trim() && !linkInvalid && <span className="underline underline-offset-2"> More</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" loading={busy === "publish"} disabled={!canPublish} onClick={publish}>
          Publish banner
        </Button>
        {current?.enabled && (
          <Button variant="ghost" loading={busy === "clear"} disabled={busy !== null} onClick={clear}>
            Clear banner
          </Button>
        )}
      </div>
    </div>
  );
}
