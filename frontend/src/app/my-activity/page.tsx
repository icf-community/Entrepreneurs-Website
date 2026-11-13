import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myActivity } from "@/lib/data/activity";
import MyActivityClient from "./MyActivityClient";

export default async function MyActivityPage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();

  const items = await myActivity(supabase);

  return (
    <AppShell active="activity" name={displayName} isAdmin={isAdmin}>
      <div className="px-6 sm:px-8 py-12">
        <div className="max-w-[820px] mx-auto">
          <div className="mb-8 rule-draw pt-4">
            <p className="label-wide text-text-muted mb-6">Your activity</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              Things you&apos;ve applied to or are going to
            </h1>
            <p className="text-body text-text-muted mt-3 leading-relaxed">
              Every opportunity and VC/grant you&apos;ve marked as applied, plus every event you&apos;re going to. We take your word for it — there&apos;s no verification against the apply or RSVP site. Use the toggle to unmark.
            </p>
          </div>
          <MyActivityClient items={items} />
        </div>
      </div>
    </AppShell>
  );
}
