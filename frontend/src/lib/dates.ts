// Deterministic date formatting shared across the app. Two separate
// problems live here, and both have the same symptom — the server and the
// browser disagreeing about the same instant.
//
// ICU. Node's full ICU renders the en-GB September abbreviation as "Sept"
// while browsers render "Sep". In a client component that is server-
// rendered then hydrated, that difference is a hydration mismatch. So the
// month and weekday names come from the fixed tables below, never from the
// runtime's locale data.
//
// TIMEZONE. Every field read here is resolved in Europe/London. The
// previous implementation used getDate()/getMonth()/getHours(), which read
// whatever zone the process happens to be in: UTC on Vercel, the visitor's
// zone in the browser. Those disagree by an hour for most of the year and,
// for any instant between 23:00 UTC and midnight during BST, they disagree
// about the *date*. An event at 00:30 London on the 16th was rendering as
// the 15th on the server. The society meets in London; London is what
// every stored timestamp means, and it is what these helpers show
// regardless of where the code runs.
//
// The weekday is derived arithmetically from the London Y/M/D rather than
// read from Intl, so it comes off the same fixed table as the names.

const TZ = "Europe/London";

const WEEKDAYS      = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS        = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG   = ["January", "February", "March", "April", "May", "June",
                       "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number) => String(n).padStart(2, "0");

// hourCycle h23 explicitly: en-GB with hour12:false renders midnight as
// "24" under some ICU builds, which would print "24:00" for 00:00.
const FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type Parts = {
  year: number;
  /** 1-12, not the 0-11 that Date uses. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number;
};

// What every formatter shows for a value that is not a real instant. A
// timestamptz can hold 'infinity' (PostgREST serialises it as the string
// "infinity") and Intl throws a RangeError on the Invalid Date that gives, so
// without this one bad row takes down every page that renders it.
const UNAVAILABLE = "Date unavailable";
/** Day key for a non-instant; formatDayKeyLong renders it as the placeholder. */
const INVALID_DAY_KEY = "unknown";

/** The London wall-clock fields of an instant, or null if it is not a real one. */
function londonParts(input: string | Date): Parts | null {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  const parts = FORMATTER.formatToParts(d);
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : NaN;
  };

  const year  = field("year");
  const month = field("month");
  const day   = field("day");

  return {
    year,
    month,
    day,
    hour:   field("hour") % 24,
    minute: field("minute"),
    // Pure calendar arithmetic in UTC — no zone and no locale data
    // involved, so this can't reintroduce either bug above.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** "2026-09-15" — the London calendar day, for grouping and bucketing. */
export function dayKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** The London calendar day an instant falls on, as "2026-09-15". */
export function londonDayKey(input: string | Date): string {
  const p = londonParts(input);
  if (!p) return INVALID_DAY_KEY;
  return dayKey(p.year, p.month, p.day);
}

/** "15 Sep 2026" */
export function formatDate(input: string | Date): string {
  const p = londonParts(input);
  if (!p) return UNAVAILABLE;
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "Mon, 24 Sep 2026" */
export function formatDateWeekday(input: string | Date): string {
  const p = londonParts(input);
  if (!p) return UNAVAILABLE;
  return `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "18:30" */
export function formatTime(input: string | Date): string {
  const p = londonParts(input);
  if (!p) return UNAVAILABLE;
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "Mon, 24 Sep 2026, 18:30" */
export function formatDateTime(input: string | Date): string {
  if (!londonParts(input)) return UNAVAILABLE;
  return `${formatDateWeekday(input)}, ${formatTime(input)}`;
}

/** "Monday, 24 September 2026" */
export function formatDateLong(input: string | Date): string {
  const p = londonParts(input);
  if (!p) return UNAVAILABLE;
  return `${WEEKDAYS_LONG[p.weekday]}, ${p.day} ${MONTHS_LONG[p.month - 1]} ${p.year}`;
}

/** "Monday, 24 September 2026, 18:30" */
export function formatDateTimeLong(input: string | Date): string {
  if (!londonParts(input)) return UNAVAILABLE;
  return `${formatDateLong(input)}, ${formatTime(input)}`;
}

/**
 * "Monday, 24 September 2026" from a "2026-09-24" key produced by
 * dayKey()/londonDayKey().
 *
 * Takes the key rather than a Date on purpose: the key is already a London
 * calendar day, and re-parsing it into a Date would hand it back to the
 * runtime's zone — the exact round trip this file exists to stop.
 */
export function formatDayKeyLong(key: string): string {
  if (key === INVALID_DAY_KEY) return UNAVAILABLE;
  const [year, month, day] = key.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS_LONG[weekday]}, ${day} ${MONTHS_LONG[month - 1]} ${year}`;
}

/** "September 2026", from a 1-12 month. */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** "September 2026" shortened to "Sep 2026", from a 1-12 month. */
export function formatMonthYearShort(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}
