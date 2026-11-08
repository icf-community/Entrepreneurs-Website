import { describe, it, expect } from "vitest";
import { AuthInvalidJwtError, type SupabaseClient } from "@supabase/supabase-js";
import { currentUser } from "./currentUser";

const client = (result: unknown) =>
  ({ auth: { getClaims: async () => result, getUser: async () => { throw new Error("getUser must not be called"); } } }) as unknown as SupabaseClient;

describe("currentUser (B26)", () => {
  it("reads the user from verified claims, without asking Auth", async () => {
    const { user, error } = await currentUser(client({ data: { claims: { sub: "u1", email: "a@imperial.ac.uk" } }, error: null }));
    expect(user).toEqual({ id: "u1", email: "a@imperial.ac.uk" });
    expect(error).toBeNull();
  });

  it("carries the sign-in providers from app_metadata, and ignores a malformed value", async () => {
    const claims = (app_metadata: unknown) => client({ data: { claims: { sub: "u1", app_metadata } }, error: null });
    expect((await currentUser(claims({ providers: ["google", "email"] }))).user?.providers).toEqual(["google", "email"]);
    expect((await currentUser(claims({ providers: "email" }))).user?.providers).toBeUndefined();
    expect((await currentUser(claims(undefined))).user?.providers).toBeUndefined();
  });

  it("no session is signed out, not an error", async () => {
    expect(await currentUser(client({ data: null, error: null }))).toEqual({ user: null, error: null });
  });

  it("a forged or expired token is signed out, with the error kept for the outage check", async () => {
    const bad = new AuthInvalidJwtError("Invalid JWT signature");
    expect(await currentUser(client({ data: null, error: bad }))).toEqual({ user: null, error: bad });
  });

  it("claims without a subject are not a user", async () => {
    expect((await currentUser(client({ data: { claims: { email: "x@y" } }, error: null }))).user).toBeNull();
  });
});
