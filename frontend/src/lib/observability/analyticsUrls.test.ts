import { describe, it, expect } from "vitest";
import { sanitiseAnalyticsEvent, sanitiseAnalyticsUrl } from "./analyticsUrls";

describe("sanitiseAnalyticsUrl (F19)", () => {
  it("drops conversation and job ids from the AI page, keeping the mode", () => {
    expect(sanitiseAnalyticsUrl("https://www.example.com/foundry-ai?mode=recruiter&job=abc&c=def"))
      .toBe("https://www.example.com/foundry-ai?mode=recruiter");
    expect(sanitiseAnalyticsUrl("/foundry-ai?c=123")).toBe("/foundry-ai");
  });

  it("leaves every other page alone", () => {
    expect(sanitiseAnalyticsUrl("https://www.example.com/members?q=python")).toBe("https://www.example.com/members?q=python");
  });

  it("rewrites the URL properties of an event and nothing else", () => {
    const e = sanitiseAnalyticsEvent({ properties: { $current_url: "https://x.test/foundry-ai?c=1&mode=network", mode: "network" } });
    expect(e.properties).toEqual({ $current_url: "https://x.test/foundry-ai?mode=network", mode: "network" });
  });
});
