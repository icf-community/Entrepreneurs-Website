import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Disc } from "./Disc";
import { Glyph } from "./Glyph";
import { AUDIENCES, EVENT_TYPES, GLYPH_MIN_SIZE, GLYPH_NAMES, LISTING_KINDS, SIGNUP_STEPS, STATUS_GLYPHS } from "./glyphs";

const markup = (props: Parameters<typeof Glyph>[0]) => renderToStaticMarkup(createElement(Glyph, props));

describe("glyphs", () => {
  it.each(GLYPH_NAMES)("%s is drawn on the 48 grid with its ring, in one colour", (name) => {
    const svg = markup({ name });
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(svg).toContain('<circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.3"');
    expect(svg).toContain("<path");
    expect(svg).toContain('aria-hidden="true"');
    // one colour: only currentColor, except the coin's mask, which paints black and white to cut the pound sign out
    const withoutMask = svg.replace(/<mask[\s\S]*?<\/mask>/, "");
    expect(withoutMask).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(|style=/);
  });

  it("can drop the ring (inside a Disc) but never draws a second one", () => {
    for (const name of GLYPH_NAMES) {
      const svg = markup({ name, ring: false });
      expect(svg).not.toContain('r="20"');
    }
  });

  it("is never drawn below the minimum size", () => {
    expect(GLYPH_MIN_SIZE).toBe(28);
    expect(markup({ name: "book", size: 16 })).toContain('width="28" height="28"');
    expect(markup({ name: "book", size: 28 })).toContain('width="28" height="28"');
    expect(markup({ name: "book", size: 64 })).toContain('width="64" height="64"');
    expect(markup({ name: "book" })).toContain('width="48" height="48"');
  });

  it("is decorative without a title and an image with one", () => {
    const named = markup({ name: "wings", title: "Angel investors" });
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Angel investors"');
    expect(named).not.toContain("aria-hidden");
  });

  it("gives every coin its own mask id, so a page can hold any number of them", () => {
    const svg = renderToStaticMarkup(createElement(Fragment, null, createElement(Glyph, { name: "coin" }), createElement(Glyph, { name: "coin" })));
    const ids = [...svg.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(svg).toContain(`mask="url(#${id})"`);
  });
});

describe("the mappings", () => {
  const known = new Set<string>(GLYPH_NAMES);

  it("point only at glyphs that exist", () => {
    for (const row of [...AUDIENCES, ...LISTING_KINDS, ...EVENT_TYPES, ...SIGNUP_STEPS]) expect(known.has(row.glyph), row.glyph).toBe(true);
    for (const glyph of Object.values(STATUS_GLYPHS)) expect(known.has(glyph)).toBe(true);
  });

  it("keep the kit's labels verbatim (they are content)", () => {
    expect(AUDIENCES.map((a) => [a.id, a.glyph, a.name, a.full])).toEqual([
      ["students", "book", "Students", "Current students"],
      ["grads", "cap", "Grads", "Recent grads"],
      ["founders", "sprout", "Founders", "Alumni founders"],
      ["mentors", "lighthouse", "Mentors", "Mentors"],
      ["angels", "wings", "Angels", "Angel investors"],
      ["faculty", "flask", "Faculty", "Staff & faculty"],
    ]);
    expect(LISTING_KINDS.map((l) => [l.id, l.glyph, l.name])).toEqual([
      ["opportunities", "briefcase", "Opportunities"],
      ["events", "calendar", "Events"],
      ["funding", "coin", "Funding"],
    ]);
    expect(EVENT_TYPES.map((e) => [e.id, e.glyph, e.name])).toEqual([
      ["networking", "network", "Networking"],
      ["demo", "stage", "Demo"],
      ["hackathon", "chip", "Hackathon"],
      ["office-hours", "talk", "Office Hours"],
    ]);
    expect(SIGNUP_STEPS.map((s) => [s.id, s.glyph, s.name])).toEqual([
      ["identity", "badge", "Identity"],
      ["work", "chips", "Your work"],
      ["visibility", "eye", "Visibility"],
    ]);
  });

  it("map the app's own affiliations and listing kinds one to one", () => {
    expect(AUDIENCES.map((a) => a.affiliation)).toEqual(["student", "recent_grad", "alum", "mentor", "angel", "staff_faculty"]);
    expect(LISTING_KINDS.map((l) => l.kind)).toEqual(["opportunity", "event", "vc_grant"]);
  });

  it("use each glyph at most once per family", () => {
    for (const family of [AUDIENCES, LISTING_KINDS, EVENT_TYPES, SIGNUP_STEPS]) {
      const glyphs = family.map((row) => row.glyph);
      expect(new Set(glyphs).size).toBe(glyphs.length);
    }
  });
});

describe("<Disc>", () => {
  it("is the .lm-disc ring, with its size and lit state as data attributes", () => {
    expect(renderToStaticMarkup(createElement(Disc, null, "x"))).toBe('<span class="lm-disc">x</span>');
    const lg = renderToStaticMarkup(createElement(Disc, { size: "lg", lit: true }, "x"));
    expect(lg).toContain('data-size="lg"');
    expect(lg).toContain("data-lit");
    expect(renderToStaticMarkup(createElement(Disc, { size: "sm" }, "x"))).toContain('data-size="sm"');
  });
});
