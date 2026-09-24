"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { unblockMember } from "@/app/connections/actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · Who you have blocked
//
// Blocking is silent, permanent and reversible only by the blocker — so
// without this list the only route back was finding the person again in
// a directory of thousands, which is exactly the search a blocker should
// not have to perform.
//
// It shows ONLY people you blocked, never people who blocked you. A
// member must not be able to learn they have been blocked; that is the
// same guarantee every refusal message in this feature preserves, and
// list_my_blocked_members has no counterpart for the other direction.
//
// Fetched from the browser rather than on the server render: it is
// nearly always empty, and making /settings wait on a query that returns
// nothing for almost everybody is the wrong trade.
// ════════════════════════════════════════════════════════════════════

type Blocked = {
  member_id: string;
  first_name: string;
  surname: string;
  course: string | null;
};

export default function BlockedMembers() {
  const [list, setList] = useState<Blocked[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserClient()
      .rpc("list_my_blocked_members")
      .then(
        ({ data, error: e }) => {
          if (cancelled) return;
          // A read failure renders nothing rather than an error card. The
          // section is empty for almost every member, so "nothing here"
          // is both the honest fallback and the usual answer.
          if (e) { console.error("Failed to load blocked members:", e); setList([]); return; }
          setList((data ?? []) as Blocked[]);
        },
        (e: unknown) => {
          if (cancelled) return;
          console.error("Failed to load blocked members:", e);
          setList([]);
        },
      );
    return () => { cancelled = true; };
  }, []);

  async function unblock(id: string) {
    setBusy(id);
    setError(null);
    const res = await unblockMember({ memberId: id });
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setList((prev) => (prev ?? []).filter((b) => b.member_id !== id));
  }

  // Nothing at all while loading, and nothing when empty. A permanent
  // "You haven't blocked anyone" card is a prompt to consider blocking
  // somebody, on a page nobody opened for that.
  if (!list || list.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-6">
      <h2 className="text-[0.95rem] font-medium text-text-primary">Blocked members</h2>
      <p className="mt-1 text-[0.75rem] text-text-muted leading-relaxed">
        They can&apos;t send you connection requests, and they were never told. Unblocking
        does not restore a connection you had before.
      </p>

      <ul className="mt-4 space-y-2">
        {list.map((b) => (
          <li
            key={b.member_id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-[0.85rem] text-text-primary">
                {b.first_name} {b.surname}
              </div>
              {b.course && (
                <div className="truncate text-[0.725rem] text-text-muted">{b.course}</div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              loading={busy === b.member_id}
              onClick={() => unblock(b.member_id)}
              className="shrink-0"
            >
              Unblock
            </Button>
          </li>
        ))}
      </ul>

      {error && <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>}
    </section>
  );
}
