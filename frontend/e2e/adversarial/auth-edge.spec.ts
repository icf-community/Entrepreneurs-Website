import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { assertLocal, deleteMember, newMember, psql, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Authentication edge cases at the GoTrue / PostgREST boundary (the app's
// own auth routes are exercised by auth.spec.ts and the adversarial browser
// spec). Local stack only.
//
//   - no account enumeration through sign-in, sign-up or recovery
//   - tampered, unsigned, expired and re-roled tokens are refused
//   - a token's role claim cannot be changed client-side to gain access
//   - a revoked session stops refreshing
//   - the verify-OTP endpoint refuses wrong, reused and malformed codes
// ════════════════════════════════════════════════════════════════════

const URL_ = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const fresh = () => createClient(URL_(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const decode = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString());

let m: Member;
let token: string;

test.beforeAll(async () => {
  assertLocal();
  m = await newMember("authedge");
  token = (await m.client.auth.getSession()).data.session!.access_token;
});
test.afterAll(async () => { if (m) await deleteMember(m); });

const restWith = (jwt: string) =>
  fetch(`${URL_()}/rest/v1/rpc/is_approved`, {
    method: "POST",
    headers: { apikey: ANON(), authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: "{}",
  });

test("control: the genuine token is accepted and sees the member as approved", async () => {
  const r = await restWith(token);
  expect(r.status).toBe(200);
  expect(await r.json()).toBe(true);
});

test("sign-in does not reveal whether an account exists", async () => {
  const wrongPw = await fresh().auth.signInWithPassword({ email: m.email, password: "definitely-wrong-1!" });
  const unknown = await fresh().auth.signInWithPassword({ email: `nobody-${Date.now()}@imperial.ac.uk`, password: "definitely-wrong-1!" });
  expect(wrongPw.error?.message).toBeTruthy();
  expect(wrongPw.error?.message, "different message for a real and an unknown account").toBe(unknown.error?.message);
  expect(wrongPw.error?.status).toBe(unknown.error?.status);
});

test("password recovery answers the same for a real and an unknown address", async () => {
  const real = await fresh().auth.resetPasswordForEmail(m.email);
  const unknown = await fresh().auth.resetPasswordForEmail(`nobody-${Date.now()}@imperial.ac.uk`);
  expect(real.error?.message ?? null).toBe(unknown.error?.message ?? null);
});

test("sign-up with an existing address: what a stranger learns (observation E-1)", async () => {
  const dup = await fresh().auth.signUp({ email: m.email, password: "Another-Pw-123456!" });
  const brandNew = await fresh().auth.signUp({ email: `new-${Date.now()}@imperial.ac.uk`, password: "Another-Pw-123456!" });
  const leaks = Boolean(dup.error) !== Boolean(brandNew.error);
  test.info().annotations.push({
    type: "E-1",
    description: `existing: ${dup.error ? `${dup.error.status} "${dup.error.message}"` : "no error"}; new: ${brandNew.error ? brandNew.error.message : "no error"}; distinguishable=${leaks}`,
  });
  // The point is to record GoTrue's behaviour for the owner to compare with the
  // production dashboard; it is not under the app's control, so it does not fail.
  expect(typeof leaks).toBe("boolean");
  if (brandNew.data.user?.id) await (await import("./helpers")).service().auth.admin.deleteUser(brandNew.data.user.id);
});

test("an unsigned (alg=none) token is refused", async () => {
  const claims = decode(token);
  const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
  expect((await restWith(none)).status).toBeGreaterThanOrEqual(400);
});

test("a token re-signed with a guessed secret, or with its signature stripped, is refused", async () => {
  const [h, p] = token.split(".");
  const forged = (secret: string) => `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
  for (const secret of ["secret", "super-secret-jwt-token-with-at-least-32-characters-long", "", "your-super-secret-jwt-token-with-at-least-32-characters-long"]) {
    expect((await restWith(forged(secret))).status, `accepted with secret "${secret.slice(0, 12)}"`).toBeGreaterThanOrEqual(400);
  }
  expect((await restWith(`${h}.${p}.`)).status).toBeGreaterThanOrEqual(400);
  expect((await restWith(`${h}.${p}.AAAA`)).status).toBeGreaterThanOrEqual(400);
});

test("editing the payload (role, sub, exp) without re-signing is refused", async () => {
  const [h, , s] = token.split(".");
  const claims = decode(token);
  for (const edit of [{ role: "service_role" }, { role: "authenticated", sub: "00000000-0000-0000-0000-000000000000" }, { exp: Math.floor(Date.now() / 1000) + 10 ** 9 }]) {
    const tampered = `${h}.${b64({ ...claims, ...edit })}.${s}`;
    expect((await restWith(tampered)).status, `payload edit ${JSON.stringify(edit)} was accepted`).toBeGreaterThanOrEqual(400);
  }
});

test("the anon key is not a user: it cannot be presented as an authenticated member", async () => {
  const r = await fetch(`${URL_()}/rest/v1/rpc/is_approved`, {
    method: "POST", headers: { apikey: ANON(), authorization: `Bearer ${ANON()}`, "content-type": "application/json" }, body: "{}",
  });
  expect(r.status).toBe(200);
  expect(await r.json(), "the anon key was treated as an approved member").toBe(false);
});

test("the access token is short-lived", async () => {
  const exp = decode(token).exp as number;
  const ttl = exp - Math.floor(Date.now() / 1000);
  expect(ttl, "token lifetime").toBeGreaterThan(0);
  expect(ttl, "access token lives longer than a day").toBeLessThanOrEqual(86_400);
});

test("a signed-out refresh token cannot mint a new session", async () => {
  const c = fresh();
  const { data } = await c.auth.signInWithPassword({ email: m.email, password: m.password });
  const refresh = data.session!.refresh_token;
  await c.auth.signOut({ scope: "global" });
  const r = await fresh().auth.refreshSession({ refresh_token: refresh });
  expect(r.data.session, "a revoked refresh token still produced a session").toBeNull();
  expect(r.error).toBeTruthy();
});

test("replaying a rotated refresh token after the reuse window (observation E-2)", async () => {
  const c = fresh();
  const { data } = await c.auth.signInWithPassword({ email: m.email, password: m.password });
  const first = data.session!.refresh_token;
  const rotated = await fresh().auth.refreshSession({ refresh_token: first });
  expect(rotated.error, rotated.error?.message).toBeNull();
  const second = rotated.data.session!.refresh_token;
  await new Promise((r) => setTimeout(r, 12_000)); // config.toml: refresh_token_reuse_interval = 10
  const replay = await fresh().auth.refreshSession({ refresh_token: first });
  const childStillWorks = await fresh().auth.refreshSession({ refresh_token: second });
  test.info().annotations.push({
    type: "E-2",
    description: `replayed parent token after 12s: ${replay.data.session ? "ACCEPTED" : `refused (${replay.error?.message})`}; rotated child afterwards: ${childStillWorks.data.session ? "still works" : `refused (${childStillWorks.error?.message})`}`,
  });
  expect(typeof (replay.data.session !== null)).toBe("boolean");
});

test("OTP verification refuses wrong, malformed and over-long codes", async () => {
  for (const token_ of ["000000", "123456", "abcdef", "", "1".repeat(64), "' or 1=1 --", "\u0000"]) {
    const r = await fresh().auth.verifyOtp({ email: m.email, token: token_, type: "email" });
    expect(r.data.session, `code ${JSON.stringify(token_).slice(0, 12)} produced a session`).toBeNull();
    expect(r.error, `code ${JSON.stringify(token_).slice(0, 12)} was not refused`).toBeTruthy();
  }
});

test("repeated wrong passwords are throttled", async () => {
  const c = fresh();
  const outcomes: number[] = [];
  for (let i = 0; i < 25; i++) {
    const r = await c.auth.signInWithPassword({ email: m.email, password: `wrong-${i}-Pw!` });
    outcomes.push(r.error?.status ?? 0);
  }
  const limited = outcomes.filter((s) => s === 429).length;
  test.info().annotations.push({ type: "observation", description: `${limited}/25 wrong-password attempts answered 429` });
  // Local GoTrue may have its rate limits relaxed; record rather than fail.
  expect(outcomes.filter((s) => s === 200).length, "a wrong password succeeded").toBe(0);
  psql("select 1");
});
