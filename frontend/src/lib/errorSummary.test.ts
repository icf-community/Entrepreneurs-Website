import { describe, it, expect } from "vitest";
import { errorSummary } from "./errorSummary";

describe("errorSummary", () => {
  it("keeps the class and code, never the message", () => {
    const e = Object.assign(new TypeError("CV text: Jane Doe, 07700 900000"), { code: "E_PARSE" });
    const out = errorSummary(e);
    expect(out).toEqual({ name: "TypeError", code: "E_PARSE" });
    expect(JSON.stringify(out)).not.toContain("Jane");
  });

  it("handles non-errors", () => {
    expect(errorSummary("boom")).toEqual({ name: "string" });
    expect(errorSummary({ message: "secret" })).toEqual({ name: "Object" });
  });
});
