"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Entry } from "@/components/ui/Entry";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { FieldError } from "@/components/forms/Field";
import { unblockMember } from "@/app/connections/actions";
import { SettingsSection } from "./SettingsSection";

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const failed = (e: unknown) => {
      if (cancelled) return;
      // B4: this used to render nothing, which reads as "you haven't blocked
      // anyone" and hides the only way to unblock. Say it failed instead.
      console.error("Failed to load blocked members:", e);
      setLoadFailed(true);
    };
    browserClient()
      .rpc("list_my_blocked_members")
      .then(
        ({ data, error: e }) => {
          if (e) return failed(e);
          if (cancelled) return;
          setLoadFailed(false);
          setList((data ?? []) as Blocked[]);
        },
        failed,
      );
    return () => { cancelled = true; };
  }, [attempt]);

  async function unblock(id: string) {
    setBusy((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await unblockMember({ memberId: id });
      if (!res.ok) { setError(res.error); return; }
      setList((prev) => (prev ?? []).filter((b) => b.member_id !== id));
    } catch {
      setError("Couldn't unblock right now. Please try again.");
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (loadFailed) {
    return (
      <SettingsSection title="Blocked members">
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setLoadFailed(false); setAttempt((n) => n + 1); }}
            >
              Try again
            </Button>
          }
        >
          Couldn&apos;t load the people you&apos;ve blocked.
        </Notice>
      </SettingsSection>
    );
  }

  // Nothing at all while loading, and nothing when empty. A permanent
  // "You haven't blocked anyone" card is a prompt to consider blocking
  // somebody, on a page nobody opened for that.
  if (!list || list.length === 0) return null;

  return (
    <SettingsSection
      title="Blocked members"
      description={
        <>
          They can&apos;t send you connection requests, and they were never told. Unblocking
          does not restore a connection you had before.
        </>
      }
    >
      <Panel size="sm" className="p-1.5">
        <ul className="grid">
          {list.map((b) => (
            <Entry
              key={b.member_id}
              as="li"
              glyph={<Avatar name={`${b.first_name} ${b.surname}`} size="md" />}
              title={
                <span className="block truncate">
                  {b.first_name} {b.surname}
                </span>
              }
              meta={b.course ? <span className="block truncate">{b.course}</span> : undefined}
              trailing={
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy.has(b.member_id)}
                  onClick={() => unblock(b.member_id)}
                  className="shrink-0"
                >
                  Unblock
                </Button>
              }
            />
          ))}
        </ul>
      </Panel>

      <FieldError>{error ?? undefined}</FieldError>
    </SettingsSection>
  );
}
