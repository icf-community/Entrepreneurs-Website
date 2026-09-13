import ListingDetailShell, {
  ListingGone, Fact, Description,
} from "@/components/ListingDetailShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { approvedVc } from "@/lib/data/vcs";
import { formatDate } from "@/lib/dates";
import VcActions from "./VcActions";
import { hasPendingRevision, PendingRevisionNotice } from "@/components/PendingRevisionNotice";

// ════════════════════════════════════════════════════════════════════
// Foundry · One VC or grant
//
// Sibling of /opportunities/[id] and /events/[id] — same shell, same
// shape, same contract. The old /vcs?v=<id> deep link redirects here.
//
// Unlike the other two there is no expiry rule in the query: a fund stays
// listed until it is unapproved or deleted, so the "gone" body here means
// exactly that rather than "the deadline passed".
// ════════════════════════════════════════════════════════════════════

const BACK = { href: "/vcs", label: "All grants & VCs" };

type Params = { id: string };

export default async function VcPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const { supabase, isAdmin } = await requireApprovedUser();

  const v = await approvedVc(supabase, id);

  if (!v) {
    return (
      <ListingDetailShell
        active="vcs"
        isAdmin={isAdmin}
        backHref={BACK.href}
        backLabel={BACK.label}
        eyebrow="Grants & VCs"
        title="This listing is no longer available"
      >
        <ListingGone kind="VC/grant" backHref={BACK.href} backLabel="Browse grants & VCs" />
      </ListingDetailShell>
    );
  }

  const [appliedIds, revisionPending] = await Promise.all([
    markedIds(supabase, "vc_grant", "applied"),
    hasPendingRevision(supabase, "vc_grant", id),
  ]);

  const kindLabel = v.kind === "vc" ? "VC" : "Grant";
  const posterName = `${v.postedBy.firstName} ${v.postedBy.surname}`.trim();
  const deadlineLabel = v.deadline ? formatDate(v.deadline) : "Rolling applications";

  return (
    <ListingDetailShell
      active="vcs"
      isAdmin={isAdmin}
      backHref={BACK.href}
      backLabel={BACK.label}
      eyebrow="Grants & VCs"
      title={v.name}
      meta={[kindLabel, v.amount, v.stage, deadlineLabel].filter(Boolean).join(" · ")}
    >
      {revisionPending && <PendingRevisionNotice noun="listing" />}

      <Description text={v.description} />

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Fact label="Kind">{kindLabel}</Fact>
        <Fact label="Deadline">{deadlineLabel}</Fact>
        <Fact label="Amount">{v.amount}</Fact>
        <Fact label="Stage">{v.stage}</Fact>
        <Fact label="Posted by">{posterName}</Fact>
      </div>

      <div className="mt-9 border-t border-border-subtle pt-7">
        <h2 className="mb-3 text-[0.7rem] uppercase tracking-wider text-text-muted">Apply</h2>
        <VcActions vc={v} applied={appliedIds.includes(v.id)} />
      </div>
    </ListingDetailShell>
  );
}
