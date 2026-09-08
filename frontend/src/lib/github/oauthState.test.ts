import { describe, it, expect } from "vitest";
import { githubConnectReturnPath } from "./oauthState";

// The callback route builds its redirect from this function alone.
// Reflecting anything from the request would be an open redirect, so the
// mapping being total — every input lands on one of two fixed paths — is
// the actual security property, not a convenience.
describe("githubConnectReturnPath", () => {
  it("routes the two known entry points to their own pages", () => {
    expect(githubConnectReturnPath("intake")).toBe("/intake");
    expect(githubConnectReturnPath("profile")).toBe("/profile");
  });

  it("defaults to the profile when the cookie is missing", () => {
    expect(githubConnectReturnPath(undefined)).toBe("/profile");
    expect(githubConnectReturnPath("")).toBe("/profile");
  });

  it("never reflects an attacker-supplied destination", () => {
    for (const hostile of [
      "https://evil.example/pwn",
      "//evil.example",
      "/admin",
      "../../etc/passwd",
      "javascript:alert(1)",
      "intake?next=https://evil.example",
    ]) {
      expect(githubConnectReturnPath(hostile)).toBe("/profile");
    }
  });
});
