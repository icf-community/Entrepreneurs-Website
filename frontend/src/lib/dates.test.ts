import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateWeekday,
  formatDateTime,
  formatTime,
  formatDateLong,
  formatDateTimeLong,
  formatDayKeyLong,
  formatMonthYear,
  londonDayKey,
  dayKey,
} from "./dates";

// These helpers render Europe/London, and the point of them is that they do
// so from anywhere. The server runs UTC on Vercel; the browser runs whatever
// the visitor's laptop is set to. Anything that reads the runtime's own zone
// — getDate(), getHours(), a bare toLocale* call — makes those two disagree,
// and between 23:00 UTC and midnight during BST they disagree about the day,
// not just the hour.
//
// Every assertion below therefore runs under three zones either side of
// London and demands one answer. Node applies a change to process.env.TZ to
// subsequent Date operations, so mutating it here genuinely re-runs the
// helpers somewhere else; against the old runtime-local implementation these
// tests fail, which is the only reason they are worth having.
const TIMEZONES = ["UTC", "America/New_York", "Australia/Sydney"];

/** Runs fn once per zone and returns what it produced in each. */
function inEachTimezone<T>(fn: () => T): T[] {
  const original = process.env.TZ;
  try {
    return TIMEZONES.map((tz) => {
      process.env.TZ = tz;
      return fn();
    });
  } finally {
    process.env.TZ = original;
  }
}

/** Asserts every zone agreed, and that they agreed on `expected`. */
function expectStable<T>(results: T[], expected: T) {
  const distinct = new Set(results.map((r) => JSON.stringify(r)));
  expect(
    distinct.size,
    `disagreed across ${TIMEZONES.join(" / ")}: ${results.join(" | ")}`,
  ).toBe(1);
  expect(results[0]).toEqual(expected);
}

// 23:30 UTC on 15 September is 00:30 on the 16th in London (BST). This is
// the instant the old implementation got wrong: UTC-based runtimes rendered
// the 15th, a London browser rendered the 16th, and Sydney rendered the
// 16th at a different hour again.
const LATE_BST = "2026-09-15T23:30:00Z";
// The same clock time in winter, when London is GMT and nothing shifts.
const LATE_GMT = "2026-01-15T23:30:00Z";
// Midday in summer: London is an hour ahead of the stored UTC.
const MIDDAY_BST = "2026-06-15T12:00:00Z";

describe("formatDate", () => {
  it("renders the London day, from any runtime zone", () => {
    expectStable(inEachTimezone(() => formatDate(LATE_BST)), "16 Sep 2026");
  });

  it("uses the fixed 'Sep' month table (not ICU's 'Sept')", () => {
    expect(formatDate("2026-09-01T12:00:00Z")).toContain("Sep");
    expect(formatDate("2026-09-01T12:00:00Z")).not.toContain("Sept");
  });

  it("leaves a GMT instant where it is", () => {
    expectStable(inEachTimezone(() => formatDate(LATE_GMT)), "15 Jan 2026");
  });
});

describe("formatDateWeekday", () => {
  it("names the weekday of the London day, not the runtime's", () => {
    expectStable(inEachTimezone(() => formatDateWeekday(LATE_BST)), "Wed, 16 Sep 2026");
  });
});

describe("formatTime", () => {
  it("shows London wall-clock time, not the runtime's", () => {
    expectStable(inEachTimezone(() => formatTime(MIDDAY_BST)), "13:00");
  });

  it("zero-pads, and renders midnight as 00:00 rather than 24:00", () => {
    expectStable(inEachTimezone(() => formatTime(LATE_BST)), "00:30");
    expectStable(inEachTimezone(() => formatTime("2026-06-14T23:00:00Z")), "00:00");
  });
});

describe("formatDateTime", () => {
  it("is identical under UTC, New York and Sydney", () => {
    expectStable(inEachTimezone(() => formatDateTime(LATE_BST)), "Wed, 16 Sep 2026, 00:30");
  });

  it("applies the BST offset", () => {
    expectStable(inEachTimezone(() => formatDateTime(MIDDAY_BST)), "Mon, 15 Jun 2026, 13:00");
  });
});

describe("the long forms", () => {
  it("spell the weekday and month out, still in London", () => {
    expectStable(inEachTimezone(() => formatDateLong(LATE_BST)), "Wednesday, 16 September 2026");
    expectStable(
      inEachTimezone(() => formatDateTimeLong(LATE_BST)),
      "Wednesday, 16 September 2026, 00:30",
    );
  });

  it("formats a month heading from a 1-12 month", () => {
    expect(formatMonthYear(2026, 9)).toBe("September 2026");
    expect(formatMonthYear(2026, 12)).toBe("December 2026");
  });
});

describe("day keys", () => {
  it("bucket an instant into its London calendar day", () => {
    expectStable(inEachTimezone(() => londonDayKey(LATE_BST)), "2026-09-16");
    expectStable(inEachTimezone(() => londonDayKey(LATE_GMT)), "2026-01-15");
  });

  it("zero-pad, so keys sort lexicographically", () => {
    expect(dayKey(2026, 1, 5)).toBe("2026-01-05");
    expect(londonDayKey("2026-01-05T12:00:00Z") < londonDayKey("2026-01-15T12:00:00Z")).toBe(true);
  });

  it("round-trip through the heading format without touching a timezone", () => {
    expectStable(
      inEachTimezone(() => formatDayKeyLong(londonDayKey(LATE_BST))),
      "Wednesday, 16 September 2026",
    );
  });
});

// A value that cannot be a real instant must never take a page down. Postgres
// can hold 'infinity' in a timestamptz, PostgREST serialises it as the string
// "infinity", and Intl.DateTimeFormat.formatToParts throws a RangeError on the
// Invalid Date that produces. One such row used to crash /admin/events for
// every admin (adversarial sweep F1), so every formatter fails soft.
describe("invalid instants", () => {
  const BAD: (string | Date)[] = ["infinity", "-infinity", "", "not a date", new Date(NaN), "+275761-01-01T00:00:00Z"];

  it.each(BAD.map((b) => [String(b), b] as const))("do not throw for %s", (_label, bad) => {
    expect(() => formatDate(bad)).not.toThrow();
    expect(() => formatDateWeekday(bad)).not.toThrow();
    expect(() => formatTime(bad)).not.toThrow();
    expect(() => formatDateTime(bad)).not.toThrow();
    expect(() => formatDateLong(bad)).not.toThrow();
    expect(() => formatDateTimeLong(bad)).not.toThrow();
    expect(() => londonDayKey(bad)).not.toThrow();
  });

  it("render a readable placeholder, never NaN or undefined", () => {
    for (const out of [formatDate("infinity"), formatDateTime("infinity"), formatDateTimeLong("infinity"), formatTime("infinity")]) {
      expect(out).toBe("Date unavailable");
    }
  });

  it("give a day key that formatDayKeyLong also renders as the placeholder", () => {
    expect(formatDayKeyLong(londonDayKey("infinity"))).toBe("Date unavailable");
  });

  it("leave valid instants untouched", () => {
    expect(formatDate("2026-09-15T12:00:00Z")).toBe("15 Sep 2026");
  });
});

