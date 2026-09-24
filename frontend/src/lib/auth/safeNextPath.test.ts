import { describe, it, expect } from "vitest";
import { safeNextPath } from "./safeNextPath";

const ORIGIN = "https://foundry.example";

describe("safeNextPath", () => {
  it("passes through a plain relative path", () => {
    expect(safeNextPath("/connections", ORIGIN)).toBe("/connections");
  });

  it("keeps the query string and hash", () => {
    expect(safeNextPath("/connections?tab=pending#top", ORIGIN)).toBe(
      "/connections?tab=pending#top",
    );
  });

  it("rejects null, undefined and empty", () => {
    expect(safeNextPath(null, ORIGIN)).toBeNull();
    expect(safeNextPath(undefined, ORIGIN)).toBeNull();
    expect(safeNextPath("", ORIGIN)).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeNextPath("//evil.example", ORIGIN)).toBeNull();
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeNextPath("https://evil.example", ORIGIN)).toBeNull();
    expect(safeNextPath("http://evil.example/path", ORIGIN)).toBeNull();
  });

  // The actual bypass this function exists to close: a leading backslash
  // is a path separator to the WHATWG URL parser for a special scheme,
  // so "/\evil.example" is NOT a same-origin path — it's evil.example.
  it("rejects a leading-backslash host-switch payload", () => {
    expect(safeNextPath("/\\evil.example", ORIGIN)).toBeNull();
    expect(safeNextPath("/\\\\evil.example", ORIGIN)).toBeNull();
  });

  it("rejects an embedded-tab host-switch payload", () => {
    expect(safeNextPath("/\t/evil.example", ORIGIN)).toBeNull();
  });

  it("allows a same-origin absolute URL, reduced to its path", () => {
    expect(safeNextPath(`${ORIGIN}/settings`, ORIGIN)).toBe("/settings");
  });

  it("rejects unparsable input", () => {
    expect(safeNextPath("http://", ORIGIN)).toBeNull();
  });
});
