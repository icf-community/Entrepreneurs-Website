"use client";

import { Popover } from "@/components/ui/Popover";
import { Icon } from "@/design-system/icons/Icon";
import { googleCalendarUrl, icsDataUri, type CalendarEvent } from "@/lib/calendar";

// ════════════════════════════════════════════════════════════════════
// Foundry · Add-to-calendar popover
//
// Two options:
//   • Add to Google Calendar — opens the render URL in a new tab.
//   • Download .ics          — covers Apple Calendar, Outlook (desktop
//                              and web), and most other clients.
//
// A Popover, not a Menu: it is a disclosure (a button that reveals two links),
// and role=menu would promise arrow-key navigation and a roving focus that this
// does not have, so Tab moves through the links like any other (focus.spec asserts
// there is no role=menu here and that Tab from the button reaches a link). Escape
// and choosing an item close it and give focus back to the button, otherwise a
// keyboard user is dropped back at the top of the page when the focused link
// unmounts. The panel is a native popover, so no card's overflow can clip it.
// ════════════════════════════════════════════════════════════════════

type Props = CalendarEvent;

export function AddToCalendarMenu(props: Props) {
  const gcalUrl = googleCalendarUrl(props);
  const icsUrl  = icsDataUri(props);
  const icsName = slugifyTitle(props.title);

  return (
    <Popover label="Add to calendar" icon="calendar-plus" variant="ghost" size="sm" panelClassName="w-72 p-1.5">
      {({ close }) => (
        <>
          <a
            href={gcalUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => close({ restoreFocus: true })}
            className="lm-pop__item"
          >
            <span className="lm-pop__item-label">Google Calendar</span>
            <Icon name="arrow-up-right" size={16} className="lm-pop__item-icon" />
          </a>
          {/* The .ics body carries a timestamp and a random UID, so the server's href and the client's differ by design. The panel is
              always in the DOM (it used to mount on click), so it is server-rendered too: keep the server's value, say nothing. */}
          <a
            href={icsUrl}
            download={`${icsName}.ics`}
            onClick={() => close({ restoreFocus: true })}
            className="lm-pop__item"
            suppressHydrationWarning
          >
            <span className="lm-pop__item-label">Download .ics (Apple / Outlook)</span>
          </a>
        </>
      )}
    </Popover>
  );
}

function slugifyTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "foundry-event";
}
