import { z } from "zod";
import { ok, err, type Result } from "@/lib/result";

// ════════════════════════════════════════════════════════════════════
// Foundry · Connections validation
//
// Shared by the connect dialog and the server actions, for the reason
// lib/validation/fields.ts records: when the client and server validate
// with different rules, the drift shows up as a form that submits and
// then fails for no visible reason.
//
// Every rule here is a MIRROR of one that already exists in SQL, and the
// SQL is the authority — a direct PostgREST call never reaches this file.
// The mirrors are: connection_clean_note() for the note, the
// connections_note_len CHECK for the bound, and
// connection_consent_version() for the version string.
// ════════════════════════════════════════════════════════════════════

// Mirrors connection_limits()->>'note_max_chars'. The config row can be
// retuned without a deploy, so a server refusal at a different number is
// possible and is handled the way every other RPC error is — by showing
// the sentence the database sent back. This constant is what the textarea
// counts against, not a second source of truth.
export const CONNECTION_NOTE_MAX = 300;

/**
 * Character count as POSTGRES counts it.
 *
 * `String.length` is UTF-16 code units, so every emoji outside the BMP
 * counts twice — a 300-emoji note would measure 600 here and 300 in the
 * database, and the composer would refuse a note the server accepts. The
 * column CHECK uses `length()`, which is code points, so this is too.
 */
export function noteLength(note: string): number {
  return [...note].length;
}

/**
 * The whitespace class Postgres's `\s` actually matches on this database.
 *
 * Not assumed — probed, character by character, against
 * `connection_clean_note` on the local stack, because JavaScript's `\s`
 * and Postgres's are each a superset of the other in one place:
 * JavaScript matches U+FEFF and Postgres does not, Postgres matches
 * U+0085 (NEL) and JavaScript does not. Both also match U+00A0 and
 * U+2028, which is what makes this worth pinning down — those two are
 * what you get pasting a note out of Word or off a web page, so they are
 * the realistic input, not an exotic one.
 *
 * Confirmed NOT whitespace on either side: U+200B, U+FEFF, U+180E,
 * U+2060. They survive cleaning, in both engines.
 */
const PG_WHITESPACE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const PG_WS_RUN = new RegExp(`${PG_WHITESPACE.source}+`, "gu");
const PG_WS_EDGES = new RegExp(`^${PG_WHITESPACE.source}+|${PG_WHITESPACE.source}+$`, "gu");

/**
 * Mirrors connection_clean_note(): control characters to spaces, runs of
 * whitespace collapsed, trimmed, empty becomes null.
 *
 * The `\p{Cc}` pass first, exactly as the SQL does `[[:cntrl:]]` first,
 * because a note is rendered as text and a stray U+0007 has no business
 * reaching a recipient's screen.
 *
 * This runs client-side so the member sees the note they will actually
 * send, and so the character counter counts what the database will
 * count. The database runs its own version regardless — this is a mirror,
 * never the enforcement.
 */
export function cleanNote(note: string): string | null {
  const cleaned = note
    .replace(/\p{Cc}/gu, " ")
    .replace(PG_WS_RUN, " ")
    .replace(PG_WS_EDGES, "");
  return cleaned === "" ? null : cleaned;
}

// The note is optional, and "" from an untouched textarea must mean "no
// note" rather than a validation error — hence the transform to null
// before the length check rather than a `.min(1)`.
const noteField = z
  .string()
  .max(4000, "That note is far too long.") // cheap pre-filter before the transform walks it
  .transform((v) => cleanNote(v))
  .refine((v) => v === null || noteLength(v) <= CONNECTION_NOTE_MAX, {
    message: `Your note must be ${CONNECTION_NOTE_MAX} characters or fewer.`,
  });

// consentVersion comes FROM THE CLIENT on purpose, and is not re-read
// server-side. It identifies the wording the member actually saw, and
// send_connection_request refuses anything that is not the current
// version with "please refresh" — which is the whole point: silently
// stamping today's version against yesterday's copy would make the
// Art. 7(1) evidence a lie. A server-side re-read would defeat that check.
const consentVersion = z.string().min(1).max(64);

export const sendRequestSchema = z.object({
  memberId: z.uuid("That member no longer exists."),
  note: noteField.nullish().transform((v) => v ?? null),
  consentVersion,
});

export type SendRequestPayload = z.infer<typeof sendRequestSchema>;

export const respondSchema = z.object({
  connectionId: z.uuid("That request is no longer pending."),
  accept: z.boolean(),
  // Only meaningful on accept — that is the act that releases the
  // addresses — but always sent, because the dialog that carries the copy
  // is the same dialog either way.
  consentVersion,
});

export type RespondPayload = z.infer<typeof respondSchema>;

// Same categories as post reports. Members should not have to learn two
// vocabularies for "this was inappropriate", and the admin queue reads
// better when one filter covers both surfaces.
export const CONNECTION_REPORT_CATEGORIES = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "sexual", label: "Sexual or explicit content" },
  { value: "spam", label: "Spam or advertising" },
  { value: "impersonation", label: "Impersonation" },
  { value: "illegal", label: "Illegal content" },
  { value: "other", label: "Something else" },
] as const;

export const reportConnectionSchema = z.object({
  connectionId: z.uuid("That connection no longer exists."),
  category: z.enum(
    CONNECTION_REPORT_CATEGORIES.map((c) => c.value) as [string, ...string[]],
    "Choose a reason.",
  ),
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more so an admin can act on this.")
    .max(1000, "Please keep this to 1000 characters or fewer."),
});

export type ReportConnectionPayload = z.infer<typeof reportConnectionSchema>;

export const memberIdSchema = z.object({
  memberId: z.uuid("That member no longer exists."),
});

export const connectionIdSchema = z.object({
  connectionId: z.uuid("That connection no longer exists."),
});

export const settingsSchema = z
  .object({
    emailsEnabled: z.boolean().nullish().transform((v) => v ?? null),
    openToConnections: z.boolean().nullish().transform((v) => v ?? null),
  })
  .refine((v) => v.emailsEnabled !== null || v.openToConnections !== null, {
    message: "Nothing to change.",
  });

// Matches validate() in lib/validation/listings.ts and validatePost() in
// posts.ts — returns a Result so a caller can `if (!parsed.ok) return
// parsed;` straight into its own signature.
export function validateConnection<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const res = schema.safeParse(input);
  if (!res.success) return err(res.error.issues[0]?.message ?? "Invalid input.");
  return ok(res.data) as Result<T>;
}
