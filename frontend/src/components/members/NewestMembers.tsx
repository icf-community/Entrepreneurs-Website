"use client";

import { useState } from "react";
import { MemberDialog } from "./MemberDialog";
import { MemberCard } from "./MemberCard";
import type { DirectoryMember } from "@/lib/data/directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · "Some of our newest members…"
//
// Was a block inside members/MembersClient. It lives on /home now, which
// is a server component — so the strip carries its own dialog state
// rather than borrowing the directory's. The markup is unchanged: this
// is the same strip, not a second one that looks like it.
// ════════════════════════════════════════════════════════════════════

export default function NewestMembers({ newest }: { newest: DirectoryMember[] }) {
  const [openMember, setOpenMember] = useState<DirectoryMember | null>(null);

  return (
    <>
      {newest.length > 0 && (
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-text-primary text-title tracking-tight">
              Some of our newest members…
            </h2>
            <span className="text-small text-text-muted">{newest.length} just joined</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {newest.map((m) => <MemberCard key={m.id} member={m} dense onClick={() => setOpenMember(m)} />)}
          </div>
        </section>
      )}

      {openMember && (
        <MemberDialog member={openMember} onClose={() => setOpenMember(null)} />
      )}
    </>
  );
}
