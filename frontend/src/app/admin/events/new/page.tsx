import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable } from "@/lib/supabase/unavailable";
import { posterName } from "@/lib/data/profiles";
import EventForm from "@/app/events/new/EventForm";

export default async function AdminNewEventPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  throwIfAuthUnreachable("session", authError);
  if (!user) redirect("/login");

  const poster = await posterName(supabase, user.id);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[720px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · direct publish</p>
            <h1 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.1] tracking-tight">
              New event
            </h1>
            <p className="text-[0.85rem] text-text-muted mt-2">
              Skips the approval queue — published immediately.
            </p>
          </div>
          <Link href="/admin/events" className="text-[0.8rem] text-text-secondary no-underline hover:text-text-primary">
            ← Back to queue
          </Link>
        </div>

        <EventForm
          signupEmail={user.email ?? ""}
          defaultOrganiser={poster?.displayName ?? ""}
          mode="admin"
        />
      </div>
    </main>
  );
}
