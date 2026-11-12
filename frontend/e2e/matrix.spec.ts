import { test, expect, type Browser } from "@playwright/test";
import { ROUTES, expectedOutcome, ROLE_TO_FIXTURE, type MatrixRole } from "./routeMatrix";
import { storageStatePath } from "./fixtures";

// AI-plan §14.4 / gap 23: every page.tsx × every role, visited for real.
// routeMatrix.test.ts (Vitest) proves the table has no missing/extra row;
// this proves the table's claims are what the app actually does.
//
// No project-level storageState: "loggedOut" needs a context with none at
// all, so every test makes its own context from the role's fixture (or
// none) via `browser.newContext`, instead of inheriting one from a project.
const ROLES: MatrixRole[] = ["loggedOut", "pending", "rejected", "student", "alum", "admin", "operator"];

async function contextFor(browser: Browser, role: MatrixRole) {
  const fixture = ROLE_TO_FIXTURE[role];
  return browser.newContext(fixture ? { storageState: storageStatePath(fixture) } : undefined);
}

for (const { path, gate } of ROUTES) {
  test.describe(path, () => {
    for (const role of ROLES) {
      test(role, async ({ browser }) => {
        const outcome = expectedOutcome(gate, role);
        const context = await contextFor(browser, role);
        const page = await context.newPage();
        const response = await page.goto(path);

        if (outcome.kind === "render") {
          // No waitForURL here: a render that's about to redirect would
          // otherwise still look like a pass during the race.
          expect(new URL(page.url()).pathname).toBe(path);
          expect(response?.status()).toBeLessThan(400);
        } else if (outcome.kind === "redirect") {
          // Some redirects are server-side (307, already landed by the time
          // goto() resolves); others happen inside a streamed Suspense
          // boundary, where the HTTP response is already 200 and the
          // redirect is a client script that runs post-hydration. Either
          // way, the end state is the same URL.
          await page.waitForURL((url) => url.pathname === outcome.to, { timeout: 10_000 });
        } else {
          expect(response?.status()).toBe(404);
        }

        await context.close();
      });
    }
  });
}
