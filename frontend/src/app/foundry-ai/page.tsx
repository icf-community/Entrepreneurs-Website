import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { aiState } from "@/lib/ai/data";
import type { AiMode } from "@/lib/ai/types";
import FoundryAiClient from "./FoundryAiClient";

// Foundry AI (AI-plan §12, F11). While every AI flag is off this stays the
// "Coming soon" placeholder; it becomes the AI page when a mode ships.
// Flags are read live from the database, so switching a mode on or off is
// an operator action, not a deploy.

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FoundryAiPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; job?: string; c?: string; draft?: string }>;
}) {
  const { isAdmin, displayName, supabase, status } = await requireApprovedUser();
  const sp = await searchParams;
  // aiState() already carries every mode's flag, so one call replaces the three
  // ai_mode_enabled reads anyAiModeEnabled made.
  const state = status === "approved" ? await aiState(supabase) : null;
  const enabled = !!state && Object.values(state.enabled).some(Boolean);

  return (
    <AppShell active="foundryAi" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[1100px] mx-auto">
          <div className="mb-8 rule-draw pt-4">
            <p className="label-wide text-text-muted mb-6">Foundry AI</p>
            {enabled ? (
              <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3vw,2.5rem)]">
                Search the network
              </h1>
            ) : (
              <>
                <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3vw,2.5rem)]">
                  Coming soon
                </h1>
                <p className="text-[0.875rem] text-text-muted mt-3 leading-relaxed">
                  We&apos;re building this. Check back soon.
                </p>
              </>
            )}
          </div>
          {enabled && (
            <FoundryAiClient
              state={state}
              initialMode={(["recruiter", "network", "opportunities"].includes(sp.mode ?? "") ? sp.mode : "network") as AiMode}
              initialJobId={sp.job && UUID.test(sp.job) ? sp.job : null}
              initialConversationId={sp.c && UUID.test(sp.c) ? sp.c : null}
              initialDraftId={sp.draft && UUID.test(sp.draft) ? sp.draft : null}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
