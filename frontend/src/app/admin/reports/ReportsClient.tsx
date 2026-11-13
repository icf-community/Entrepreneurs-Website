"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { Pager } from "@/components/ui/Pager";
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
      <nav aria-label="Report status" className="mb-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            disabled={url.pending}
            onClick={() => url.apply({ status: tab.value, page: null })}
            className={
              "rounded-lg border px-4 py-2 text-body transition-colors cursor-pointer " +
              (status === tab.value
                ? "border-accent bg-tint-2 text-text-primary"
                : "border-border-strong bg-tint-1 text-text-secondary hover:border-accent hover:text-text-primary")
            }
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {reports.length === 0 ? (
        <p className="rounded-xl border border-border-subtle bg-tint-1 px-6 py-12 text-center text-body text-text-secondary">
          {status === "open" ? "No open reports. Nothing needs your attention." : "Nothing here."}
        </p>
      ) : (
        <ul className="space-y-4">
          {reports.map((report) => (
            <li
              key={report.id}
              className="rounded-xl border border-border-subtle bg-tint-1 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={
                      "inline-block rounded-full px-2.5 py-1 text-caption" +
                      (URGENT.has(report.category)
                        ? "border border-danger/40 bg-danger/10 text-danger"
                        : "border border-border-strong text-text-muted")
                    }
                  >
                    {categoryLabel(report.category)}
                  </span>
                  <h2 className="mt-3 text-lead font-medium tracking-tight text-text-primary break-words">
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
                    {new Date(report.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </p>
                </div>

                <span className="shrink-0 text-small text-text-muted">
                  {report.postStillExists ? "Post is live" : "Post already removed"}
                </span>
              </div>

              <blockquote className="mt-4 border-l-2 border-border-strong pl-4 text-body text-text-secondary whitespace-pre-wrap break-words">
                {report.reason}
              </blockquote>

              {report.resolutionNote && (
                <p className="mt-3 text-small text-text-muted">
                  Resolution note: {report.resolutionNote}
                </p>
              )}

              {report.status === "open" && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
                  {report.postStillExists && (
                    <Button
                      variant="danger"
                      size="sm"
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
            </li>
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
      className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6"
    >
      <h3 className="font-display text-lead text-text-primary">
        {removing ? `Remove ${report.authorName}'s post?` : "Resolve this report"}
      </h3>
      <p className="mt-2 text-body text-text-secondary leading-relaxed">
        {removing
          ? "The post and its images are deleted immediately, the author is emailed your reason, and a record is kept for 12 months. Every open report on this post is resolved."
          : "The post stays up. The member who reported it is emailed to say it was reviewed and no action was taken."}
      </p>

      <label htmlFor="action-note" className="mt-5 block text-small text-text-muted">
        {removing ? "Reason (sent to the author)" : "Note for the reporter (optional)"}
      </label>
      <textarea
        id="action-note"
        rows={3}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border-strong bg-tint-1 px-3 py-2 text-body text-text-primary"
      />

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
