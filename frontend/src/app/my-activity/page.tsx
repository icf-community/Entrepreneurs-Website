import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { InfoTip } from "@/components/ui/Tooltip";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myActivity } from "@/lib/data/activity";
import MyActivityClient from "./MyActivityClient";

export default async function MyActivityPage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();

  const items = await myActivity(supabase);

  return (
    <AppShell active="activity" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[44rem]">
          <PageHead
            context="Your activity"
            title="Things you've applied to or are going to"
            className="mb-8"
            lede={
              <>
                Every opportunity and VC/grant you&apos;ve marked as applied, plus every event you&apos;re going to.{" "}
                {/* How the list is kept honest sits one press away: the same words, out of the masthead. */}
                <InfoTip label="How this list works">
                  We take your word for it — there&apos;s no verification against the apply or RSVP site. Use the toggle to unmark.
                </InfoTip>
              </>
            }
          />
          <MyActivityClient items={items} />
        </div>
      </div>
    </AppShell>
  );
}
