"use client";

import { useState } from "react";
import { MemberDialog } from "./MemberDialog";
import { MemberCard } from "./MemberCard";
import { Section } from "@/components/ui/Section";
import type { DirectoryMember } from "@/lib/data/directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · "Some of our newest members…"
//
// Was a block inside members/MembersClient. It lives on /home now, which
// is a server component — so the strip carries its own dialog state
// rather than borrowing the directory's. The markup is unchanged: this
// is the same strip, not a second one that looks like it. Each person is a
// tile (a ring, a name, who they are) that opens the same profile dialog the
// directory does.
// ════════════════════════════════════════════════════════════════════

export default function NewestMembers({ newest }: { newest: DirectoryMember[] }) {
  const [openMember, setOpenMember] = useState<DirectoryMember | null>(null);

  return (
    <>
      {newest.length > 0 && (
        <Section
          title="Some of our newest members…"
          actions={<span className="data text-small text-text-muted">{newest.length} just joined</span>}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {newest.map((m) => <MemberCard key={m.id} member={m} dense onClick={() => setOpenMember(m)} />)}
          </div>
        </Section>
      )}

      {openMember && (
        <MemberDialog member={openMember} onClose={() => setOpenMember(null)} />
      )}
    </>
  );
}
