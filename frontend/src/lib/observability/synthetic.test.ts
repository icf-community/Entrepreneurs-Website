import { describe, it, expect } from "vitest";
import { isSyntheticEmail } from "./synthetic";

describe("isSyntheticEmail", () => {
  it.each([
    "user1@loadtest.foundry.invalid",
    "X@LOADTEST.FOUNDRY.INVALID",
    "delivered+42@resend.dev",
  ])("%s is synthetic", (e) => expect(isSyntheticEmail(e)).toBe(true));

  it.each([
    "eve@imperial.ac.uk",
    "someone@gmail.com",
    "invalid@imperial.ac.uk",
    "resend.dev@gmail.com",
    null,
    undefined,
    "",
  ])("%s is real", (e) => expect(isSyntheticEmail(e)).toBe(false));
});
