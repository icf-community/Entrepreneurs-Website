import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATIC_CSP_ROUTES } from "./csp";

// B27: STATIC_CSP_ROUTES run with `script-src 'unsafe-inline'`, which is only
// acceptable while they render no user-controlled content (csp.ts). This
// pins that: none of their files may read request data, fetch data, or
// inject HTML other than the escaped JSON-LD. Adding any of those means the
// route must come off STATIC_CSP_ROUTES first.

const SRC = join(__dirname, "..");
const LANDING = ["Navbar", "Hero", "WhoWeAre", "Community", "Opportunities", "Events", "Apply", "Footer"];

const files = [
  ...STATIC_CSP_ROUTES.map((r) => join(SRC, "app", r === "/" ? "" : r, "page.tsx")),
  ...LANDING.map((c) => join(SRC, "components", `${c}.tsx`)),
];

describe("static-CSP routes render no user content", () => {
  it.each(files)("%s reads no request data and injects no HTML", (file) => {
    // Code only: comments are allowed to talk about what the code must not do.
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(text).not.toMatch(/searchParams|useSearchParams|cookies\(|headers\(|createClient|supabase|fetch\(|localStorage/);
    const injections = text.match(/dangerouslySetInnerHTML=\{\{[^}]*\}\}/g) ?? [];
    for (const inj of injections) expect(inj).toMatch(/serialiseJsonLd\(structuredData\)/);
  });
});
