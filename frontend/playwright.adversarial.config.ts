import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Adversarial sweep: reuses the main config's globalSetup (which refuses a
// non-local Supabase), webServer (production build, never reused) and
// timeouts; only the projects differ.
export default defineConfig({
  ...base,
  globalTeardown: "./e2e/adversarial/teardown.ts",
  retries: 0,
  timeout: 120_000,
  reporter: [["list"], ["json", { outputFile: "adversarial-results.json" }]],
  projects: [
    { name: "adv-rpc", testMatch: /adversarial\/(concurrency|input-fuzz)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "adv-ui", testMatch: /adversarial\/(focus|offline|mobile-auth|account-deletion)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "adv-browser", testMatch: /adversarial\/(browser|ui-races|security|email)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "adv-ai", testMatch: /adversarial\/ai-ui-edges\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
});
