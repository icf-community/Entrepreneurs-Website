import { posterName } from "@/lib/data/profiles";
import EventForm from "@/app/events/new/EventForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";

export default async function AdminNewEventPage() {
  const { supabase, user } = await requireAdminPage();

  const poster = await posterName(supabase, user.id);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] py-10 sm:py-12 text-text-primary">
      <div className="mx-auto max-w-[720px]">
        <PageHead
          className="mb-8"
          context="Admin · direct publish"
          title="New event"
          lede="Skips the approval queue — published immediately."
          actions={
            <ButtonLink href="/admin/events" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={18} />}>
              Back to queue
            </ButtonLink>
          }
        />

        <EventForm
          signupEmail={user.email ?? ""}
          defaultOrganiser={poster?.displayName ?? ""}
          mode="admin"
        />
      </div>
    </main>
  );
}
