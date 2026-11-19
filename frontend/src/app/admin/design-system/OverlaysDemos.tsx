"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { Entry } from "@/components/ui/Entry";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Menu, MenuItem, MenuSeparator, Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { ToastView, useToast } from "@/components/ui/Toast";
import { InfoTip, Tooltip } from "@/components/ui/Tooltip";
import { ListingGoneNotice } from "@/components/ListingGoneNotice";
import { SegmentErrorView } from "@/components/SegmentError";
import { Icon } from "@/design-system/icons/Icon";

// ════════════════════════════════════════════════════════════════════
// The interactive half of the "Overlays and feedback" section of the style
// guide (OverlaysGallery.tsx). Each export is a small client component because
// it holds the state of something that opens: a dialog, a drawer, a popover, a
// toast. They use the real components with real copy, so what you open here is
// what a page gets.
// ════════════════════════════════════════════════════════════════════

type DialogKind = "confirm" | "danger";

export function DialogDemo() {
  const [kind, setKind] = useState<DialogKind | null>(null);
  const close = useCallback(() => setKind(null), []);
  return (
    <>
      <Button variant="ghost" size="md" onClick={() => setKind("confirm")}>
        Open a confirmation
      </Button>
      <Button variant="dangerGhost" size="md" onClick={() => setKind("danger")}>
        Open a danger dialog
      </Button>
      {kind === "confirm" && (
        <Dialog label="Connect with Elena Petrova?" onClose={close} className="w-full max-w-[30rem] p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-display text-title text-text-primary">Connect with Elena Petrova?</h2>
            <DialogClose className="-mr-2 -mt-2" />
          </div>
          <p className="mt-3 text-body text-text-secondary">
            If she accepts, you will each be able to see the other&apos;s email address. You can withdraw the request until she does.
          </p>
          <p className="mt-4 inline-flex items-center gap-2 text-small text-text-muted">
            Who sees my request?
            <InfoTip label="About who sees your request" placement="bottom">
              Only Elena. Nobody else is told until she accepts.
            </InfoTip>
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="quiet" size="md" onClick={closeDialog}>
              Cancel
            </Button>
            <Button size="md" onClick={closeDialog}>
              Send request
            </Button>
          </div>
        </Dialog>
      )}
      {kind === "danger" && (
        <Dialog label="Delete your post" tone="danger" onClose={close} className="w-full max-w-[30rem] p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-display text-title text-text-primary">Delete this post?</h2>
            <DialogClose className="-mr-2 -mt-2" />
          </div>
          <p className="mt-3 text-body text-text-secondary">
            &ldquo;Looking for a technical co-founder&rdquo; and any images on it will be removed straight away. This cannot be undone.
          </p>
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <Button variant="quiet" size="md" onClick={closeDialog}>
              Cancel
            </Button>
            <Button variant="danger" size="md" onClick={closeDialog}>
              Delete post
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function SheetDemo() {
  const [side, setSide] = useState<"left" | "right" | null>(null);
  const close = useCallback(() => setSide(null), []);
  return (
    <>
      <Button variant="ghost" size="md" leading={<Icon name="filter" size={18} />} onClick={() => setSide("right")}>
        Filters, from the right
      </Button>
      <Button variant="ghost" size="md" leading={<Icon name="menu" size={18} />} onClick={() => setSide("left")}>
        Navigation, from the left
      </Button>
      {side === "right" && (
        <Sheet label="Filters" title="Filters" side="right" onClose={close}>
          <div className="grid gap-7 p-6">
            <fieldset className="grid gap-1">
              <legend className="mb-2 text-small font-medium text-text-primary">Looking for</legend>
              {["A technical co-founder", "A design partner", "An advisor", "Early users"].map((option) => (
                <label key={option} className="flex min-h-11 items-center gap-3 text-body text-text-secondary">
                  <input type="checkbox" className="size-4" />
                  {option}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-3">
              <Button size="md" onClick={closeDialog}>
                Show 24 results
              </Button>
              <Button variant="quiet" size="md" onClick={closeDialog}>
                Clear all
              </Button>
            </div>
          </div>
        </Sheet>
      )}
      {side === "left" && (
        <Sheet label="Navigation" title="Foundry" side="left" onClose={close}>
          <nav aria-label="Style guide navigation" className="p-3">
            <ul>
              <Entry as="li" glyph={<Icon name="home" size={20} />} title="Home" href="/home" />
              <Entry as="li" glyph={<Icon name="members" size={20} />} title="Members" href="/members" />
              <Entry as="li" glyph={<Icon name="opportunities" size={20} />} title="Opportunities" href="/opportunities" />
              <Entry as="li" glyph={<Icon name="events" size={20} />} title="Events" href="/events" />
            </ul>
          </nav>
        </Sheet>
      )}
    </>
  );
}

export function PopoversDemo() {
  const toast = useToast();
  return (
    <>
      <Popover label="Add to calendar" icon="calendar-plus" panelClassName="w-64 p-1.5">
        <a className="lm-pop__item" href="https://calendar.google.com/calendar/render?action=TEMPLATE" target="_blank" rel="noopener noreferrer">
          Google Calendar
        </a>
        <button type="button" className="lm-pop__item" onClick={() => toast("Calendar file downloaded.", "success")}>
          Apple Calendar or Outlook (.ics)
        </button>
      </Popover>
      <Popover label="Who can see this?" panelLabel="Who can see this?" panelClassName="w-80">
        <p className="font-display text-lead text-text-primary">Members you have connected with</p>
        <p className="mt-2 text-small text-text-secondary">
          Your email address is released to a member only after they accept your request. You can remove a connection at any time and they lose access.
        </p>
        <Link className="mt-3 inline-block text-small text-accent-light underline underline-offset-4" href="/settings">
          Change who can see my profile
        </Link>
      </Popover>
      <Menu label="More actions" iconOnly placement="bottom-end">
        <MenuItem icon="edit" onSelect={() => toast("Opening the editor.", "info")}>
          Edit post
        </MenuItem>
        <MenuItem icon="link" onSelect={() => toast("Link copied.", "success")}>
          Copy link
        </MenuItem>
        <MenuItem icon="flag" href="/contact">
          Report
        </MenuItem>
        <MenuItem icon="share" disabled>
          Share (coming soon)
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="trash" tone="danger" onSelect={() => toast("Couldn't delete the post. Please try again.", "error")}>
          Delete post
        </MenuItem>
      </Menu>
      <Menu label="Sort by" icon="sort" variant="ghost">
        <MenuItem onSelect={() => toast("Sorted by newest.", "info")}>Newest</MenuItem>
        <MenuItem onSelect={() => toast("Sorted by closing soonest.", "info")}>Closing soonest</MenuItem>
        <MenuItem onSelect={() => toast("Sorted by pay.", "info")}>Pay</MenuItem>
      </Menu>
    </>
  );
}

export function TooltipsDemo() {
  return (
    <>
      <span className="inline-flex items-center gap-2 text-body text-text-primary">
        Looking for
        <InfoTip label="About Looking for">Roles you would like to be matched with. Only members you have connected with can see this.</InfoTip>
      </span>
      <Tooltip content="Only people you have connected with can see your email address.">
        <Button variant="quiet" size="sm">
          Who can see this?
        </Button>
      </Tooltip>
      <Tooltip content="Copy link" placement="bottom">
        <button type="button" className="lm-iconbtn" aria-label="Copy link">
          <Icon name="link" size={18} />
        </button>
      </Tooltip>
    </>
  );
}

export function ToastDemo() {
  const toast = useToast();
  return (
    <>
      <Button variant="ghost" size="md" onClick={() => toast("Saved for 7 days.", "success")}>
        Success toast
      </Button>
      <Button variant="ghost" size="md" onClick={() => toast("Remember to add a link to your CV.", "info")}>
        Info toast
      </Button>
      <Button variant="dangerGhost" size="md" onClick={() => toast("Couldn't update your bookmark. Please try again.", "error")}>
        Error toast
      </Button>
    </>
  );
}

export function DismissibleNoticeDemo() {
  const [shown, setShown] = useState(true);
  return shown ? (
    <Notice tone="success" onDismiss={() => setShown(false)}>
      Thanks — your opportunity was submitted and is now in review. It&apos;ll appear publicly once an admin approves it.
    </Notice>
  ) : (
    <div>
      <Button variant="ghost" size="sm" onClick={() => setShown(true)}>
        Show the notice again
      </Button>
    </div>
  );
}

export function SegmentErrorDemo() {
  return <SegmentErrorView label="the members admin queue" digest="3041559022" retry={() => {}} />;
}

/** The notice that replaces an expanded listing's body once the row is gone, drawn as it is inside a card. */
export function ListingGoneDemo() {
  return (
    <Panel className="overflow-hidden">
      <Entry
        glyph={<Icon name="events" size={20} />}
        title="Demo Night"
        meta="Barclays Eagle Labs, London"
        trailing={<Icon name="chevron-up" size={18} />}
      />
      <ListingGoneNotice kind="event" onDismiss={() => {}} />
    </Panel>
  );
}

/** Three toasts at rest, one of each tone: the pill, its glyph and its dismiss control (the live ones come from the buttons above). */
export function ToastSpecimens() {
  return (
    <div className="grid grid-cols-1 justify-items-center gap-3 rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-8">
      <ToastView tone="success" message="Saved for 7 days." onDismiss={() => {}} />
      <ToastView tone="info" message="Remember to add a link to your CV." onDismiss={() => {}} />
      <ToastView tone="error" message="Couldn't update your bookmark. Please try again." onDismiss={() => {}} />
    </div>
  );
}
