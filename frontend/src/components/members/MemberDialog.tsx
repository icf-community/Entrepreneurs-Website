"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SocialLinks from "@/components/SocialLinks";
import { Dialog, closeDialog } from "@/components/ui/Dialog";
import { browserClient } from "@/lib/supabase/browser";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConnectControl } from "@/components/connections/ConnectControl";
import { MemberPhoto } from "./MemberPhoto";
import type { DirectoryMember } from "@/lib/data/directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · The member profile dialog, and the subtitle line it shares
// with every card that can open it.
//
// Lifted out of members/MembersClient when /home grew its own strip of
// member cards. Two copies of a dialog that fetches a profile is exactly
// the duplication lib/data/query.ts was written to stop; this is the
// same argument one layer up.
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

export function MemberDialog({ member: m, onClose }: { member: DirectoryMember; onClose: () => void }) {
  // Fetched on open rather than shipped with the list. A plain select, not
  // an RPC: the profiles RLS policies already restrict reads to approved
  // members, so there is nothing extra to enforce here.
  const [full, setFull] = useState<FullProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserClient()
      .from("profiles")
      .select("bio_focus, bio_hobbies, linkedin_url, github_url, portfolio_url")
      .eq("id", m.id)
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
  }, [m.id]);

  return (
    <Dialog
      onClose={onClose}
      label={`Profile of ${m.firstName} ${m.surname}`}
      className="w-full max-w-[600px] overflow-hidden rounded-2xl bg-bg-card border border-border shadow-2xl my-auto"
    >
      <div className="relative">
        {/* object-cover at 2.4:1 on a square 512x512 avatar showed only the
            middle ~42% of it, slicing through the hairline — and no fixed
            crop position is right for every avatar (headroom varies,
            tight crops, off-centre, non-face avatars). object-contain
            never cuts anything off, for any avatar, at the cost of
            letterboxing left/right on bg-bg-secondary. */}
        <MemberPhoto member={m} aspect="aspect-[16/10]" fit="contain" />
        <button
          type="button"
          onClick={closeDialog}
          aria-label="Close"
          className="absolute top-3 right-3 shrink-0 w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer border-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <header className="px-7 pt-5 pb-4 border-b border-border-subtle">
        <h2 className="font-display text-[1.4rem] text-text-primary tracking-tight truncate">
          {m.firstName} {m.surname}
        </h2>
        <div className="text-[0.75rem] text-text-muted mt-1">{memberSubtitle(m)}</div>
        {m.course && (
          <div className="text-[0.8rem] text-text-secondary mt-1">{m.course}</div>
        )}
      </header>

      <div className="px-7 py-5 space-y-5">
        {/* While the full text loads, show the preview the card already has
            rather than an empty box — the dialog opens with content, and the
            untruncated version replaces it in place. */}
        {(full?.bio_focus ?? m.bioPreview) && (
          <section>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-1.5">Working on</div>
            <p className="text-[0.85rem] text-text-secondary leading-relaxed whitespace-pre-wrap">
              {full?.bio_focus ?? m.bioPreview}
            </p>
            {!full && !loadFailed && <Skeleton className="h-3 w-2/3 mt-2" />}
          </section>
        )}

        {(full?.bio_hobbies ?? m.hobbiesPreview) && (
          <section>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-1.5">Outside of that</div>
            <p className="text-[0.85rem] text-text-secondary leading-relaxed whitespace-pre-wrap">
              {full?.bio_hobbies ?? m.hobbiesPreview}
            </p>
          </section>
        )}

        {m.lookingFor.length > 0 && (
          <section>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-2">Looking for</div>
            <div className="flex flex-wrap gap-1.5">
              {m.lookingFor.slice(0, MAX_LOOKING_FOR).map((lf) => (
                <Link
                  key={lf.id}
                  href={`/opportunities/${lf.id}`}
                  className="rounded-lg border border-border-strong px-2.5 py-1 text-[0.725rem] text-text-primary no-underline transition-colors hover:border-accent hover:bg-white/[0.06]"
                >
                  {lf.role}
                </Link>
              ))}
            </div>
          </section>
        )}

        {m.sectors.length > 0 && (
          <section>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-2">Interests</div>
            <div className="flex flex-wrap gap-1.5">
              {m.sectors.map((s) => (
                <span key={`sec-${s}`} className="px-2.5 py-1 rounded-lg text-[0.725rem] bg-accent-muted text-accent-light border border-accent/20">
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {m.skills.length > 0 && (
          <section>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-2">Skills &amp; expertise</div>
            <div className="flex flex-wrap gap-1.5">
              {m.skills.map((s) => (
                <span key={`skl-${s}`} className="px-2.5 py-1 rounded-lg text-[0.725rem] bg-white/[0.03] text-text-secondary border border-border">
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {full && (full.linkedin_url || full.github_url || full.portfolio_url) && (
          <section className="pt-3 border-t border-border-subtle">
            <div className="text-[0.7rem] text-text-muted uppercase tracking-wider mb-2">Links</div>
            <SocialLinks
              linkedinUrl={full.linkedin_url}
              githubUrl={full.github_url}
              portfolioUrl={full.portfolio_url}
            />
          </section>
        )}

        {/* The dialog's one mutating control, and the only place a
            connection request starts. It takes no session props — it asks
            connection_state_with, which answers `self` for your own
            profile — so every call site that opens this dialog is
            unchanged. */}
        <ConnectControl memberId={m.id} firstName={m.firstName} />

        {/* Only claim the profile is empty once we know: the links and the
            full text arrive after the dialog opens. */}
        {full && !full.bio_focus && !full.bio_hobbies && m.sectors.length === 0 && m.skills.length === 0
          && m.lookingFor.length === 0 && !full.linkedin_url && !full.github_url && !full.portfolio_url && (
          <p className="text-[0.85rem] text-text-muted italic">
            No additional details on this profile yet.
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function memberSubtitle(m: DirectoryMember) {
  if (m.role === "alum") return `Alum · ${m.gradYear ?? "—"}`;
  return m.gradYear ? `Student · class of ${m.gradYear}` : "Imperial student";
}
