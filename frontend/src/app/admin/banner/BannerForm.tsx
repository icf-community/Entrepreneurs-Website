"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { useToast } from "@/components/ui/Toast";
import { settle } from "@/lib/settle";
import { publishSiteBanner, clearSiteBanner } from "./actions";
import { track } from "@/lib/analytics/track";

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
  warning: "border-[#e0a100]/60 bg-[#e0a100]/10 text-lit",
  critical: "border-danger/60 bg-danger/10 text-danger",
};

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB");

/** "2026-09-28T14:05" for a datetime-local input, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** True once the two post-submit outcomes (error vs. success) are handled. */
async function runBannerAction(
  setBusy: (v: null | "publish" | "clear") => void,
  setError: (v: string | null) => void,
  key: "publish" | "clear",
  call: Promise<{ ok: true } | { ok: false; error: string }>,
  onSuccess: () => void,
) {
  setBusy(key);
  setError(null);
  const res = await settle(call);
  setBusy(null);
  if (!res.ok) { setError(res.error); return; }
  onSuccess();
}

export default function BannerForm({ current }: { current: Current }) {
  const router = useRouter();
  const toast = useToast();
  const [message, setMessage] = useState(current?.message ?? "");
  const [severity, setSeverity] = useState<Severity>(current?.severity ?? "info");
  const [linkUrl, setLinkUrl] = useState(current?.linkUrl ?? "");
  const [hideAfter, setHideAfter] = useState(() => toLocalInput(current?.hideAfter ?? null));
  const [busy, setBusy] = useState<null | "publish" | "clear">(null);
  const [error, setError] = useState<string | null>(null);

  const linkInvalid = linkUrl.trim() !== "" && !/^https:\/\/[^\s<>"]+$/.test(linkUrl.trim());
  const canPublish = message.trim().length > 0 && message.length <= MAX && !linkInvalid && busy === null;

  async function publish() {
    await runBannerAction(setBusy, setError, "publish", publishSiteBanner({
      message,
      severity,
      linkUrl,
      hideAfter: hideAfter ? new Date(hideAfter).toISOString() : "",
    }), () => {
      track("site_banner_published", { severity });
      toast("Banner published. It shows everywhere within a few seconds.", "success");
      router.refresh();
    });
  }

  async function clear() {
    await runBannerAction(setBusy, setError, "clear", clearSiteBanner(), () => {
      track("site_banner_cleared");
      toast("Banner cleared.", "success");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <CurrentBannerStatus current={current} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div>
        <label htmlFor="banner-message" className="block text-body text-text-secondary mb-1.5">
          Message
        </label>
        <textarea
          id="banner-message"
          value={message}
          maxLength={MAX}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="banner-message-count"
          className="w-full rounded-lg border border-border-strong bg-tint-1 px-3 py-2 text-lead text-text-primary focus:border-accent focus:outline-none"
        />
        <p id="banner-message-count" className="mt-1 text-right text-small text-text-muted tnum">
          {message.length}/{MAX}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="banner-severity" className="block text-body text-text-secondary mb-1.5">
            Severity
          </label>
          <select
            id="banner-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="w-full rounded-lg border border-border-strong bg-tint-1 px-3 py-2 text-lead text-text-primary"
          >
            <option value="info">Info (members can dismiss)</option>
            <option value="warning">Warning (members can dismiss)</option>
            <option value="critical">Critical (stays until cleared)</option>
          </select>
        </div>
        <div>
          <label htmlFor="banner-hide" className="block text-body text-text-secondary mb-1.5">
            Hide automatically at (optional)
          </label>
          <input
            id="banner-hide"
            type="datetime-local"
            value={hideAfter}
            onChange={(e) => setHideAfter(e.target.value)}
            className="w-full rounded-lg border border-border-strong bg-tint-1 px-3 py-2 text-lead text-text-primary"
          />
        </div>
      </div>

      <div>
        <label htmlFor="banner-link" className="block text-body text-text-secondary mb-1.5">
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
          className="w-full rounded-lg border border-border-strong bg-tint-1 px-3 py-2 text-lead text-text-primary"
        />
        {linkInvalid && (
          <p id="banner-link-error" className="mt-1 text-small text-danger">
            Use a full https:// address.
          </p>
        )}
      </div>

      <BannerPreview severity={severity} message={message} linkUrl={linkUrl} linkInvalid={linkInvalid} />

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

/** suppressHydrationWarning: the times below format in the viewer's local
    zone, which legitimately differs from the server's. */
function CurrentBannerStatus({ current }: { current: Current }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 text-body text-text-muted" suppressHydrationWarning>
      {current?.enabled ? (
        // react-doctor-disable-next-line react-doctor/no-locale-format-in-render -- cosmetic admin-only timestamp; suppressHydrationWarning above accepts the server/client locale mismatch rather than adding post-mount state for it
        <>Live now{current.hideAfter ? `, hides at ${DATE_TIME_FORMAT.format(new Date(current.hideAfter))}` : ""}.</>
      ) : (
        <>No banner is showing.</>
      )}
      {current?.updatedByName && (
        // react-doctor-disable-next-line react-doctor/no-locale-format-in-render -- same as above
        <> Last changed by {current.updatedByName}, {DATE_TIME_FORMAT.format(new Date(current.updatedAt))}.</>
      )}
    </div>
  );
}

function BannerPreview({ severity, message, linkUrl, linkInvalid }: {
  severity: Severity;
  message: string;
  linkUrl: string;
  linkInvalid: boolean;
}) {
  return (
    <div>
      <p className="text-body text-text-secondary mb-1.5">Preview</p>
      <div className={`rounded-lg border px-4 py-2.5 text-body ${PREVIEW_TONE[severity]}`}>
        {message.trim() || <span className="text-text-muted">Your message will appear here.</span>}
        {linkUrl.trim() && !linkInvalid && <span className="underline underline-offset-2"> More</span>}
      </div>
    </div>
  );
}
