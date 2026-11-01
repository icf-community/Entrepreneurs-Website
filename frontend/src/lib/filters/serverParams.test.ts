import { describe, it, expect } from "vitest";
import { flattenSearchParams, pageParam, isoDayParam, yearParam } from "./serverParams";

// Next hands a page `string | string[] | undefined` per key: a repeated
// parameter (?skill=1&skill=2) arrives as an array. The directory pages
// treated every value as a string and called .split on it, so a crafted link
// crashed them (adversarial sweep F3).
describe("flattenSearchParams", () => {
  it("passes plain strings through untouched", () => {
    expect(flattenSearchParams({ q: "ada", page: "2" }, [])).toEqual({ q: "ada", page: "2" });
  });

  it("joins repeated values of a list key with commas, so ?skill=1&skill=2 means both", () => {
    expect(flattenSearchParams({ skill: ["1", "2"] }, ["skill"])).toEqual({ skill: "1,2" });
  });

  it("keeps only the first value of a repeated scalar key", () => {
    expect(flattenSearchParams({ q: ["first", "second"], page: ["3", "9"] }, ["skill"])).toEqual({ q: "first", page: "3" });
  });

  it("returns undefined for an empty array rather than throwing", () => {
    expect(flattenSearchParams({ q: [], skill: [] }, ["skill"])).toEqual({ q: undefined, skill: undefined });
  });

  it("never yields a non-string, whatever the input shape", () => {
    const out = flattenSearchParams({ a: ["x"], b: [], c: undefined, d: "y" }, ["a"]);
    for (const v of Object.values(out)) expect(v === undefined || typeof v === "string").toBe(true);
  });

  it("does not mutate the input or inherit from prototypes", () => {
    const input = { skill: ["1", "2"] };
    flattenSearchParams(input, ["skill"]);
    expect(input).toEqual({ skill: ["1", "2"] });
    expect(Object.getPrototypeOf(flattenSearchParams({}, []))).toBe(null);
  });
});

// The same boundary, the values that survive it. These all used to reach
// Postgres and come back as an error that was logged, swallowed into an empty
// list and sent to Sentry: a NUL byte in a search (22P05), page=1e21 turning
// into the offset 2.4e+21 (22P02), a date like 2026-13-45 (22008) and a
// graduation year past int4 (22003).
describe("flattenSearchParams sanitising", () => {
  it("strips NUL bytes and caps length", () => {
    const out = flattenSearchParams({ q: "a\u0000b", long: "x".repeat(20_000) }, []);
    expect(out.q).toBe("ab");
    expect(out.long!.length).toBeLessThanOrEqual(500);
  });
  it("sanitises every element of a repeated list key", () => {
    expect(flattenSearchParams({ skill: ["1\u0000", "2"] }, ["skill"]).skill).toBe("1,2");
  });
});

describe("pageParam", () => {
  it.each([[undefined, 1], ["", 1], ["abc", 1], ["-3", 1], ["0", 1], ["1.9", 1], ["2", 2], ["99999999999999999999", 1], ["1e21", 1], ["10001", 1], ["10000", 10000]])(
    "%j -> %j", (v, want) => expect(pageParam(v as string | undefined)).toBe(want));
});

describe("isoDayParam", () => {
  it.each([["2026-09-15", "2026-09-15"], ["2026-02-30", ""], ["2026-13-45", ""], ["9999-12-31", ""], ["0001-01-01", ""], ["x", ""], [undefined, ""], ["2026-9-5", ""]])(
    "%j -> %j", (v, want) => expect(isoDayParam(v as string | undefined)).toBe(want));
});

describe("yearParam", () => {
  it.each([["2026", "2026"], ["1949", ""], ["2100", ""], ["99999999999", ""], ["20.5", ""], ["abc", ""], ["", ""], [undefined, ""], ["-2026", ""]])(
    "%j -> %j", (v, want) => expect(yearParam(v as string | undefined)).toBe(want));
});

