import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storageStatePath } from "./fixtures";
import { gotoAfterAction } from "./nav";

// ════════════════════════════════════════════════════════════════════
// Foundry · Community feed
//
// Runs with the seeded student storageState.
//
// rls_smoke §31 already proves the database guarantees — who may delete
// what, that a takedown writes its audit record, that a ban destroys
// posts. What only a browser can show is that the page is wired to any of
// it: that posting from the composer produces a card, that the delete
// control reaches the RPC, that "My posts" is a real route, and that the
// kill switch is felt by the UI rather than only by the database.
//
// Images are not exercised here. Upload goes to the FastAPI gateway,
// which is not running in CI, and the composer hides the control when
// UPLOAD_GATEWAY_URL is unset — so the assertion available in this
// environment is that posting works without it, which is the degradation
// path the design promises.
// ════════════════════════════════════════════════════════════════════

const service = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** The kill switch defaults CLOSED, so every test here has to open it. */
async function setPosting(enabled: boolean): Promise<void> {
  const db = service();
  await db
    .from("app_config")
    .upsert({ key: "community_posts_enabled", value: String(enabled) }, { onConflict: "key" });
}

const unique = (label: string) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test.beforeAll(async () => {
  await setPosting(true);
});

test.afterAll(async () => {
  // Leave the flag on: a later run starting from a reset database seeds it
  // itself, and leaving it off would make a failure here look like a bug in
  // the next suite.
  await setPosting(true);
  await service().from("posts").delete().like("title", "e2e %");
});

test("the feed is reachable from the sidebar", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Community", exact: true }).first().click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole("heading", { name: /happening/i })).toBeVisible();
});

test("a member can post, see it in the feed and in My posts, then delete it", async ({ page }) => {
  const title = unique("e2e post");

  await page.goto("/community");
  await page.getByRole("button", { name: "Create a post" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Post", { exact: true }).fill("Something worth reading, at length.");
  await page.getByRole("button", { name: "Post", exact: true }).click();

  // The composer clears and the server re-renders with the new card.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // It is also on My posts, which is a real route rather than client state.
  await page.getByRole("link", { name: "My posts" }).click();
  await expect(page).toHaveURL(/\/community\/mine$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // And the author can remove it before it expires.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: "Delete post" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeHidden();

  await gotoAfterAction(page, "/community");
  await expect(page.getByRole("heading", { name: title })).toBeHidden();
});

test("links in a post body are rendered with their real hostname", async ({ page }) => {
  const title = unique("e2e link");

  await page.goto("/community");
  await page.getByRole("button", { name: "Create a post" }).click();
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("Post", { exact: true })
    .fill("Applications are open at https://imperial.ac.uk/apply this week.");
  await page.getByRole("button", { name: "Post", exact: true }).click();

  const link = page.getByRole("link", { name: /imperial\.ac\.uk\/apply/ }).first();
  await expect(link).toBeVisible();
  // nofollow/ugc keeps our domain from vouching for member-posted links;
  // noopener stops the opened page reaching back through window.opener.
  await expect(link).toHaveAttribute("rel", /nofollow/);
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("target", "_blank");
  // The hostname is displayed, so a link cannot claim one destination and
  // quietly go to another.
  await expect(page.getByText("(imperial.ac.uk)").first()).toBeVisible();
});

test("a member cannot report their own post, but can report someone else's", async ({ page }) => {
  const title = unique("e2e own");

  await page.goto("/community");
  await page.getByRole("button", { name: "Create a post" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Post", { exact: true }).fill("A post by the signed-in member.");
  await page.getByRole("button", { name: "Post", exact: true }).click();

  const card = page.locator("article").filter({ hasText: title }).first();
  await expect(card.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Report" })).toBeHidden();
});

test("the kill switch disables posting without a deploy", async ({ page }) => {
  await setPosting(false);
  try {
    await page.goto("/community");
    await page.getByRole("button", { name: "Create a post" }).click();
    await page.getByLabel("Title").fill(unique("e2e blocked"));
    await page.getByLabel("Post", { exact: true }).fill("This should not be accepted.");
    await page.getByRole("button", { name: "Post", exact: true }).click();

    // Refused by the RPC, and the reason is shown rather than swallowed.
    await expect(page.getByText(/disabled/i).first()).toBeVisible();
  } finally {
    await setPosting(true);
  }
});

test("another member can like a post; the author sees a count, not a button", async ({ page, browser }) => {
  const title = unique("e2e like");

  await page.goto("/community");
  await page.getByRole("button", { name: "Create a post" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Post", { exact: true }).fill("A post someone else will like.");
  await page.getByRole("button", { name: "Post", exact: true }).click();

  const authorCard = page.locator("article").filter({ hasText: title });
  await expect(authorCard.getByRole("button", { name: /Like/ })).toBeHidden();
  await expect(authorCard.getByText("0 likes")).toBeVisible();

  // A second member (admin session, per workflow.spec.ts's established
  // pattern for a real cross-user interaction) likes it — this is the
  // claim only a browser can prove: that the button is actually wired to
  // toggle_post_like and the UI reflects the server's response. Whether a
  // THIRD, unrelated session sees the updated count on its own next visit
  // is a database-level guarantee, already proven directly against the
  // real `authenticated` role in rls_smoke.sql §33 — deliberately not
  // re-asserted here, see that file for why the two layers split this way.
  const otherCtx = await browser.newContext({ storageState: storageStatePath("admin") });
  const otherPage = await otherCtx.newPage();
  await otherPage.goto("/community");
  const otherCard = otherPage.locator("article").filter({ hasText: title });
  await otherCard.getByRole("button", { name: "Like (0)" }).click();
  await expect(otherCard.getByRole("button", { name: "Liked (1)" })).toBeVisible();
  await otherCtx.close();
});

test("the feed is marked noindex", async ({ page }) => {
  // Member-written content behind an auth gate must not be indexed.
  // robots.txt disallows /community too, but Cloudflare serves a managed
  // robots.txt that shadows the app's — so this meta tag is the control
  // that actually holds.
  await page.goto("/community");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

// D3: a double click on Post must create one post. The button only
// disables after React re-renders with `pending`, so two clicks landing
// before that render would otherwise send two create_post calls.
test("a double click on Post creates one post", async ({ page }) => {
  const title = unique("e2e double");

  await page.goto("/community");
  await page.getByRole("button", { name: "Create a post" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Post", { exact: true }).fill("Two clicks, one post, please.");
  await page.getByRole("button", { name: "Post", exact: true }).dblclick();

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole("heading", { name: title })).toHaveCount(1);

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await db.from("posts").delete().eq("title", title);
});
