import { describe, expect, it } from "vitest";
import { COMPANY_LINE, withCompanyFooter } from "./emailFooter";

describe("withCompanyFooter", () => {
  it("adds the registered name, number and office to both bodies", () => {
    const { text, html } = withCompanyFooter("Hi", "<p>Hi</p>");
    for (const body of [text, html]) {
      expect(body).toContain("IC Founders Ltd");
      expect(body).toContain("17171277");
      expect(body).toContain("Shelton Street");
    }
    expect(text.startsWith("Hi\n")).toBe(true);
    expect(html.startsWith("<p>Hi</p>")).toBe(true);
    expect(COMPANY_LINE).not.toMatch(/[<>]/);
  });
});
