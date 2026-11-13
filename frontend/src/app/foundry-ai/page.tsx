import AppShell from "@/components/app/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
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
const MODES = ["recruiter", "network", "opportunities"];

const uuidOrNull = (v: string | undefined) => (v && UUID.test(v) ? v : null);
const modeOf = (v: string | undefined) => (MODES.includes(v ?? "") ? v : "network") as AiMode;

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
      <div className="px-[var(--gutter)] py-10 sm:py-12">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHead className="mb-8" context="Foundry AI" title={enabled ? "Search the network" : "Coming soon"} />
          {enabled ? (
            <FoundryAiClient
              state={state}
              initialMode={modeOf(sp.mode)}
              initialJobId={uuidOrNull(sp.job)}
              initialConversationId={uuidOrNull(sp.c)}
              initialDraftId={uuidOrNull(sp.draft)}
            />
          ) : (
            <EmptyState icon="foundry-ai">We&apos;re building this. Check back soon.</EmptyState>
          )}
        </div>
      </div>
    </AppShell>
  );
}
