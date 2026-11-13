import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { requireApprovedUser } from "@/lib/auth/guard";
import { MESSAGING_ENABLED } from "@/lib/features";

// ════════════════════════════════════════════════════════════════════
// Foundry · Messaging (not yet)
//
// A placeholder with the rail around it, gated the same way every other
// member page is: an approved-only route that happens to have nothing
// behind it yet is still an approved-only route.
//
// It says what is coming and offers the two things members would have
// come here to do in the meantime, rather than being a dead end with a
// nice heading on it. Drawn as the system draws "nothing here yet": the
// speech bubble in its ring with the one amber body on its orbit.
// ════════════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "Messaging",
  robots: { index: false, follow: false },
};

export default async function MessagingPage() {
  // Hidden until messaging is built (B18). 307 via redirect(), so nothing
  // caches the hop and restoring the page needs no cache purge.
  if (!MESSAGING_ENABLED) redirect("/home");
  const { isAdmin, displayName } = await requireApprovedUser();

  return (
    <AppShell active="messaging" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[720px]">
          <PageHead
            context="Messaging"
            title="Coming Soon!"
            lede="Member-to-member messaging is being built. Soon you will be able to reach anyone in the directory from here — introductions, questions about a role, or a note to someone building in your space — without leaving Foundry."
          />

          <div className="mt-8">
            <EmptyState
              icon="messaging"
              action={
                <>
                  <ButtonLink href="/members" variant="primary" size="md">
                    Browse members
                    <Icon name="arrow-right" size={16} />
                  </ButtonLink>
                  <ButtonLink href="/opportunities" variant="ghost" size="md">
                    See opportunities
                  </ButtonLink>
                </>
              }
            >
              Until then, member profiles carry the contact links people have chosen to
              share, and every opportunity lists how to apply.
            </EmptyState>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
