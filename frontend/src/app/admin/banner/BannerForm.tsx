"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { FormActions } from "@/components/ui/FormActions";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Notice, type NoticeTone } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
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

// The same lights the live banner is drawn in (SiteBanner): info is the cold light, warning is amber, critical is danger.
const PREVIEW_TONE: Record<Severity, NoticeTone> = {
  info: "info",
  warning: "lit",
  critical: "danger",
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
    <div className="grid gap-6">
      <CurrentBannerStatus current={current} />

      <FormSection>
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div>
          <Field label="Message">
            <Textarea
              id="banner-message"
              value={message}
              maxLength={MAX}
              rows={3}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby="banner-message-count"
            />
          </Field>
          <p id="banner-message-count" className="data mt-2 text-right text-small text-text-muted">
            {message.length}/{MAX}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label="Severity">
            <Select
              id="banner-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
            >
              <option value="info">Info (members can dismiss)</option>
              <option value="warning">Warning (members can dismiss)</option>
              <option value="critical">Critical (stays until cleared)</option>
            </Select>
          </Field>
          <Field label="Hide automatically at (optional)">
            <Input
              id="banner-hide"
              type="datetime-local"
              value={hideAfter}
              onChange={(e) => setHideAfter(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Link for more detail (optional, https:// only)"
          error={linkInvalid ? "Use a full https:// address." : undefined}
        >
          <Input
            id="banner-link"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://"
          />
        </Field>

        <BannerPreview severity={severity} message={message} linkUrl={linkUrl} linkInvalid={linkInvalid} />

        <FormActions>
          <Button variant="primary" size="md" loading={busy === "publish"} disabled={!canPublish} onClick={publish}>
            Publish banner
          </Button>
          {current?.enabled && (
            <Button variant="ghost" size="md" loading={busy === "clear"} disabled={busy !== null} onClick={clear}>
              Clear banner
            </Button>
          )}
        </FormActions>
      </FormSection>
    </div>
  );
}

/** suppressHydrationWarning: the times below format in the viewer's local
    zone, which legitimately differs from the server's. Live is lit (look at
    this); nothing showing is the quiet info tone. */
function CurrentBannerStatus({ current }: { current: Current }) {
  return (
    <Notice tone={current?.enabled ? "lit" : "info"} icon={current?.enabled ? "notifications" : "info"}>
      <span suppressHydrationWarning>
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
      </span>
    </Notice>
  );
}

// What members will see, in the same tone the live banner is drawn in.
function BannerPreview({ severity, message, linkUrl, linkInvalid }: {
  severity: Severity;
  message: string;
  linkUrl: string;
  linkInvalid: boolean;
}) {
  return (
    <div>
      <p className="lm-label mb-2">Preview</p>
      <Notice tone={PREVIEW_TONE[severity]}>
        {message.trim() || <span className="text-text-muted">Your message will appear here.</span>}
        {linkUrl.trim() && !linkInvalid && <span className="underline underline-offset-2"> More</span>}
      </Notice>
    </div>
  );
}
