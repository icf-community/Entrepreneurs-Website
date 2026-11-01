import { describe, it, expect } from "vitest";
import { isImperialEmail } from "./imperialEmail";

describe("isImperialEmail", () => {
  it("accepts both Imperial domains", () => {
    expect(isImperialEmail("eve@imperial.ac.uk")).toBe(true);
    expect(isImperialEmail("eve@ic.ac.uk")).toBe(true);
  });

  it("is case- and whitespace-insensitive, like the SQL's lower()", () => {
    expect(isImperialEmail("  Eve@Imperial.AC.UK  ")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isImperialEmail("eve@gmail.com")).toBe(false);
    expect(isImperialEmail("eve@imperial.ac.uk.evil.com")).toBe(false);
  });

  // split_part(email, '@', 2) in the SQL takes the domain as written, so a
  // subdomain is not an Imperial domain there. This must agree, or the
  // client would wave through an address the trigger then rejects.
  it("rejects subdomains, matching split_part's exact-domain behaviour", () => {
    expect(isImperialEmail("eve@cs.imperial.ac.uk")).toBe(false);
  });

  it("rejects malformed input rather than throwing", () => {
    expect(isImperialEmail("")).toBe(false);
    expect(isImperialEmail("no-at-sign")).toBe(false);
    expect(isImperialEmail("trailing@")).toBe(false);
  });

  // The SQL used to take the second '@' segment only, so these passed there.
  it("rejects a second '@', whatever follows or precedes it", () => {
    expect(isImperialEmail("a@ic.ac.uk@evil.com")).toBe(false);
    expect(isImperialEmail("a@evil.com@ic.ac.uk")).toBe(false);
    expect(isImperialEmail('"a@ic.ac.uk"@evil.com')).toBe(false);
  });

  it("rejects an empty local part and whitespace inside it", () => {
    expect(isImperialEmail("@ic.ac.uk")).toBe(false);
    expect(isImperialEmail("a b@ic.ac.uk")).toBe(false);
  });
});
