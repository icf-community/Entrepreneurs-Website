import Link from "next/link";
import { pendingCounts } from "@/lib/data/admin";
import SignOutButton from "./SignOutButton";
import IngestionToggle from "./IngestionToggle";
import { getIngestionStatus } from "./actions";
import { requireAdminPage } from "@/lib/auth/guard";

export default async function AdminPage() {
  const { supabase } = await requireAdminPage();

  const [counts, ingestionStatus] = await Promise.all([
    pendingCounts(supabase),
    getIngestionStatus(),
  ]);
  const totalPending = counts.total;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-12 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin</p>
            <h1 className="font-display text-display leading-[1.1] tracking-tight">
              Foundry control panel
            </h1>
            <p className="text-body text-text-muted mt-2 flex items-center gap-2">
              {totalPending > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-0.5 text-small font-semibold text-bg-primary">
                  {totalPending} awaiting review
                </span>
              ) : (
                <span className="inline-flex items-center rounded-lg border border-border px-2.5 py-0.5 text-small text-text-muted">
                  Queues clear
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/members"
              className="text-body bg-tint-2 border border-border-strong text-text-primary no-underline rounded-lg px-4 py-1.5 transition-colors duration-150 hover:bg-tint-4 hover:border-accent"
            >
              ← Back to site
            </Link>
            <SignOutButton />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px border border-border bg-border md:grid-cols-2 lg:grid-cols-5">
          <QueueLink
            href="/admin/users"
            title="Pending alumni profiles"
            count={counts.profiles}
            hint="Manual verification"
          />
          <QueueLink
            href="/admin/opportunities"
            title="Pending opportunities"
            count={counts.opportunities}
            hint="Review queue"
          />
          <QueueLink
            href="/admin/events"
            title="Pending events"
            count={counts.events}
            hint="Review queue"
          />
          <QueueLink
            href="/admin/vcs"
            title="Pending VCs / grants"
            count={counts.vcs}
            hint="Review queue"
          />
          <QueueLink
            href="/admin/edits"
            title="Proposed changes"
            count={counts.edits}
            hint="Edits to live listings"
          />
        </div>

        <IngestionToggle
          initial={
            ingestionStatus.ok
              ? ingestionStatus.data
              : { enabled: true, lastChangedAt: null, lastChangedBy: null }
          }
        />

        <div className="mt-12 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Quick create</p>
          <p className="text-body text-text-muted mb-4 leading-relaxed">
            Publish directly without going through the approval queue.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DiagLink href="/admin/opportunities/new" label="+ Opportunity" />
            <DiagLink href="/admin/events/new"        label="+ Event" />
            <DiagLink href="/admin/vcs/new"           label="+ VC / grant" />
          </div>
        </div>

        <div className="mt-12 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Community management</p>
          <p className="text-body text-text-muted mb-4 leading-relaxed">
            Search the full membership and remove accounts. Use the graduate cleanup once a year to roll out current students whose graduation year has passed.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DiagLink href="/admin/members" label="Member directory · search + delete" />
            <DiagLink href="/admin/graduates" label="Graduate cleanup" />
            <DiagLink href="/admin/reports" label="Reported posts · moderation queue" />
            <DiagLink href="/admin/connections" label="Connections · reports, throttles, pause" />
            <DiagLink href="/admin/banner" label="Site banner · tell members about an outage" />
            <DiagLink href="/admin/ai" label="AI · health, limits, job audiences" />
          </div>
        </div>

      </div>
    </main>
  );
}

function QueueLink({ href, title, count, hint }: { href: string; title: string; count: number; hint: string }) {
  return (
    <Link
      href={href}
      className="block bg-bg-card p-5 no-underline transition-colors duration-150 hover:bg-bg-card-hover"
    >
      <div className="flex items-start justify-between mb-1">
        <div className="text-lead font-medium text-text-primary">{title}</div>
        {count > 0 ? (
          <div className="data min-w-[1.5rem] rounded-lg bg-accent px-2 py-0.5 text-center text-small font-medium text-bg-primary">{count}</div>
        ) : (
          <div className="data px-2 py-0.5 text-body text-text-muted">0</div>
        )}
      </div>
      <div className="text-small text-text-muted">{hint}</div>
    </Link>
  );
}

function DiagLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-border-strong bg-tint-1 px-4 py-3 text-center text-body text-text-secondary no-underline transition-colors duration-150 hover:border-accent hover:bg-tint-3 hover:text-text-primary"
    >
      {label}
    </Link>
  );
}
