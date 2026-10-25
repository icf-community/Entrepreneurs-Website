import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const checkMock = vi.hoisted(() => vi.fn());
const captureMessageMock = vi.hoisted(() => vi.fn());
const verifyOtpMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ratelimit", () => ({ check: checkMock }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: captureMessageMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { verifyOtpServerSide } from "./verifyOtpGate";

// This is the only throttle in front of supabase.auth.verifyOtp() — a
// 6-digit code with zero app-side guard is guessable. verifyOtpServerSide
// runs the gate AND the real verifyOtp call together, server-side, so there
// is no other path to GoTrue's verify endpoint this app exposes — unlike
// the old split (gate as one server action, verifyOtp on the browser
// client), which a script could call past entirely.

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  createClientMock.mockResolvedValue({ auth: { verifyOtp: verifyOtpMock } });
});

describe("verifyOtpServerSide", () => {
  it("rejects a blank email without ever calling the rate limiter or Supabase", async () => {
    const res = await verifyOtpServerSide("   ", "123456", "email");
    expect(res.ok).toBe(false);
    expect(checkMock).not.toHaveBeenCalled();
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("keys the otpVerify bucket on the normalised target email", async () => {
    checkMock.mockResolvedValue("allowed");
    verifyOtpMock.mockResolvedValue({
      data: { session: { access_token: "at", refresh_token: "rt", user: {} }, user: { email: "person@example.com" } },
      error: null,
    });
    await verifyOtpServerSide(" Person@Example.com ", "123456", "email");
    expect(checkMock).toHaveBeenCalledWith("otpVerify", "person@example.com");
  });

  it("blocks once the per-email guess limit is hit, without calling verifyOtp", async () => {
    checkMock.mockResolvedValue("limited");
    const res = await verifyOtpServerSide("person@example.com", "123456", "email");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too many attempts/i);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("fails closed and reports to Sentry when the bucket is unreachable", async () => {
    checkMock.mockResolvedValue("unavailable");
    const res = await verifyOtpServerSide("person@example.com", "123456", "email");
    expect(res.ok).toBe(false);
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("otpVerify"),
      expect.objectContaining({ level: "error" }),
    );
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("returns the session tokens on a successful verify", async () => {
    checkMock.mockResolvedValue("allowed");
    verifyOtpMock.mockResolvedValue({
      data: {
        session: { access_token: "at-123", refresh_token: "rt-456", user: { email: "person@example.com" } },
        user: { email: "person@example.com" },
      },
      error: null,
    });
    const res = await verifyOtpServerSide("person@example.com", "123456", "email");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.session).toEqual({ accessToken: "at-123", refreshToken: "rt-456" });
      expect(res.data.userEmail).toBe("person@example.com");
    }
  });

  it("treats a wrong/expired code as a failure", async () => {
    checkMock.mockResolvedValue("allowed");
    verifyOtpMock.mockResolvedValue({ data: { session: null, user: null }, error: { message: "Token has expired or is invalid" } });
    const res = await verifyOtpServerSide("person@example.com", "000000", "email");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/expired or is invalid/i);
  });

  it("treats a successful email_change single-confirmation (no session, no user) as ok with session null", async () => {
    checkMock.mockResolvedValue("allowed");
    verifyOtpMock.mockResolvedValue({ data: { session: null, user: null }, error: null });
    const res = await verifyOtpServerSide("person@example.com", "123456", "email_change");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.session).toBeNull();
      expect(res.data.userEmail).toBeNull();
    }
  });
});
