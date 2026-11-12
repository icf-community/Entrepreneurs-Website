import { describe, expect, it } from "vitest";
import { escapeLike } from "./likeEscape";

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\dir")).toBe("c:\\\\dir");
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });
  it("leaves ordinary text alone", () => {
    expect(escapeLike("Ada Lovelace")).toBe("Ada Lovelace");
    expect(escapeLike("")).toBe("");
  });
});
