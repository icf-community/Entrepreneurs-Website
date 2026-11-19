"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/design-system/icons/Icon";

// ════════════════════════════════════════════════════════════════════
// Foundry · The head of the Community pages, and the composer's open state
//
// "Create a post" sits in the page head, as the create button does on /events and /opportunities, and the composer it opens sits below
// the head, so the button and the composer are in different parts of the tree. This holds the one boolean they share: the page wraps
// its head and its body in <ComposerProvider>, the head takes <CommunityHeadActions> as its `actions`, and the body reads the state with
// useComposer(). PageHead stays a server component.
//
// The head's order is the tab order a11y.spec drives (the button, then the Title field of the composer), so the button is last in the head and the
// composer is the next thing in the DOM. /community/mine has no composer (it never had one): its head holds only the switch back to the feed.
// ════════════════════════════════════════════════════════════════════

type ComposerState = { open: boolean; setOpen: Dispatch<SetStateAction<boolean>> };

const ComposerContext = createContext<ComposerState | null>(null);

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

export function useComposer(): ComposerState {
  const state = useContext(ComposerContext);
  if (!state) throw new Error("useComposer must be used inside <ComposerProvider>");
  return state;
}

/** The feed's head: the switch to My posts, then the button that opens the composer. */
export function CommunityHeadActions() {
  const { open, setOpen } = useComposer();
  return (
    <>
      <ButtonLink href="/community/mine" variant="ghost" size="md">
        My posts
      </ButtonLink>
      <Button
        variant={open ? "ghost" : "primary"}
        size="md"
        lit={!open}
        leading={open ? undefined : <Icon name="plus" size={18} />}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Cancel" : "Create a post"}
      </Button>
    </>
  );
}
