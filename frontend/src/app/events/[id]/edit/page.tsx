import { isUuid } from "@/lib/uuid";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { requireApprovedUser } from "@/lib/auth/guard";
import { posterName } from "@/lib/data/profiles";
import { listingEditSnapshot } from "@/lib/listings/editSnapshot";
import EventForm, { type EventInitialValues } from "../../new/EventForm";
import { EditStatusNote, QueuedRevisionBanner } from "@/components/forms/EditStatusNote";

type Params = { id: string };

// Convert a UTC timestamp from Postgres to the value="…" string the
// <input type="datetime-local"> control wants, in the browser's local
// tz. We do this server-side as a best effort using the request's
// implicit tz (UTC on Vercel) — the user re-edits the field anyway.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export default async function EditEventPage({ params }: { params: Promise<Params> }) {
  const [{ id }, { supabase, user, isAdmin, displayName }] = await Promise.all([
    params,
    requireApprovedUser(),
  ]);

  // A malformed id is a 404, not an RPC call that raises 22P02.
  if (!isUuid(id)) notFound();

  // Need first/last for the organiser default. Guard only returned status,
  // so re-query the two extra columns. Independent of the snapshot lookup
  // below, so both run concurrently.
  //
  // The RPC checks caller = poster, so a listing someone else posted
  // comes back empty and 404s here. Status still gates editability.
  const [poster, snapshot] = await Promise.all([
    posterName(supabase, user.id),
    listingEditSnapshot(supabase, "event", id),
  ]);
  if (!poster) notFound();

  const row = snapshot?.row;
  if (!row) notFound();
  // Rejected and expired listings stay closed — there is nothing
  // published to revise. Approved ones are editable now, through the
  // review path (20260907000005).
  if (row.status !== "pending" && row.status !== "approved") notFound();

  // When a revision is already queued, the form starts from *that*, not
  // from the live row — otherwise opening the page and saving would
  // silently throw away the change still waiting for review.
  const revision = snapshot?.revision;
  const src = { ...row, ...(revision?.proposed ?? {}) };

  const initialValues: EventInitialValues = {
    title:               String(src.title),
    description:         String(src.description),
    lumaLink:            String(src.luma_link),
    eventAt:             toDatetimeLocal(String(src.event_at)),
    location:            String(src.location),
    organiserName:       String(src.organiser_name),
    contactEmail:        String(src.contact_email),
    contactEmailVisible: Boolean(src.contact_email_visible),
  };

  const defaultOrganiser = poster.displayName;

  return (
    <AppShell active="events" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[820px]">
          <PageHead
            className="mb-8"
            context={
              <>
                {/* The arrow is drawn; the character stays as hidden text so the link's name is still "← Your submissions". */}
                <Link href="/my-submissions" className="inline-flex items-center gap-1.5">
                  <Icon name="arrow-left" size={16} />
                  <span className="sr-only">← </span>
                  Your submissions
                </Link>
                <span aria-hidden="true">/</span>
                Edit event
              </>
            }
            title={row.title}
            lede={<EditStatusNote status={row.status} noun="event" />}
          />
          {revision && <QueuedRevisionBanner queuedAt={revision.createdAt} />}
          <EventForm
            signupEmail={user.email ?? ""}
            defaultOrganiser={defaultOrganiser}
            mode="user"
            editingId={id}
            editVersion={row.edit_version}
            initialValues={initialValues}
            reviewOnSave={row.status === "approved"}
          />
        </div>
      </div>
    </AppShell>
  );
}
