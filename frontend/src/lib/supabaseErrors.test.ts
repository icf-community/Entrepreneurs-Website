import { describe, it, expect, vi } from "vitest";
import { describeSupabaseError } from "./supabaseErrors";

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
