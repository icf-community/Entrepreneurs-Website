import { describe, it, expect } from "vitest";
import { externalHref } from "./safeUrl";

describe("externalHref", () => {
  it("passes http and https through", () => {
    expect(externalHref("https://lu.ma/abc123")).toBe("https://lu.ma/abc123");
    expect(externalHref("http://example.com/a?b=c#d")).toBe("http://example.com/a?b=c#d");
  });

  it("returns undefined for empty input rather than an empty href", () => {
    // An `href=""` re-navigates to the current page on click, which is a
    // worse failure than no link at all.
    expect(externalHref(null)).toBeUndefined();
    expect(externalHref(undefined)).toBeUndefined();
    expect(externalHref("")).toBeUndefined();
  });

  it("refuses every scheme that can execute or embed", () => {
    // The whole point of the module. `javascript:` in an href runs on
    // click with no console and no network request.
    for (const hostile of [
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/uuid",
    ]) {
      expect(externalHref(hostile), hostile).toBeUndefined();
    }
  });

  it("refuses relative paths, so an internal link can never be routed through it by mistake", () => {
    expect(externalHref("/events/123")).toBeUndefined();
    expect(externalHref("events/123")).toBeUndefined();
    // Protocol-relative: `new URL` cannot resolve it without a base, so it
    // fails closed here even though a browser would happily follow it.
    expect(externalHref("//evil.example.com")).toBeUndefined();
  });

  it("returns the parsed form, so the href and what was checked cannot differ", () => {
    expect(externalHref("https://EXAMPLE.com")).toBe("https://example.com/");
  });
});
