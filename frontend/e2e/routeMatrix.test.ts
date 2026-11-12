import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { ROUTES, discoverPageFiles, routePathToAppDir } from "./routeMatrix";

// AI-plan §14.4 / gap 23: a page.tsx with no row in ROUTES has no proof
// that any role can reach it (or correctly can't). This fails the moment
// a new page.tsx is added without a matching entry, instead of silently
// leaving it untested.
describe("routeMatrix.ts covers every page.tsx", () => {
  it("has exactly one ROUTES row per discovered page.tsx app-dir", () => {
    const discovered = discoverPageFiles(join(__dirname, "..", "src", "app"));
    const mapped = ROUTES.map((r) => routePathToAppDir(r.path)).sort();

    const missing = discovered.filter((d) => !mapped.includes(d));
    const extra = mapped.filter((m) => !discovered.includes(m));

    expect(missing, `page.tsx with no routeMatrix.ts row: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `routeMatrix.ts row with no matching page.tsx: ${extra.join(", ")}`).toEqual([]);
  });

  it("has no duplicate path", () => {
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
