import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { USERS } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// Foundry · /home + the app shell
//
// Covers the two things most likely to regress silently: that the rail
// reaches every destination it claims to, and that the sections degrade
// to an honest empty state rather than a blank page when the seeded DB
// has no listings.
// ════════════════════════════════════════════════════════════════════

// One approved row of each kind, so the card/deep-link tests below assert
// against real listings. Without them every card assertion is vacuous on a
// DB that happens to be empty — which is exactly how three 404ing card
// links survived to production.
test.describe("home", () => {
  const TITLES = {
    event: "Seeded Home Card Event",
    opp:   "Seeded Home Card Role",
    vc:    "Seeded Home Card Fund",
  };
  const seeded: { events?: string; opportunities?: string; vcs_grants?: string } = {};

  function admin() {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  test.beforeAll(async () => {
    const db = admin();
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const idFor = (email: string) =>
      list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    const student = idFor(USERS.student.email);
    const approver = idFor(USERS.admin.email);
    if (!student || !approver) throw new Error("seeded users not found");

    const approved = {
      status: "approved" as const,
      approved_at: new Date().toISOString(),
      approved_by: approver,
      posted_by: student,
    };

    const { data: ev, error: evErr } = await db.from("events").insert({
      ...approved,
      title: TITLES.event,
      description: "Seeded so the home Events card has a row.",
      luma_link: "https://lu.ma/home-card",
      event_at: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      location: "Imperial",
      organiser_name: "Foundry",
      contact_email: USERS.student.email,
    }).select("id").single();
    if (evErr) throw new Error(`seed event: ${evErr.message}`);
    seeded.events = ev!.id as string;

    const { data: opp, error: oppErr } = await db.from("opportunities").insert({
      ...approved,
      position_name: TITLES.opp,
      company: "Home Card Co",
      pay: "£1",
      location_type: "remote",
      description: "Seeded so the home Opportunities card has a row.",
      start_month: 1,
      start_year: 2030,
      application_deadline: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
      apply_method: "email",
      contact_email: USERS.student.email,
    }).select("id").single();
    if (oppErr) throw new Error(`seed opportunity: ${oppErr.message}`);
    seeded.opportunities = opp!.id as string;

    const { data: vc, error: vcErr } = await db.from("vcs_grants").insert({
      ...approved,
      kind: "grant",
      name: TITLES.vc,
      description: "Seeded so the home VCs and Grants card has a row.",
      link: "https://example.com/home-card-fund",
      amount: "£10k",
    }).select("id").single();
    if (vcErr) throw new Error(`seed vc: ${vcErr.message}`);
    seeded.vcs_grants = vc!.id as string;
  });

  test.afterAll(async () => {
    const db = admin();
    for (const [table, id] of Object.entries(seeded)) {
      if (id) await db.from(table as "events").delete().eq("id", id);
    }
  });

  test("greets the member and renders every listing section", async ({ page }) => {
    await page.goto("/home");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    for (const name of ["Events", "Opportunities", "VCs and Grants"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }

    // Either real cards or the empty state — never nothing.
    const events = page.locator("section", { hasText: "Foundry gatherings" });
    await expect(events.locator("li, p").first()).toBeVisible();
  });

  test("each section offers a way through to its full page", async ({ page }) => {
    await page.goto("/home");

    for (const [label, href] of [
      ["View all Events", "/events"],
      ["View all Opportunities", "/opportunities"],
      ["View all VCs and Grants", "/vcs"],
    ] as const) {
      await expect(page.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  test("the newest-members strip moved here, and off the directory", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: /newest members/i })).toBeVisible();

    // The member search that used to sit under the greeting is gone: the
    // directory owns searching, and one box that navigates away was a
    // second, worse entry point to it.
    await expect(page.getByRole("searchbox")).toHaveCount(0);

    await page.goto("/members");
    await expect(page.getByRole("heading", { name: /newest members/i })).toHaveCount(0);
  });

  test("messaging is reachable and says so plainly", async ({ page }) => {
    await page.goto("/home");
    await page.getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Messaging" }).click();

    await expect(page).toHaveURL(/\/messaging$/);
    await expect(page.getByRole("heading", { name: "Coming Soon!" })).toBeVisible();
  });

  // The cards used to point at /events/<id> and /opportunities/<id>, which
  // are not routes in this app — every one of them 404ed. Asserting the href
  // shape would have kept passing; only following it catches that.
  test("every listing card leads somewhere that exists", async ({ page }) => {
    await page.goto("/home");

    // The sections stream in under Suspense, so the cards are not in the
    // first HTML. Collecting hrefs without waiting reads an empty list on a
    // cold server and an populated one on a warm server — a flake that
    // reports itself as "no cards", which is indistinguishable from the bug
    // this test exists to catch.
    //
    // Events, Opportunities and VCs each resolve their own independent
    // Suspense boundary, on their own schedule — waiting for the first
    // visible card only proves the fastest of the three landed. Under
    // worker contention a slower section can still be showing its skeleton
    // at that instant, which undercounts hrefs without looking like "no
    // cards" at all (seen once as 2 of the expected 3). Waiting out every
    // skeleton first means all three boundaries have actually settled.
    const cards = page.locator("section ul li a");
    await expect(cards.first()).toBeVisible();
    await expect(page.locator(".animate-pulse")).toHaveCount(0);

    const hrefs = await cards.evaluateAll(
      (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!),
    );
    expect(hrefs.length, "beforeAll seeds one of each kind").toBeGreaterThanOrEqual(3);

    for (const href of hrefs) {
      const res = await page.goto(href);
      expect(res?.status(), `${href} should resolve`).toBe(200);
    }
  });

  test("every listing kind has a page of its own", async ({ page }) => {
    for (const [href, title] of [
      [`/events/${seeded.events}`, TITLES.event],
      [`/opportunities/${seeded.opportunities}`, TITLES.opp],
      [`/vcs/${seeded.vcs_grants}`, TITLES.vc],
    ] as const) {
      const res = await page.goto(href);
      expect(res?.status(), `${href} should resolve`).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    }
  });

  // The three deep-link params predate the detail routes and were the only
  // way to link to a single listing for a while, so links using them are
  // out in the world. They redirect rather than 404 or fall back to the
  // unfiltered list.
  test("the old ?e=/?o=/?v= deep links redirect to those pages", async ({ page }) => {
    for (const [list, param, id] of [
      ["/events", "e", seeded.events],
      ["/opportunities", "o", seeded.opportunities],
      ["/vcs", "v", seeded.vcs_grants],
    ] as const) {
      await page.goto(`${list}?${param}=${id}`);
      await expect(page).toHaveURL(new RegExp(`${list}/${id}$`));
    }
  });

  // Every one of these ids resolves to a real row today and stops doing so
  // the moment the event happens, the deadline passes or an admin pulls it
  // — which is most of what /my-activity links to. A signed-out-looking 404
  // is the wrong answer for a signed-in member.
  test("a listing that is gone says so, inside the app", async ({ page }) => {
    const dead = "00000000-0000-0000-0000-000000000000";
    for (const [href, heading] of [
      [`/events/${dead}`, /no longer listed/i],
      [`/opportunities/${dead}`, /no longer listed/i],
      [`/vcs/${dead}`, /no longer available/i],
    ] as const) {
      const res = await page.goto(href);
      expect(res?.status(), `${href} should not 404`).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    }
  });

  test("the rail links to every destination it lists", async ({ page }) => {
    await page.goto("/home");
    const nav = page.getByRole("navigation", { name: "Main" });

    for (const [label, href] of [
      ["Home", "/home"],
      ["Members", "/members"],
      ["Messaging", "/messaging"],
      ["Opportunities", "/opportunities"],
      ["Events", "/events"],
      ["Grants & VCs", "/vcs"],
      ["Calendar", "/calendar"],
      ["My activity", "/my-activity"],
      ["My submissions", "/my-submissions"],
    ] as const) {
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }

    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("collapsing the rail persists across a reload", async ({ page }) => {
    await page.goto("/home");
    const nav = page.getByRole("navigation", { name: "Main" });

    await expect(nav.getByRole("link", { name: "Members" })).toBeVisible();

    // The rail's collapse button is part of the page shell, which paints
    // (and looks clickable) from streamed SSR HTML before React has
    // necessarily finished hydrating it — a real click landing in that
    // window is a native DOM event with no listener attached yet, so it
    // is silently swallowed. Retrying the click (rather than the page)
    // is what actually happens if a person's first click does nothing:
    // they click again.
    await expect(async () => {
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      // Labels go, the destinations stay reachable by their accessible name.
      await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible({
        timeout: 1000,
      });
    }).toPass();

    await page.reload();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
  });

  test("/community now serves the feed, and the directory lives at /members", async ({ page }) => {
    // /community used to 307 here, holding the name while the post feed was
    // being built. It now serves that feed, which is the whole point of the
    // 307 having been temporary — so what this asserts is that the two are
    // distinct pages and neither has swallowed the other.
    await page.goto("/community");
    await expect(page).toHaveURL(/\/community$/);
    await expect(page.getByRole("heading", { name: /happening/i })).toBeVisible();

    // Filtered directory views are links people have already shared, so the
    // query has to survive on the route that still owns those filters.
    await page.goto("/members?role=alum&gradMin=2020");
    await expect(page).toHaveURL(/\/members\?.*role=alum/);
    await expect(page).toHaveURL(/gradMin=2020/);
  });

});
