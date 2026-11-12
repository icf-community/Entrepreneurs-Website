import { defineConfig } from "@playwright/test";

// RPC-level adversarial specs only. They talk straight to the local Supabase
// stack (helpers.ts refuses a non-local URL), so there is no app server to
// build or start: this runs in seconds instead of minutes.
//
//   source scripts/local-env.sh && pnpm exec playwright test -c playwright.rpc.config.ts
//
// The browser-level adversarial specs still need playwright.adversarial.config.ts
// (production build + web server).
export default defineConfig({
  testDir: "./e2e/adversarial",
  testMatch: /(concurrency|input-fuzz|authz-matrix|tenant-isolation|injection|ai-security|ai-admin|auth-edge|ai-live)\.spec\.ts/,
  globalTeardown: "./e2e/adversarial/teardown.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
});
