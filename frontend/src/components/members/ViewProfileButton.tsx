"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { getMemberCard } from "@/app/members/actions";
import type { DirectoryMember } from "@/lib/data/directory";
import { MemberDialog } from "./MemberDialog";

/**
 * "View profile" for a member reached from outside the directory list: a
 * job's "Posted by" row, an AI result (AI-plan §2, §12). Opens the same
 * MemberDialog the directory uses; Connect lives only in there, one
 * control per open dialog (F16), never on the card itself.
 */
export function ViewProfileButton({ memberId, label = "View profile" }: { memberId: string; label?: string }) {
  const [member, setMember] = useState<DirectoryMember | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const open = async () => {
    setLoading(true);
    try {
      const res = await getMemberCard(memberId);
      if (res.ok) setMember(res.data);
      else toast(res.error, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button type="button" variant="ghost" size="sm" loading={loading} onClick={open}>
        {label}
      </Button>
      {member && <MemberDialog member={member} onClose={() => setMember(null)} />}
    </>
  );
}
