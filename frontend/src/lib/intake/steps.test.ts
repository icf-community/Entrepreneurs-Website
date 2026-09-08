import { describe, it, expect } from "vitest";
import { ORDER, STEPS, TOTAL_SCREENS, completeness, indexOf } from "./steps";

describe("intake step order", () => {
  it("puts youre-in right after face, before every other question", () => {
    expect(ORDER[0]).toBe("face");
    expect(ORDER[1]).toBe("youre-in");
    expect(ORDER.length).toBe(TOTAL_SCREENS);
  });

  it("has no duplicate or missing steps", () => {
    expect(new Set(ORDER).size).toBe(ORDER.length);
  });
});

describe("completeness", () => {
  it("is monotonically non-decreasing through the flow", () => {
    let prev = -1;
    for (const id of ORDER) {
      const pct = completeness(id);
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
  });

  it("reports the same value for youre-in as for face — a result, not progress", () => {
    expect(completeness("youre-in")).toBe(completeness("face"));
  });

  it("reaches 100% on the last question screen", () => {
    const last = ORDER[ORDER.length - 1];
    expect(completeness(last)).toBe(100);
  });

  it("starts above 0% on the first screen", () => {
    expect(completeness(ORDER[0])).toBeGreaterThan(0);
  });

  it("indexOf and ORDER agree", () => {
    ORDER.forEach((id, i) => expect(indexOf(id)).toBe(i));
  });
});

describe("github screen", () => {
  it("sits between the CV and Skills screens", () => {
    // Order matters: connecting GitHub navigates out to github.com and
    // back, and cvFile is excluded from the localStorage draft — so this
    // must come AFTER the CV has been uploaded, never on the same screen.
    expect(indexOf("github")).toBe(indexOf("cv") + 1);
    expect(indexOf("github")).toBeLessThan(indexOf("skills"));
  });

  it("advances completeness like any other question screen", () => {
    expect(completeness("github")).toBeGreaterThan(completeness("cv"));
    expect(completeness("github")).toBeLessThan(completeness("skills"));
  });

  it("carries a sidebar number, so it reads as a real step", () => {
    expect(STEPS.github.num).not.toBeNull();
  });

  it("keeps the sidebar numbering contiguous and in order", () => {
    const numbered = ORDER.map((id) => STEPS[id].num).filter((n): n is string => n !== null);
    expect(numbered).toEqual(numbered.map((_, i) => String(i + 1).padStart(2, "0")));
  });
});
