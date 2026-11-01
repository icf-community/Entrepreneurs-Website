import { describe, it, expect } from "vitest";
import { googleCalendarUrl, buildIcs, icsDataUri, type CalendarEvent } from "./calendar";

const base: CalendarEvent = {
  title: "Demo Night",
  description: "Come build with us",
  location: "Imperial",
  startIso: "2026-06-12T15:00:00Z",
};

describe("googleCalendarUrl", () => {
  it("renders the TEMPLATE URL with a default 1-hour end (UTC stamps)", () => {
    const url = new URL(googleCalendarUrl(base));
    expect(url.origin + url.pathname).toBe("https://www.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Demo Night");
    expect(url.searchParams.get("location")).toBe("Imperial");
    expect(url.searchParams.get("dates")).toBe("20260612T150000Z/20260612T160000Z");
  });

  it("honours an explicit end time", () => {
    const url = new URL(googleCalendarUrl({ ...base, endIso: "2026-06-12T17:30:00Z" }));
    expect(url.searchParams.get("dates")).toBe("20260612T150000Z/20260612T173000Z");
  });

  it("appends the reference URL into details when present", () => {
    const url = new URL(googleCalendarUrl({ ...base, url: "https://lu.ma/x" }));
    expect(url.searchParams.get("details")).toBe("Come build with us\n\nLink: https://lu.ma/x");
  });
});

describe("buildIcs", () => {
  it("produces a CRLF-terminated VCALENDAR with UTC DTSTART/DTEND", () => {
    const ics = buildIcs(base);
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("DTSTART:20260612T150000Z");
    expect(ics).toContain("DTEND:20260612T160000Z");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("RFC-5545 escapes commas, semicolons, backslashes and newlines", () => {
    const ics = buildIcs({ ...base, description: "a,b;c\\d\ne" });
    expect(ics).toContain("DESCRIPTION:a\\,b\\;c\\\\d\\ne");
  });

  it("folds lines longer than 75 octets with a CRLF + space continuation", () => {
    const ics = buildIcs({ ...base, title: "A".repeat(80) });
    expect(ics).toContain("\r\n ");
  });

  it("strips an injected CRLF out of the URL: property instead of emitting it raw", () => {
    const ics = buildIcs({ ...base, url: "https://evil.example\r\nORGANIZER:attacker@evil.example" });
    expect(ics).not.toContain("\r\nORGANIZER:attacker@evil.example");
    expect(ics).toContain("URL:https://evil.exampleORGANIZER:attacker@evil.example");
    // Exactly one VEVENT, one URL: line, and nothing injected before END:VEVENT.
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(ics.match(/^URL:/m)?.length).toBe(1);
  });

  it("escapes a bare \\r (no \\n) in a TEXT property the same as \\n", () => {
    const ics = buildIcs({ ...base, description: "line one\rline two" });
    expect(ics).toContain("DESCRIPTION:line one\\nline two");
    expect(ics).not.toMatch(/DESCRIPTION:.*\r.*\r\n/);
  });
});

describe("icsDataUri", () => {
  it("encodes a decodable ICS body into a data: URI", () => {
    // buildIcs embeds a random UID + now() DTSTAMP, so assert structure, not
    // byte-equality against a second call.
    const uri = icsDataUri(base);
    expect(uri.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);
    const decoded = decodeURIComponent(uri.slice("data:text/calendar;charset=utf-8,".length));
    expect(decoded.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(decoded).toContain("DTSTART:20260612T150000Z");
    expect(decoded.endsWith("\r\n")).toBe(true);
  });
});
