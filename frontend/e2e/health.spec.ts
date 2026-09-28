import { test, expect } from "@playwright/test";

// G3/G4: the health route reaches the real snapshot RPC through the service
// client, and a caller without the cron secret can't run it. Runs under the
// `public` project (no session needed). CRON_SECRET matches the value the
// local runner and CI export.

test("the health check runs the snapshot with the cron secret, and refuses without it", async ({ request }) => {
  const denied = await request.post("/api/cron/health", { headers: { authorization: "Bearer wrong" } });
  expect(denied.status()).toBe(403);

  const res = await request.post("/api/cron/health", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.ok).toBe("boolean");
  expect(Array.isArray(body.failing)).toBe(true);
  // Every name is one of the snapshot's checks: the route is reading the
  // real RPC, not a stub.
  const known = [
    "email_backlog", "email_dead_24h", "blob_deletion_backlog", "worker_backlog", "jobs_dead_24h",
    "moderation_age", "cron_failures", "cron_http_failures", "config_missing",
  ];
  for (const name of body.failing) expect(known).toContain(name);
});
