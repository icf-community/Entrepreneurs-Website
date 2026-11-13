import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { posterName } from "@/lib/data/profiles";
import EventForm from "./EventForm";

export default async function NewEventPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const poster = await posterName(supabase, user.id);
  if (!poster) redirect("/login");

  return (
    <AppShell active="events" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[820px]">
          <PageHead
            className="mb-8"
            context="Post an event"
            title="Share an event with the network"
            lede="Submissions go to the admin queue for review before they appear on the Events tab."
          />

          <EventForm
            signupEmail={user.email ?? ""}
            defaultOrganiser={poster.displayName}
            mode="user"
          />
        </div>
      </div>
    </AppShell>
  );
}
