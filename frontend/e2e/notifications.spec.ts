import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// Foundry · In-app notifications (launch programme F-x3)
//
// rls_smoke.sql proves who can read and mark which rows. What only a
// browser can show is that a real DB event reaches the other member's
// rail badge and list, and that marking read clears the badge.
//
// The connection row is written with the service role so the trigger, not
// the Connect UI (connections.spec.ts covers that), is what's under test.
// Runs under the `connections` project: it borrows the connector/connectee
// pair and resets it on both sides.
// ════════════════════════════════════════════════════════════════════

const service = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function idFor(email: string): Promise<string> {
  const { data, error } = await service().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No seeded user for ${email}`);
  return user.id;
}

let a = "";
let b = "";

async function reset() {
  const db = service();
  await db.from("connections").delete().in("requester_id", [a, b]).in("addressee_id", [a, b]);
  await db.from("connection_events").delete().in("actor_id", [a, b]);
  await db.from("connection_events").delete().in("subject_id", [a, b]);
  await db.from("notifications").delete().in("user_id", [a, b]);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  [a, b] = await Promise.all([idFor(USERS.connector.email), idFor(USERS.connectee.email)]);
  await reset();
});

test.afterAll(async () => {
  await reset();
});

test("a connection request reaches the other member's badge and list, and mark-read clears it", async ({ browser }) => {
  const { data: row, error } = await service()
    .from("connections")
    .insert({ requester_id: a, addressee_id: b, status: "pending", consent_version: "2026-09-17" })
    .select("id")
    .single();
  expect(error).toBeNull();

  const ctxB = await browser.newContext({ storageState: storageStatePath("connectee") });
  const pageB = await ctxB.newPage();
  await pageB.goto("/home");
  await expect(pageB.getByLabel("1 unread notification")).toBeVisible();

  await pageB.goto("/notifications");
  const item = pageB.getByRole("listitem").filter({ hasText: "wants to connect" });
  await expect(item).toBeVisible();
  await expect(item).toContainText("Unread:");
  await expect(item.getByRole("link")).toHaveAttribute("href", "/connections?tab=pending");

  await pageB.getByRole("button", { name: "Mark all as read" }).click();
  await expect(pageB.getByText("All caught up.")).toBeVisible();
  await expect(pageB.getByLabel(/unread notification/)).toHaveCount(0);

  // Survives a reload: the read mark is in the DB, not only in the page.
  await pageB.reload();
  await expect(pageB.getByText("All caught up.")).toBeVisible();
  await ctxB.close();

  // Accepting tells the sender.
  const { error: acceptError } = await service()
    .from("connections")
    .update({ status: "accepted", decided_at: new Date().toISOString() })
    .eq("id", row!.id);
  expect(acceptError).toBeNull();

  const ctxA = await browser.newContext({ storageState: storageStatePath("connector") });
  const pageA = await ctxA.newPage();
  await pageA.goto("/notifications");
  await expect(pageA.getByRole("listitem").filter({ hasText: "accepted your connection request" })).toBeVisible();
  // The sender never saw the receiver's request notification.
  await expect(pageA.getByText("wants to connect")).toHaveCount(0);
  await ctxA.close();
});

test("with nothing to show, the page says so", async ({ browser }) => {
  await reset();
  const ctx = await browser.newContext({ storageState: storageStatePath("connectee") });
  const page = await ctx.newPage();
  await page.goto("/notifications");
  await expect(page.getByText(/^Nothing yet\./)).toBeVisible();
  await ctx.close();
});
