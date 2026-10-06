import { z } from "zod";
import { ok, err, type Result } from "@/lib/result";

// ════════════════════════════════════════════════════════════════════
// Server-side input validation for listing submissions.
//
// The submission forms used to call supabase.rpc(...) directly from the
// browser, so the only validation was client-side (trivially bypassable)
// plus whatever the SECURITY DEFINER RPCs enforce. These schemas run
// inside the server actions that now sit in front of the RPCs, so every
// field is checked on the server before a row is ever touched.
//
// Rules mirror the client-side checks already in *Form.tsx + the column
// maxLengths, so a normal submission that passes the UI also passes here.
// ════════════════════════════════════════════════════════════════════

const httpUrl = z
  .string()
  .trim()
  // 512 matches the DB-level *_url_len CHECK constraints (see migration
  // 20260602000004). Far larger than any real URL here; bump both together.
  .max(512, "URL must be 512 characters or fewer.")
  .regex(/^https?:\/\//i, "Must be a valid URL starting with http:// or https://");

const email = z
  .string()
  .trim()
  .max(254, "Email is too long.")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Email is invalid.");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.");

// Returns the start of *today* in local time, for "deadline must be today
// or later" comparisons that ignore the clock time.
function startOfToday(): Date {
  return new Date(new Date().toDateString());
}

export const opportunitySchema = z
  .object({
    positionName: z.string().trim().min(2, "Role title is required.").max(200),
    company: z.string().trim().min(1, "Company is required.").max(200),
    pay: z.string().trim().min(1, "Salary / compensation is required.").max(100),
    locationType: z.enum(["remote", "hybrid", "onsite"]),
    locationText: z.string().trim().max(200).nullable(),
    description: z.string().trim().min(20, "Description must be at least 20 characters.").max(5000),
    startMonth: z.number().int().min(1).max(12),
    startYear: z.number().int().min(2000).max(2100),
    applicationDeadline: isoDate,
    contactEmail: email,
    contactEmailVisible: z.boolean(),
    applyMethod: z.enum(["email", "link"]),
    applyUrl: httpUrl.nullable(),
    skillIds: z.array(z.number().int()).max(50),
    sectorIds: z.array(z.number().int()).max(50),
    // Who may see and apply (AI-plan §7.2): students, graduates (any
    // affiliation) or both. Required on every new or edited job.
    eligibleAudience: z.enum(["students", "graduates", "both"], {
      message: "Choose who this job is for.",
    }),
  })
  .refine((v) => v.locationType === "remote" || !!v.locationText, {
    message: "Please provide a location for hybrid or onsite roles.",
    path: ["locationText"],
  })
  .refine((v) => new Date(v.applicationDeadline) >= startOfToday(), {
    message: "Application deadline must be today or later.",
    path: ["applicationDeadline"],
  })
  .refine((v) => v.applyMethod !== "link" || !!v.applyUrl, {
    message: "Application portal URL is required when applying via link.",
    path: ["applyUrl"],
  });

export type OpportunityPayload = z.infer<typeof opportunitySchema>;

export const eventSchema = z.object({
  title: z.string().trim().min(2, "Title is required.").max(200),
  description: z.string().trim().min(20, "Description must be at least 20 characters.").max(5000),
  lumaLink: httpUrl,
  eventAtIso: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date/time.")
    // Was enforced only in EventForm, so the server accepted an event in the
    // past. The five-minute grace absorbs the round trip (and any clock skew
    // between the browser and the server) for someone submitting an event
    // that starts imminently.
    .refine((s) => Date.parse(s) > Date.now() - 5 * 60_000, "Event must start in the future."),
  location: z.string().trim().min(1, "Location is required.").max(200),
  organiserName: z.string().trim().min(1, "Organiser name is required.").max(200),
  contactEmail: email,
  contactEmailVisible: z.boolean(),
  // Admin-only flag (External vs Society event). Optional because user
  // submissions never send it; the server action only forwards it in
  // admin mode and the DB trigger rejects non-admin attempts to set it.
  isSocietyEvent: z.boolean().optional(),
});

export type EventPayload = z.infer<typeof eventSchema>;

export const vcGrantSchema = z.object({
  kind: z.enum(["vc", "grant"]),
  name: z.string().trim().min(2, "Name is required.").max(200),
  description: z.string().trim().min(20, "Description must be at least 20 characters.").max(5000),
  link: httpUrl,
  amount: z.string().trim().max(100).nullable(),
  deadline: isoDate.nullable(),
  stage: z.string().trim().max(100).nullable(),
});

export type VcGrantPayload = z.infer<typeof vcGrantSchema>;

// Parse helper: returns the validated data on success, or an err Result
// carrying the first human-readable issue so callers can `if (!parsed.ok)
// return parsed;` straight into their own Result-typed signature.
export function validate<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const res = schema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0];
    return err(first?.message ?? "Invalid input.");
  }
  return ok(res.data) as Result<T>;
}
