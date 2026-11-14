"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pager } from "@/components/ui/Pager";
import { Panel } from "@/components/ui/Panel";
import { ButtonTabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/forms/Field";
import { Icon } from "@/design-system/icons/Icon";
import { useUrlFilters } from "@/lib/filters/useUrlFilters";
import { REPORT_CATEGORIES } from "@/lib/validation/posts";
import { adminDeletePost } from "@/app/community/actions";
import { ErrorBanner } from "@/components/forms/Banners";
import type { PostReport } from "@/lib/data/posts";
import { resolveReport } from "./actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · The report queue
//
// Two distinct actions, deliberately not collapsed into one:
//
//   Remove the post  — the post is still up and should not be. This takes
//                      a reason, emails the author, and auto-resolves
//                      every open report against that post.
//   Resolve          — this report needs no post removal, or the post is
//                      already gone. Emails the reporter the outcome.
//
// "server" navigation because the filter is an argument to a Postgres
// query, not something the browser already holds.
//
// Drawn for scanning: the kind of report is a badge (the urgent kinds in the
// danger tone), the post and who is involved under it, what was said as a
// recessed quote, and the two actions in tone: Remove is the danger button,
// Resolve is neutral.
// ════════════════════════════════════════════════════════════════════

const STATUS_TABS = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

const categoryLabel = (value: string) =>
  REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;

// Illegal content and hate speech carry duties that spam does not, so the
// queue makes the difference visible rather than leaving an admin to read
// every row to find the one that matters.
const URGENT = new Set(["illegal", "hate", "harassment", "sexual"]);

export default function ReportsClient({
  reports, status, page, matching, pageSize,
}: {
  reports: PostReport[];
  status: string;
  page: number;
  matching: number;
  pageSize: number;
}) {
  const url = useUrlFilters({ navigate: "server" });
  const [acting, setActing] = useState<null | { report: PostReport; mode: "remove" | "resolve" }>(null);

  return (
    <div>
      <ButtonTabs
        semantics="current"
        label="Report status"
        items={STATUS_TABS}
        value={status}
        disabled={url.pending}
        onSelect={(next) => url.apply({ status: next, page: null })}
        className="mb-6"
      />

      {reports.length === 0 ? (
        <EmptyState icon="flag">
          {status === "open" ? "No open reports. Nothing needs your attention." : "Nothing here."}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {reports.map((report) => (
            <Panel as="li" key={report.id} className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <Badge tone={URGENT.has(report.category) ? "danger" : "neutral"}>
                    {categoryLabel(report.category)}
                  </Badge>
                  <h2 className="mt-3 break-words font-display text-lead text-text-primary">
                    {report.postTitle}
                  </h2>
                  {/* suppressHydrationWarning: the date below formats in the
                      viewer's local zone, which legitimately differs from
                      the server's. */}
                  <p className="mt-1 text-small text-text-muted" suppressHydrationWarning>
                    Posted by {report.authorName}
                    <span aria-hidden className="mx-1.5">·</span>
                    Reported by {report.reporterName}
                    <span aria-hidden className="mx-1.5">·</span>
                    <span className="data" suppressHydrationWarning>
                      {new Date(report.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </span>
                  </p>
                </div>

                <Badge tone={report.postStillExists ? "lit" : "neutral"} dot className="shrink-0">
                  {report.postStillExists ? "Post is live" : "Post already removed"}
                </Badge>
              </div>

              <blockquote className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-tint-1 px-4 py-3 text-body text-text-secondary">
                {report.reason}
              </blockquote>

              {report.resolutionNote && (
                <p className="mt-3 text-small text-text-muted">
                  Resolution note: {report.resolutionNote}
                </p>
              )}

              {report.status === "open" && (
                <div className="mt-5 flex flex-wrap gap-3 border-t border-border-subtle pt-4">
                  {report.postStillExists && (
                    <Button
                      variant="danger"
                      size="sm"
                      leading={<Icon name="trash" size={18} />}
                      onClick={() => setActing({ report, mode: "remove" })}
                    >
                      Remove post
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActing({ report, mode: "resolve" })}
                  >
                    Resolve without removing
                  </Button>
                </div>
              )}
            </Panel>
          ))}
        </ul>
      )}

      <Pager url={url} page={page} total={matching} pageSize={pageSize} label="Report pages" />

      {acting && (
        <ActionDialog
          report={acting.report}
          mode={acting.mode}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}

function ActionDialog({
  report, mode, onClose,
}: { report: PostReport; mode: "remove" | "resolve"; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const removing = mode === "remove";

  return (
    <Dialog
      onClose={onClose}
      label={removing ? "Remove the reported post" : "Resolve this report"}
      tone={removing ? "danger" : "default"}
      className="w-full max-w-[28rem] p-6 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-title text-text-primary">
          {removing ? `Remove ${report.authorName}'s post?` : "Resolve this report"}
        </h2>
        <DialogClose className="-mr-2 -mt-2" />
      </div>
      <p className="mt-3 text-body text-text-secondary">
        {removing
          ? "The post and its images are deleted immediately, the author is emailed your reason, and a record is kept for 12 months. Every open report on this post is resolved."
          : "The post stays up. The member who reported it is emailed to say it was reviewed and no action was taken."}
      </p>

      <div className="mt-5">
        <Field label={removing ? "Reason (sent to the author)" : "Note for the reporter (optional)"}>
          <Textarea
            id="action-note"
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      </div>

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant={removing ? "danger" : "primary"}
          size="sm"
          loading={pending}
          disabled={removing && !text.trim()}
          onClick={() =>
            start(async () => {
              setError("");
              const res = removing
                ? // admin_delete_post auto-resolves the open reports on that
                  // post, so this is one call rather than two.
                  await adminDeletePost(report.postId!, text)
                : await resolveReport(report.id, "dismissed", text);
              if (!res.ok) { setError(res.error); return; }
              onClose();
              router.refresh();
            })
          }
        >
          {removing ? "Remove and email author" : "Resolve and email reporter"}
        </Button>
      </div>
    </Dialog>
  );
}
