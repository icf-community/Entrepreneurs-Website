import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// Set before the module is imported: secret() reads process.env at call
// time, but keeping this first makes the dependency obvious.
beforeAll(() => {
  process.env.UPLOAD_TICKET_SECRET = "test-secret-not-a-real-key";
});

const { issueTicket, verifyTicket, uploadsEnabled, gatewayUploadUrl } = await import("./uploadTicket");

afterEach(() => {
  vi.useRealTimers();
});

const USER = "11111111-1111-1111-1111-111111111111";
const KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp";

describe("upload tickets", () => {
  it("round-trips the claims it was issued with", () => {
    const claims = verifyTicket(issueTicket({ userId: USER, key: KEY, purpose: "post_image" }));
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe(USER);
    expect(claims?.key).toBe(KEY);
    expect(claims?.purpose).toBe("post_image");
    // B21: the gateway checks these; they must match server/app/auth.py.
    expect(claims?.aud).toBe("foundry-gateway-upload");
    expect(claims?.iss).toBe("foundry-web");
  });

  it("rejects a ticket whose payload was edited", () => {
    // The attack this stops: swapping the key for one belonging to another
    // member's post, so the gateway writes over their image.
    const [header, payload, signature] = issueTicket({ userId: USER, key: KEY, purpose: "post_image" }).split(".");
    const tampered = JSON.parse(Buffer.from(payload, "base64url").toString());
    tampered.key = "ffffffff-ffff-ffff-ffff-ffffffffffff.webp";

    const forged = [
      header,
      Buffer.from(JSON.stringify(tampered)).toString("base64url"),
      signature,
    ].join(".");

    expect(verifyTicket(forged)).toBeNull();
  });

  it("rejects a ticket signed with a different secret", () => {
    const token = issueTicket({ userId: USER, key: KEY, purpose: "post_image" });
    process.env.UPLOAD_TICKET_SECRET = "a-different-secret";
    try {
      expect(verifyTicket(token)).toBeNull();
    } finally {
      process.env.UPLOAD_TICKET_SECRET = "test-secret-not-a-real-key";
    }
  });

  it("rejects a ticket once it has expired", () => {
    const token = issueTicket({ userId: USER, key: KEY, purpose: "post_image" });
    expect(verifyTicket(token)).not.toBeNull();

    // Tickets live 5 minutes; step past that.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
    expect(verifyTicket(token)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["not a JWT", "nonsense"],
    ["missing the signature", "a.b"],
    ["too many segments", "a.b.c.d"],
  ])("rejects a malformed token (%s)", (_label, token) => {
    expect(verifyTicket(token)).toBeNull();
  });

  it("caps the upload size in the claims, so the gateway need not guess", () => {
    const claims = verifyTicket(issueTicket({ userId: USER, key: KEY, purpose: "post_image" }));
    expect(claims?.max_bytes).toBe(8 * 1024 * 1024);
  });

  it("reports uploads as unavailable when the gateway is unconfigured", () => {
    const previous = process.env.UPLOAD_GATEWAY_URL;
    delete process.env.UPLOAD_GATEWAY_URL;
    try {
      // The composer hides the image control rather than offering one that
      // cannot work — a storage outage must not break posting entirely.
      expect(uploadsEnabled()).toBe(false);
    } finally {
      if (previous) process.env.UPLOAD_GATEWAY_URL = previous;
    }
  });

  it("carries the profile_picture and cv purposes through, distinct from post_image", () => {
    const avatarKey = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp";
    const cvKey = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cv";

    const avatarClaims = verifyTicket(
      issueTicket({ userId: USER, key: avatarKey, purpose: "profile_picture" }),
    );
    expect(avatarClaims?.purpose).toBe("profile_picture");

    const cvClaims = verifyTicket(issueTicket({ userId: USER, key: cvKey, purpose: "cv" }));
    expect(cvClaims?.purpose).toBe("cv");
  });

  it("routes each purpose to the gateway path that validates it", () => {
    process.env.UPLOAD_GATEWAY_URL = "https://api.example.test";
    expect(gatewayUploadUrl("post_image")).toBe("https://api.example.test/v1/images");
    expect(gatewayUploadUrl("profile_picture")).toBe("https://api.example.test/v1/images");
    expect(gatewayUploadUrl("cv")).toBe("https://api.example.test/v1/documents");
  });
});
