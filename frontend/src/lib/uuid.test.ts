import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

// Route ids go straight into uuid-typed RPC parameters. Anything that is not
// a uuid made Postgres raise 22P02, which surfaced as an error page on edit
// routes and a logged 22P02 (plus an HTTP 200 "not found" body) on detail
// routes (adversarial sweep F4).
describe("isUuid", () => {
  it.each([
    "7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b",
    "7D9B2C1E-4F3A-4B8D-9A6E-1C2D3E4F5A6B",
    "00000000-0000-0000-0000-000000000000",
  ])("accepts %s", (v) => expect(isUuid(v)).toBe(true));

  it.each([
    "", "0", "not-a-uuid", "..%2f..%2fetc", "../../etc/passwd", "\u0000",
    "7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6", // one short
    "7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6bb", // one long
    "7d9b2c1e4f3a4b8d9a6e1c2d3e4f5a6b", // no dashes
    " 7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b", // leading space
    "7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b\n", // trailing newline ($ would match without care)
    "7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6g",
    "x".repeat(10_000),
  ])("rejects %j", (v) => expect(isUuid(v)).toBe(false));

  it("rejects non-strings without throwing", () => {
    for (const v of [undefined, null, 123, {}, ["7d9b2c1e-4f3a-4b8d-9a6e-1c2d3e4f5a6b"]]) {
      expect(isUuid(v as never)).toBe(false);
    }
  });
});
