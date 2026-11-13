import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { posterName } from "@/lib/data/profiles";
import EventForm from "./EventForm";

export default async function NewEventPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const poster = await posterName(supabase, user.id);
  if (!poster) redirect("/login");

  return (
    <AppShell active="events" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[720px] mx-auto">
          <div className="mb-8 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Post an event</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              Share an event with the network
            </h1>
            <p className="text-body text-text-muted mt-3 leading-relaxed">
              Submissions go to the admin queue for review before they appear on the Events tab.
            </p>
          </div>

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
