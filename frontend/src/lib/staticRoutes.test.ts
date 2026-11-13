import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { STATIC_CSP_ROUTES } from "./csp";
import { readParams } from "@/components/landing/scene/motion";

// B27: STATIC_CSP_ROUTES run with `script-src 'unsafe-inline'`, which is only
// acceptable while they render no user-controlled content (csp.ts). This
// pins that: none of their files may read request data, fetch data, or
// inject HTML other than the escaped JSON-LD. Adding any of those means the
// route must come off STATIC_CSP_ROUTES first.

const SRC = join(__dirname, "..");

/** Every source file of the landing page (route `/`): its server components, its client frame, its scene, its content module. */
function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourcesIn(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}
const LANDING = [...sourcesIn(join(SRC, "components", "landing")), ...sourcesIn(join(SRC, "lib", "landing"))];

const files = [...STATIC_CSP_ROUTES.map((r) => join(SRC, "app", r === "/" ? "" : r, "page.tsx")), ...LANDING];

describe("static-CSP routes render no user content", () => {
  it("the landing page's sources are all in the list", () => {
    // a guard on the guard: the scan below is only worth anything while it finds the page's files
    const names = LANDING.map((f) => f.slice(SRC.length + 1));
    for (const expected of [
      "components/landing/Landing.tsx", "components/landing/LandingFrame.tsx", "components/landing/Hero.tsx", "components/landing/Footer.tsx",
      "components/landing/scene/engine.ts", "components/landing/scene/boot.ts", "lib/landing/content.ts",
    ]) expect(names).toContain(expected);
  });

  it.each(files)("%s reads no request data and injects no HTML", (file) => {
    // Code only: comments are allowed to talk about what the code must not do.
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(text).not.toMatch(/searchParams|useSearchParams|cookies\(|headers\(|createClient|supabase|fetch\(|localStorage/);
    const injections = text.match(/dangerouslySetInnerHTML=\{\{[^}]*\}\}/g) ?? [];
    for (const inj of injections) expect(inj).toMatch(/serialiseJsonLd\(structuredData\)/);
  });

  // The scene keeps the mock's test hooks (?still, ?t=, ?p=, ?who=, ?joined, ?prof) so the port can be compared with the mock frame by frame. They are the one
  // read of the query string on this page, so they are pinned: one file, client code only, and what comes out is flags and numbers (no string from the URL
  // reaches the DOM, so there is nothing for a crafted link to inject).
  it("reads the query string in exactly one place, and only as flags and numbers", () => {
    const readers = LANDING.filter((f) => /URLSearchParams|location\.search/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));
    expect(readers.map((f) => f.slice(SRC.length + 1))).toEqual(["components/landing/scene/motion.ts"]);
    const hostile = readParams('?still&t=<script>&p=1e999&who=__proto__&joined=<img src=x onerror=alert(1)>&prof');
    expect(hostile).toEqual({ still: true, frozenT: null, frozenP: null, who: null, joined: true, prof: true });
    expect(readParams("?still&t=0.3&p=0.5&who=2")).toEqual({ still: true, frozenT: 0.3, frozenP: 0.5, who: 2, joined: false, prof: false });
    expect(readParams("")).toEqual({ still: false, frozenT: null, frozenP: null, who: null, joined: false, prof: false });
  });
});
