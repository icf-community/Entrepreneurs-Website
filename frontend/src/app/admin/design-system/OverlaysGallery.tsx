import Link from "next/link";
import type { ReactNode } from "react";
import { PendingRevisionNotice } from "@/components/PendingRevisionNotice";
import SubmittedBanner from "@/components/SubmittedBanner";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { DialogClose } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { MenuItem, MenuSeparator } from "@/components/ui/Popover";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { CardGridSkeleton, FilterBarSkeleton, FormSkeleton, PageHeaderSkeleton, RowListSkeleton, Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Updating } from "@/components/ui/Updating";
import {
  DialogDemo,
  DismissibleNoticeDemo,
  ListingGoneDemo,
  PopoversDemo,
  SegmentErrorDemo,
  SheetDemo,
  ToastDemo,
  ToastSpecimens,
  TooltipsDemo,
} from "./OverlaysDemos";

// The Overlays section of the design-system gallery (/admin/design-system). Owned by the overlays family: every component of the
// family, in every state, with real content and a one-line note on when to use it (and when not to). A server component: the pieces
// that open (a dialog, a drawer, a popover, a toast) are small "use client" children in OverlaysDemos.tsx, and what is shown at rest
// (a dialog's panel, an open menu, a tooltip's bubble) is the same markup and classes drawn in place, so it can be reviewed without clicking.

function Block({ title, use, children }: { title: string; use: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 border-t border-border-subtle pt-10 first:border-t-0 first:pt-0 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12">
      <div className="grid content-start gap-2">
        <h3 className="font-display text-title text-text-primary">{title}</h3>
        <p className="text-small text-text-secondary">{use}</p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-6">{children}</div>
    </div>
  );
}

/** A recessed field the specimens sit in. */
function Stage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Panel tone="inset" className={`p-5 sm:p-6 ${className}`}>
      {children}
    </Panel>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-caption text-text-muted">{children}</p>;
}

/** A dialog's panel, drawn in place over the same night wash the real backdrop has. */
function DialogSpecimen({ danger = false }: { danger?: boolean }) {
  return (
    <div className="lm-wash grid rounded-xl border border-border-subtle p-5 sm:p-8">
      <div className="lm-dialog__panel w-full p-6" data-tone={danger ? "danger" : undefined}>
        <div className="flex items-start justify-between gap-4">
          <p className="font-display text-title text-text-primary">{danger ? "Delete this post?" : "Connect with Elena Petrova?"}</p>
          <DialogClose className="-mr-2 -mt-2" />
        </div>
        <p className="mt-3 text-small text-text-secondary">
          {danger
            ? "“Looking for a technical co-founder” and any images on it will be removed straight away. This cannot be undone."
            : "If she accepts, you will each be able to see the other’s email address."}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="quiet" size="sm">
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} size="sm">
            {danger ? "Delete post" : "Send request"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function OverlaysGallery() {
  return (
    <section id="overlays" className="grid grid-cols-1 gap-10 border-t border-border-subtle py-12">
      <div className="grid grid-cols-1 gap-2">
        <h2 className="font-display text-heading text-text-primary">Overlays and feedback</h2>
        <p className="measure-prose text-small text-text-secondary">
          Everything that sits over a page or answers an action. An overlay is raised: a hairline, a whisper of warm light on its top edge, one soft shadow. Status is a tone, never a stripe. Prefer a popover or a disclosure to a modal whenever the task needs neither interruption nor protected focus.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-12">
        <Block
          title="Dialog"
          use="Use when the task must interrupt and hold focus: a confirmation, a short form that has to be finished or abandoned. Not when it needs neither: that is a Popover or a disclosure."
        >
          <Stage className="flex flex-wrap items-center gap-4">
            <DialogDemo />
          </Stage>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <DialogSpecimen />
            <DialogSpecimen danger />
          </div>
          <Caption>
            A native &lt;dialog&gt; opened with showModal(): focus is trapped, Escape and the Close ring hand it back, a click outside closes. Pass only layout in className; tone=&quot;danger&quot; draws the edge in the danger light.
          </Caption>
        </Block>

        <Block
          title="Sheet"
          use="Use for a drawer on one edge: the mobile navigation, a panel of filters. It traps focus like a Dialog, so the same rule holds: only when the task needs to hold it."
        >
          <Stage className="flex flex-wrap items-center gap-4">
            <SheetDemo />
          </Stage>
          <div className="lm-sheet lm-wash h-[24rem] overflow-hidden rounded-xl border border-border-subtle" data-side="right">
            <div className="lm-sheet__layer">
              <div className="lm-sheet__panel">
                <header className="lm-sheet__head">
                  <h4 className="lm-sheet__title">Filters</h4>
                  <DialogClose />
                </header>
                <div className="grid gap-1 p-6">
                  <p className="mb-2 text-small font-medium text-text-primary">Looking for</p>
                  {["A technical co-founder", "A design partner", "An advisor"].map((option) => (
                    <label key={option} className="flex min-h-11 items-center gap-3 text-body text-text-secondary">
                      <input type="checkbox" className="size-4" />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <Caption>Mount it to open it, like a Dialog: render it conditionally, never keep a closed one in the DOM. From either edge; with a title it draws its own header and Close ring.</Caption>
        </Block>

        <Block
          title="Popover and Menu"
          use="A Popover holds a few links or a short form behind a button; a Menu is a list of commands with arrow keys. Neither interrupts or traps focus: reach for them before a dialog."
        >
          <Stage className="flex flex-wrap items-center gap-4">
            <PopoversDemo />
          </Stage>
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
            <div className="grid grid-cols-1 gap-2">
              <div role="menu" aria-label="More actions, drawn at rest" data-open data-kind="menu" className="lm-pop relative animate-none">
                <MenuItem icon="edit">Edit post</MenuItem>
                <MenuItem icon="link">Copy link</MenuItem>
                <MenuItem icon="flag">Report</MenuItem>
                <MenuItem icon="share" disabled>
                  Share (coming soon)
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="trash" tone="danger">
                  Delete post
                </MenuItem>
              </div>
              <Caption>A Menu, open: 44 px rows, a danger row, a disabled row.</Caption>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <div data-open data-kind="popover" className="lm-pop relative w-[20rem] max-w-full animate-none">
                <p className="font-display text-lead text-text-primary">Members you have connected with</p>
                <p className="mt-2 text-small text-text-secondary">
                  Your email address is released to a member only after they accept your request. You can remove a connection at any time and they lose access.
                </p>
              </div>
              <Caption>A Popover, open: any content, 16 px of room.</Caption>
            </div>
          </div>
          <Caption>
            Escape closes and hands focus back to the button; a press or Tab outside closes without taking it. Menu: arrows, Home, End and type-ahead move, Enter or Space choose. The panel is in the top layer, so nothing clips it, and it flips at the screen edge.
          </Caption>
        </Block>

        <Block
          title="Tooltip"
          use="Use for one sentence that explains a control or a value. Not for anything a person needs in order to act: on a touch screen it takes a tap."
        >
          <Stage className="flex flex-wrap items-center gap-x-8 gap-y-5">
            <TooltipsDemo />
          </Stage>
          <div className="flex flex-wrap items-start gap-5">
            <span role="tooltip" data-open className="lm-tip__bubble relative animate-none">
              Only people you have connected with can see your email address.
            </span>
            <span role="tooltip" data-open className="lm-tip__bubble relative animate-none">
              Copy link
            </span>
          </div>
          <Caption>
            Opens on hover after 350 ms, on keyboard focus at once and on a tap; Escape closes it and the pointer can travel onto it. InfoTip is the small &quot;i&quot; for a sentence that would crowd a row.
          </Caption>
        </Block>

        <Block
          title="Toast"
          use="Use for an outcome that has nowhere else to appear. Not while a form or dialog is open (show the error beside it), and never for anything that needs a reply."
        >
          <Stage className="flex flex-wrap items-center gap-4">
            <ToastDemo />
          </Stage>
          <ToastSpecimens />
          <Caption>A pill: the tone is a drawn glyph and a hairline, and a hairline along the bottom runs out over its five seconds. Errors are role=alert, the rest role=status; both regions are always mounted.</Caption>
        </Block>

        <Block
          title="Notice"
          use="Use for a message that belongs to a place: above a form, over a page, inside a card. The caller picks the role: alert for a failure that interrupts, status for news."
        >
          <div className="grid gap-4">
            <Notice tone="info">Your profile is visible to approved members only.</Notice>
            <Notice tone="lit">This event is waiting on a review. Check back before you rely on the details.</Notice>
            <Notice tone="danger">We couldn&apos;t save your changes. Check your connection and try again.</Notice>
            <Notice tone="success">Your changes are saved.</Notice>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Notice
              tone="lit"
              title="Your CV is still processing"
              action={
                <>
                  <Button variant="ghost" size="sm">
                    Check status
                  </Button>
                  <Link href="/profile">Open your profile</Link>
                </>
              }
            >
              It is already saved. Matching starts once it has been read, usually within a few minutes.
            </Notice>
            <DismissibleNoticeDemo />
          </div>
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            <Notice shape="bar" tone="info" role="status">
              Sign-in is running slowly for some members. We are looking into it. <a href="https://example.com/status">More</a>
            </Notice>
            <Notice shape="bar" tone="lit" role="status">
              Scheduled maintenance tonight from 22:00 to 23:00 UK time.
            </Notice>
            <Notice shape="bar" tone="danger" role="alert">
              Foundry is read-only while we fix a problem with saving. Nothing you have already saved is lost.
            </Notice>
          </div>
          <Caption>The bar is the incident banner (SiteBanner): info is the cold light, warning is amber, critical is danger; the first two can be dismissed, the third cannot.</Caption>
        </Block>

        <Block
          title="Banners and notices in the app"
          use="The bespoke notices are all this one Notice, so they read as a family: a form error, a confirmation, a pending review, a failed section, a listing that is gone."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ErrorBanner>That email address is already registered. Try signing in instead.</ErrorBanner>
            <SuccessBanner>Saved.</SuccessBanner>
          </div>
          <div className="grid gap-4 [&>*]:mb-0">
            <PendingRevisionNotice noun="event" />
            <SubmittedBanner kind="opportunity" />
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Stage className="p-0 sm:p-0">
              <SegmentErrorDemo />
            </Stage>
            <ListingGoneDemo />
          </div>
        </Block>

        <Block
          title="Empty state"
          use="Use when a list has nothing to list: one line on why and, if there is one, the next step. Not for loading (a skeleton) and not for a failure (a notice)."
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <EmptyState
              icon="opportunities"
              title="No opportunities posted yet."
              action={<ButtonLink href="/opportunities/new">Post an opportunity</ButtonLink>}
            >
              Be the first: share a role, an internship or a project you need help with.
            </EmptyState>
            <EmptyState
              icon="search"
              title="No members match your search or filters."
              action={
                <Button variant="ghost" size="md">
                  Clear all
                </Button>
              }
            >
              Try removing a filter, or search for a different course.
            </EmptyState>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <EmptyState icon="events">No upcoming events.</EmptyState>
            <Panel className="p-2">
              <EmptyState bare size="compact" icon="bookmark">
                No bookmarks yet. Save a listing and it will wait for you here.
              </EmptyState>
            </Panel>
          </div>
          <Caption>It takes the old card&apos;s sentence as children, so adopting it changes no words. bare drops the surface (inside a Panel); compact is for a card that is not itself empty.</Caption>
        </Block>

        <Block
          title="Loading"
          use="Use a skeleton where the shape of the result is known and a spinner where it is not. Skeletons are sized to the real content; a region says Loading once, and is busy."
        >
          <Stage className="flex flex-wrap items-center gap-x-8 gap-y-5">
            <span className="inline-flex items-center gap-3 text-text-secondary">
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" />
            </span>
            <span className="inline-flex items-center gap-2 text-small text-text-secondary">
              <Spinner size="sm" />
              Updating results…
            </span>
            <Button loading>Saving</Button>
            <div className="relative h-12 w-40 rounded-lg border border-border-subtle">
              <Updating />
            </div>
          </Stage>
          <div aria-hidden="true" className="grid grid-cols-1 gap-8">
            <div className="flex flex-wrap items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton shape="ring" className="size-11" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-11 w-28 rounded-full" />
            </div>
            <PageHeaderSkeleton className="mb-0" />
            <FilterBarSkeleton />
            <CardGridSkeleton count={3} />
            <RowListSkeleton count={2} />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <TableSkeleton rows={3} />
              <FormSkeleton fields={2} />
            </div>
          </div>
          <Caption>The sweep is slow (4 s, mostly rest) and stops under reduced motion; the spinner keeps turning, slowly, because a frozen one reads as a hung request. Blocks keep animate-pulse and regions aria-busy for the specs.</Caption>
        </Block>
      </div>

    </section>
  );
}
