// ════════════════════════════════════════════════════════════════════
// Foundry · Calendar export helpers
//
// Two outputs from one event payload:
//   1. googleCalendarUrl(...)  — render-into-Google URL
//   2. buildIcs(...)           — RFC 5545 iCalendar string for the
//                                "Download .ics" button. Apple
//                                Calendar, Outlook (desktop + web),
//                                and most other clients accept this.
//
// We deliberately skip a dedicated Outlook deep link because modern
// Outlook handles .ics downloads cleanly and a third button is
// clutter. Same reasoning for Yahoo / proton / etc.
// ════════════════════════════════════════════════════════════════════

export type CalendarEvent = {
  title:       string;
  description: string;
  location:    string;
  /** ISO 8601 start. We treat events as 1-hour by default unless an
   *  end is supplied — Foundry's event payload doesn't carry an end
   *  time today (Luma is the source of truth). */
  startIso:    string;
  endIso?:     string;
  /** Optional reference URL (Luma link, etc.). Appended to the
   *  description in both outputs. */
  url?:        string;
};

// ─── Google Calendar URL ────────────────────────────────────────────
// Format: https://www.google.com/calendar/render?action=TEMPLATE
//   &text=Title
//   &dates=YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ
//   &details=Description
//   &location=Location
export function googleCalendarUrl(ev: CalendarEvent): string {
  const start = toGoogleStamp(ev.startIso);
  const end   = toGoogleStamp(ev.endIso ?? defaultEnd(ev.startIso));
  const detailsParts = [ev.description, ev.url ? `\n\nLink: ${ev.url}` : ""].filter(Boolean);
  const params = new URLSearchParams({
    action:   "TEMPLATE",
    text:     ev.title,
    dates:    `${start}/${end}`,
    details:  detailsParts.join(""),
    location: ev.location,
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

// ─── iCalendar .ics body ────────────────────────────────────────────
// RFC 5545 requires CRLF line endings, max 75 octet lines (we line-
// fold longer values), and TEXT-property escaping for commas,
// semicolons, backslashes, and newlines.
export function buildIcs(ev: CalendarEvent): string {
  const dtStart   = toIcsStamp(ev.startIso);
  const dtEnd     = toIcsStamp(ev.endIso ?? defaultEnd(ev.startIso));
  const dtStamp   = toIcsStamp(new Date().toISOString());
  const uid       = `${cryptoLikeId()}@foundry.imperial`;

  const description = ev.url
    ? `${ev.description}\n\nLink: ${ev.url}`
    : ev.description;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Foundry//Foundry Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    foldLine(`SUMMARY:${escapeIcsText(ev.title)}`),
    foldLine(`DESCRIPTION:${escapeIcsText(description)}`),
    foldLine(`LOCATION:${escapeIcsText(ev.location)}`),
    ev.url ? foldLine(`URL:${sanitizeIcsUri(ev.url)}`) : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n") + "\r\n";
}

// data: URI suitable for a direct download <a> with a filename hint.
export function icsDataUri(ev: CalendarEvent): string {
  const body = buildIcs(ev);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

// ─── Internals ──────────────────────────────────────────────────────
function defaultEnd(startIso: string): string {
  const start = new Date(startIso).getTime();
  return new Date(start + 60 * 60 * 1000).toISOString();
}

// 20260612T150000Z — UTC stamp, no separators.
function toGoogleStamp(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const h = d.getUTCHours().toString().padStart(2, "0");
  const min = d.getUTCMinutes().toString().padStart(2, "0");
  const s = d.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

// RFC 5545 uses the same compact UTC form when the Z suffix is present.
function toIcsStamp(iso: string): string {
  return toGoogleStamp(iso);
}

// RFC 5545 TEXT escaping. Order matters — escape backslashes first.
// A bare \r (no following \n) is folded into \n before escaping: an
// un-escaped \r in a TEXT property is as much a raw-line-ending
// injection as \n is, and a source that only strips/rejects \n (several
// upstream checks do) can still let one through.
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/,/g,  "\\,")
    .replace(/;/g,  "\\;");
}

// URI properties (URL:) aren't TEXT, so comma/semicolon escaping doesn't
// apply — but a raw CR/LF here still forges new iCalendar lines
// (CRLF/header injection) exactly as it would in an HTTP header. Strip
// control characters rather than rejecting the value outright: this is
// the last line of defense regardless of how permissive the upstream
// luma_link validation is.
function sanitizeIcsUri(url: string): string {
  return url.replace(/[\x00-\x1f\x7f]/g, "");
}

// Fold lines longer than 75 octets with CRLF + single leading space
// continuation, per RFC 5545. We measure in characters since Foundry
// payloads are basic Latin / safe punctuation; a stricter octet
// counter would be needed for arbitrary unicode.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  chunks.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

// Tiny UID generator for the iCalendar UID property.
//
// Nothing authenticates on this value — RFC 5545 wants a string unique
// enough that two events do not collide in someone's calendar. The
// fallback nonetheless uses getRandomValues rather than Math.random,
// because a weak PRNG sitting in a function called from an id path is a
// standing invitation for the next person to reuse it somewhere it does
// matter, and it is the same three lines either way. CodeQL flagged the
// old fallback as js/insecure-randomness for exactly that reason.
function cryptoLikeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${Date.now()}-${suffix}`;
}
