import { describe, it, expect, vi } from "vitest";
import { describeSupabaseError, isAlreadyHandledError, ALREADY_HANDLED_MESSAGE } from "./supabaseErrors";

describe("describeSupabaseError", () => {
  it("handles null/undefined", () => {
    expect(describeSupabaseError(null)).toBe("Something went wrong.");
    expect(describeSupabaseError(undefined)).toBe("Something went wrong.");
  });

  it("passes a string through unchanged", () => {
    expect(describeSupabaseError("custom message")).toBe("custom message");
  });

  it("maps JWT/session errors (code + message sniff)", () => {
    expect(describeSupabaseError({ code: "PGRST301" })).toMatch(/session has expired/i);
    expect(describeSupabaseError({ message: "JWT expired" })).toMatch(/session has expired/i);
    expect(describeSupabaseError({ message: "invalid claim: bad" })).toMatch(/session has expired/i);
  });

  it("maps RLS denial (42501): generic for Postgres's wording, passthrough for ours", () => {
    expect(describeSupabaseError({ code: "42501" })).toBe("You don't have permission to do that.");
    // Postgres's own denials say nothing useful to an end user.
    expect(
      describeSupabaseError({
        code: "42501",
        message: 'new row violates row-level security policy for table "events"',
      }),
    ).toBe("You don't have permission to do that.");
    expect(describeSupabaseError({ code: "42501", message: "permission denied for table events" }))
      .toBe("You don't have permission to do that.");
    // Messages our own SECURITY DEFINER RPCs raise are written for the user.
    expect(describeSupabaseError({ code: "42501", message: "Forbidden: not yours" })).toBe(
      "Forbidden: not yours",
    );
    expect(describeSupabaseError({ code: "42501", message: "Only pending listings can be edited" }))
      .toBe("Only pending listings can be edited");
  });

  it("maps unique-violation (23505), email-specific then generic", () => {
    expect(describeSupabaseError({ code: "23505", message: 'duplicate key "users_email_key"' })).toBe(
      "That email is already registered.",
    );
    expect(describeSupabaseError({ code: "23505", message: "duplicate key" })).toBe(
      "That value is already taken.",
    );
  });

  it("maps check-constraint (23514) by name, then falls back", () => {
    expect(
      describeSupabaseError({ code: "23514", message: 'violates check constraint "opportunities_description_len"' }),
    ).toBe("Description must be between 20 and 5000 characters.");
    expect(
      describeSupabaseError({ code: "23514", message: 'violates check constraint "unknown_constraint"' }),
    ).toMatch(/rejected by a validation rule/i);
  });

  it("maps the URL-length check constraints to 512-character messages", () => {
    expect(
      describeSupabaseError({ code: "23514", message: 'violates check constraint "profiles_linkedin_url_len"' }),
    ).toBe("LinkedIn URL must be 512 characters or fewer.");
    expect(
      describeSupabaseError({ code: "23514", message: 'violates check constraint "opportunities_apply_url_len"' }),
    ).toBe("Application portal URL must be 512 characters or fewer.");
    expect(
      describeSupabaseError({ code: "23514", message: 'violates check constraint "events_luma_link_len"' }),
    ).toBe("Luma link must be 512 characters or fewer.");
    expect(
      describeSupabaseError({ code: "23514", message: 'violates check constraint "vcs_grants_link_len"' }),
    ).toBe("Link must be 512 characters or fewer.");
  });

  it("passes through a hand-raised 23514 from a per-profile cap trigger", () => {
    // profile_interests_per_profile_cap and profile_skills_cap_core can't be
    // real CHECK constraints (a CHECK can't count sibling rows), so they're
    // enforced by a trigger that raises errcode 23514 with a message already
    // written for the user. Verified live against PostgREST that `RAISE ...
    // USING CONSTRAINT = 'x'` does NOT inject `constraint "x"` into the
    // message text — these must not fall into the native-constraint path.
    expect(
      describeSupabaseError({ code: "23514", message: "You can add up to 12 entries in this section." }),
    ).toBe("You can add up to 12 entries in this section.");
    expect(
      describeSupabaseError({ code: "23514", message: "At most 3 core skills are allowed" }),
    ).toBe("At most 3 core skills are allowed");
  });

  it("maps FK violation (23503) and not-found (PGRST116)", () => {
    expect(describeSupabaseError({ code: "23503" })).toBe("That item no longer exists.");
    expect(describeSupabaseError({ code: "PGRST116" })).toBe("Not found.");
    expect(describeSupabaseError({ message: "no rows returned" })).toBe("Not found.");
  });

  it("maps network errors", () => {
    expect(describeSupabaseError({ message: "Failed to fetch" })).toMatch(/Network error/i);
  });

  it("does NOT leak an unmapped database message to the user", () => {
    // The whole point: constraint names, column names and, on a unique
    // violation, the conflicting value used to arrive in the UI verbatim.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = describeSupabaseError({
      code: "99999",
      message: 'duplicate key value violates unique constraint "profiles_signup_email_key" DETAIL: Key (signup_email)=(someone@imperial.ac.uk) already exists.',
    });
    expect(out).toBe("Something went wrong. Please try again.");
    expect(out).not.toMatch(/imperial\.ac\.uk|constraint|Key \(/);
    // ...but the diagnostic is still recorded for whoever is on call.
    expect(spy).toHaveBeenCalledWith(
      "Unmapped database error surfaced to a user:",
      expect.objectContaining({ code: "99999" }),
    );
    spy.mockRestore();
  });

  it("still passes through the messages our own RPCs write for the user", () => {
    // 42501 raised by a SECURITY DEFINER function with a human message is
    // the one case where the server's wording is the useful wording.
    expect(
      describeSupabaseError({ code: "42501", message: "Only pending listings can be edited" }),
    ).toBe("Only pending listings can be edited");
    // Postgres's own RLS wording is not.
    expect(
      describeSupabaseError({
        code: "42501",
        message: "new row violates row-level security policy for table \"profiles\"",
      }),
    ).toBe("You don't have permission to do that.");
  });

  it("passes through 22023 / 22001 / P0002 sentences our RPCs write for the user", () => {
    // These were being flattened into "Something went wrong." — which is
    // most of the connections feature's vocabulary, and a good deal of
    // create_post's and submit_intake's too.
    expect(
      describeSupabaseError({ code: "22023", message: "That request is no longer pending." }),
    ).toBe("That request is no longer pending.");
    expect(
      describeSupabaseError({
        code: "22023",
        message: "You can't send a request to this member right now.",
      }),
    ).toBe("You can't send a request to this member right now.");
    expect(
      describeSupabaseError({ code: "22001", message: "Your note must be 300 characters or fewer." }),
    ).toBe("Your note must be 300 characters or fewer.");
    expect(describeSupabaseError({ code: "P0002", message: "Profile not found" })).toBe(
      "Profile not found",
    );
  });

  it("does NOT pass through Postgres's own 22023 / 22001 wording", () => {
    // The engine's own messages on these codes are lowercase technical
    // fragments carrying types, lengths and column names. Our RPCs never
    // raise one that starts lowercase, which is the whole discriminator.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      describeSupabaseError({
        code: "22001",
        message: "value too long for type character varying(50)",
      }),
    ).toBe("Something went wrong. Please try again.");
    expect(
      describeSupabaseError({
        code: "22023",
        message: "invalid regular expression: quantifier operand invalid",
      }),
    ).toBe("Something went wrong. Please try again.");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// Adversarial sweep F5. Two admins act on the same listing; the loser's RPC
// raises a plain `raise exception` (SQLSTATE P0001) such as "Event is not
// pending review (status=approved)". That text carries an internal status and
// sometimes an id, so it must never be shown, but flattening it to "Something
// went wrong" told the admin nothing about what to do.
describe("already-handled admin actions (P0001)", () => {
  const RAISED = [
    "Event is not pending review (status=approved)",
    "Opportunity is not pending review (status=rejected)",
    "VC/grant is not pending review (status=approved)",
    "User is not pending review (status=approved)",
    "Event not found: 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b",
    "Opportunity not found: 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b",
    "VC/grant not found: 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b",
    "Profile not found: 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b",
    "User not found: 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b",
  ];

  it.each(RAISED)("maps %j to one fixed sentence that leaks nothing", (message) => {
    const out = describeSupabaseError({ code: "P0001", message });
    expect(out).toBe(ALREADY_HANDLED_MESSAGE);
    expect(out).not.toMatch(/status=|[0-9a-f]{8}-[0-9a-f]{4}|approved|rejected/i);
    expect(isAlreadyHandledError({ code: "P0001", message })).toBe(true);
  });

  it("recognises it only for P0001, so another code with the same words is not swallowed", () => {
    expect(isAlreadyHandledError({ code: "42501", message: "Event is not pending review (status=approved)" })).toBe(false);
    expect(isAlreadyHandledError({ message: "Event is not pending review (status=approved)" })).toBe(false);
  });

  it("does not claim 'already handled' for unrelated P0001 errors, which stay generic", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const message of ["boom: relation \"x\" does not exist", "Something internal 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b"]) {
      expect(isAlreadyHandledError({ code: "P0001", message })).toBe(false);
      expect(describeSupabaseError({ code: "P0001", message })).toBe("Something went wrong. Please try again.");
    }
    spy.mockRestore();
  });

  it("handles null and strings", () => {
    expect(isAlreadyHandledError(null)).toBe(false);
    expect(isAlreadyHandledError("Event is not pending review (status=approved)")).toBe(false);
  });
});

// Adversarial sweep F8: Postgres's own wording for out-of-range numbers and
// dates carries the offending value and type names; none of it may be shown,
// but "a number/date is out of range" is something the member can act on.
describe("out-of-range values and the new listing constraints", () => {
  it("maps numeric and datetime range errors to a readable sentence, never the engine text", () => {
    const cases = [
      { code: "22003", message: 'value "999999" is out of range for type smallint' },
      { code: "22008", message: 'date/time field value out of range: "2027-02-30"' },
      { code: "22007", message: 'invalid input syntax for type date: "soon"' },
    ];
    for (const c of cases) {
      const out = describeSupabaseError(c);
      expect(out).toMatch(/number|date/i);
      expect(out).not.toMatch(/smallint|999999|2027-02-30|syntax|type /i);
    }
  });

  it.each([
    "opportunities_contact_email_max", "events_contact_email_max",
    "opportunities_position_name_nonblank", "opportunities_company_nonblank",
    "events_title_nonblank", "events_organiser_name_nonblank", "vcs_grants_name_nonblank",
    "opportunities_deadline_sane", "vcs_grants_deadline_sane", "events_event_at_sane",
  ])("gives %s its own message instead of the generic validation line", (name) => {
    const out = describeSupabaseError({ code: "23514", message: `new row for relation "x" violates check constraint "${name}"` });
    expect(out).not.toBe("One of the values you entered was rejected by a validation rule.");
    expect(out).not.toContain(name);
  });
});

