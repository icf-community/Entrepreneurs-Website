"use client";

import { useEffect, useState } from "react";
import SocialLinks from "@/components/SocialLinks";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { browserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConnectControl } from "@/components/connections/ConnectControl";
import { MemberPhoto } from "./MemberPhoto";
import { memberSubtitle } from "./memberSubtitle";
import type { DirectoryMember } from "@/lib/data/directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · The member profile dialog, and the subtitle line it shares
// with every card that can open it.
//
// Lifted out of members/MembersClient when /home grew its own strip of
// member cards. Two copies of a dialog that fetches a profile is exactly
// the duplication lib/data/query.ts was written to stop; this is the
// same argument one layer up.
//
// The person comes first: their ring (lit, they are the chosen one) beside the
// name, then what they are working on, what they are looking for, their
// interests and skills and their links. The Close ring is the dialog's one
// "Close" (dialog.spec clicks it by name), and Escape and a press outside close
// it too, all handing focus back to the card that opened it.
// ════════════════════════════════════════════════════════════════════

const MAX_LOOKING_FOR = 3;

// The fields the list deliberately doesn't carry.
type FullProfile = {
  bio_focus: string | null;
  bio_hobbies: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
};

// Fetched on open rather than shipped with the list. A plain select, not an
// RPC: the profiles RLS policies already restrict reads to approved
// members, so there is nothing extra to enforce here.
function useFullProfile(memberId: string) {
  const [full, setFull] = useState<FullProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by "Try again" (B8): a failed load used to just leave out the
  // full text and links, with no sign anything was missing.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    browserClient()
      .from("profiles")
      .select("bio_focus, bio_hobbies, linkedin_url, github_url, portfolio_url")
      .eq("id", memberId)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (cancelled) return;
          if (error || !data) {
            console.error("Failed to load profile details:", error);
            setLoadFailed(true);
            return;
          }
          setFull(data as FullProfile);
        },
        // PromiseLike (the lazy Supabase builder), not a real Promise — no
        // .catch(), but the two-arg .then() rejection handler works the
        // same way. Without this, an actual thrown rejection (as opposed
        // to a Postgrest-shaped {error}) left the dialog's skeleton
        // spinning forever with no error state ever set.
        (error: unknown) => {
          if (cancelled) return;
          console.error("Failed to load profile details:", error);
          setLoadFailed(true);
        },
      );
    return () => { cancelled = true; };
  }, [memberId, attempt]);

  const retry = () => { setLoadFailed(false); setAttempt((n) => n + 1); };
  return { full, loadFailed, retry };
}

export function MemberDialog({ member: m, onClose }: { member: DirectoryMember; onClose: () => void }) {
  const { full, loadFailed, retry } = useFullProfile(m.id);

  return (
    <Dialog
      onClose={onClose}
      label={`Profile of ${m.firstName} ${m.surname}`}
      className="my-auto w-full max-w-[38rem]"
    >
      <DialogClose className="absolute right-4 top-4 z-10" />

      {/* On a phone the ring sits above the name, so a long name has the whole width; beside it from sm up. */}
      <header className="flex flex-col items-start gap-4 px-6 pb-6 pt-7 sm:flex-row sm:items-center sm:gap-5 sm:px-8 sm:pr-20 sm:pt-8">
        <MemberPhoto member={m} size="xl" lit />
        <div className="min-w-0">
          <h2 className="break-words font-display text-heading text-text-primary">
            {m.firstName} {m.surname}
          </h2>
          <p className="mt-1.5 text-small text-text-muted">{memberSubtitle(m)}</p>
          {m.course && <p className="mt-1 text-body text-text-secondary">{m.course}</p>}
        </div>
      </header>

      <div className="grid gap-6 border-t border-border-subtle px-6 py-6 sm:px-8">
        {loadFailed && <LoadFailedBanner onRetry={retry} />}
        {/* While the full text loads, show the preview the card already has
            rather than an empty box — the dialog opens with content, and the
            untruncated version replaces it in place. */}
        <BioSection
          title="Working on"
          text={full?.bio_focus ?? m.bioPreview}
          showSkeleton={!full && !loadFailed}
        />
        <BioSection title="Outside of that" text={full?.bio_hobbies ?? m.hobbiesPreview} />

        <LookingForSection lookingFor={m.lookingFor} />
        <TagSection title="Interests" items={m.sectors} prefix="sec" tone="info" />
        <TagSection title="Skills & expertise" items={m.skills} prefix="skl" tone="neutral" />

        {full && <LinksSection full={full} />}

        {/* The dialog's one mutating control, and the only place a
            connection request starts. It takes no session props — it asks
            connection_state_with, which answers `self` for your own
            profile — so every call site that opens this dialog is
            unchanged. */}
        <ConnectControl memberId={m.id} firstName={m.firstName} surname={m.surname} />

        {/* Only claim the profile is empty once we know: the links and the
            full text arrive after the dialog opens. */}
        {full && isProfileEmpty(full, m) && (
          <p className="text-body italic text-text-muted">
            No additional details on this profile yet.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function LoadFailedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      action={
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p role="alert">Couldn&apos;t load the full profile.</p>
    </Notice>
  );
}

function BioSection({ title, text, showSkeleton }: { title: string; text: string | null | undefined; showSkeleton?: boolean }) {
  if (!text) return null;
  return (
    <section className="grid gap-2">
      <div className="label-wide text-text-muted">{title}</div>
      <p className="whitespace-pre-wrap text-body text-text-secondary">{text}</p>
      {showSkeleton && <Skeleton className="mt-1 h-3 w-2/3" />}
    </section>
  );
}

function LinksSection({ full }: { full: FullProfile }) {
  if (!full.linkedin_url && !full.github_url && !full.portfolio_url) return null;
  return (
    <section className="grid gap-2 border-t border-border-subtle pt-5">
      <div className="label-wide text-text-muted">Links</div>
      <SocialLinks
        linkedinUrl={full.linkedin_url}
        githubUrl={full.github_url}
        portfolioUrl={full.portfolio_url}
      />
    </section>
  );
}

function isProfileEmpty(full: FullProfile, m: DirectoryMember) {
  return !full.bio_focus && !full.bio_hobbies && m.sectors.length === 0 && m.skills.length === 0
    && m.lookingFor.length === 0 && !full.linkedin_url && !full.github_url && !full.portfolio_url;
}

function LookingForSection({ lookingFor }: { lookingFor: DirectoryMember["lookingFor"] }) {
  if (lookingFor.length === 0) return null;
  return (
    <section className="grid gap-2">
      <div className="label-wide text-text-muted">Looking for</div>
      <div className="flex flex-wrap gap-2">
        {lookingFor.slice(0, MAX_LOOKING_FOR).map((lf) => (
          <ButtonLink key={lf.id} href={`/opportunities/${lf.id}`} variant="ghost" size="sm" className="min-w-0 max-w-full">
            <span className="truncate">{lf.role}</span>
          </ButtonLink>
        ))}
      </div>
    </section>
  );
}

// Shared shape for the two plain-text chip lists (sectors, skills) that
// differ only in heading and tone.
function TagSection({
  title, items, prefix, tone,
}: {
  title: string;
  items: string[];
  prefix: string;
  tone: "info" | "neutral";
}) {
  if (items.length === 0) return null;
  return (
    <section className="grid gap-2">
      <div className="label-wide text-text-muted">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((s) => (
          <Badge key={`${prefix}-${s}`} tone={tone}>
            {s}
          </Badge>
        ))}
      </div>
    </section>
  );
}
