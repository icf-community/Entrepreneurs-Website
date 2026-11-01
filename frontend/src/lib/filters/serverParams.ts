// Server-side normalisation of a page's searchParams.
//
// Next types each value `string | string[] | undefined`: a repeated
// parameter (?skill=1&skill=2) arrives as an array. Pages that declared
// their params as plain strings called .split on that array and threw, so a
// crafted link crashed /members, /connections and /admin/members.
//
// Flatten once at the page boundary and the rest of the page keeps its
// string typing.

type Raw = Record<string, string | string[] | undefined>;

/**
 * Every value becomes `string | undefined`. A key in `multi` (a
 * comma-separated list filter) joins its repeats with commas, so
 * ?skill=1&skill=2 means "1 and 2". Any other key keeps its first value.
 * The result has no prototype, so a key like `constructor` is just a key.
 */
export function flattenSearchParams(raw: Raw, multi: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      out[key] = value === undefined ? undefined : clean(value);
    } else if (multi.includes(key)) {
      out[key] = value.length ? value.map(clean).join(",") : undefined;
    } else {
      out[key] = value[0] === undefined ? undefined : clean(value[0]);
    }
  }
  return out;
}

// A NUL byte cannot be stored in Postgres text (22P05), and nothing a person
// types into a filter is longer than this. Both used to reach the database
// and come back as a logged error.
const MAX_PARAM_LENGTH = 500;
const clean = (v: string): string => v.replace(/\u0000/g, "").slice(0, MAX_PARAM_LENGTH);

/** A page number: 1..10000, else 1. (page=1e21 became the offset 2.4e+21.) */
export function pageParam(v: string | undefined): number {
  if (!v || !/^\d{1,5}$/.test(v)) return 1;
  const n = Number(v);
  return n >= 1 && n <= 10_000 ? n : 1;
}

/** A real calendar day, 1970-2099, as YYYY-MM-DD, else "". */
export function isoDayParam(v: string | undefined): string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 1970 && y <= 2099;
  return ok ? v : "";
}

/** A graduation year, 1950-2099 (the profiles CHECK range), as digits, else "". */
export function yearParam(v: string | undefined): string {
  if (!v || !/^\d{4}$/.test(v)) return "";
  const n = Number(v);
  return n >= 1950 && n <= 2099 ? v : "";
}
