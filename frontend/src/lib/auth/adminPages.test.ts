import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// D2: admin/layout.tsx is not a gate on its own. A soft navigation renders
// only the page segment, so every /admin page has to call
// requireAdminPage() itself (e2e/member.spec.ts replays one as a student).

const ADMIN = join(__dirname, "..", "..", "app", "admin");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name === "page.tsx" ? [p] : [];
  });
}

describe("admin pages", () => {
  it("every /admin page calls requireAdminPage()", () => {
    const all = pages(ADMIN);
    expect(all.length).toBeGreaterThan(10);
    const open = all
      .filter((p) => !/await requireAdminPage\(\)/.test(readFileSync(p, "utf8")))
      .map((p) => relative(ADMIN, p));
    expect(open).toEqual([]);
  });
});
