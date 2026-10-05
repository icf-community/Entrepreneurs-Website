import { test, expect, devices, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// D4: axe on every page a role can reach, failing on any serious or
// critical WCAG 2.2 A/AA violation (2.2 adds target-size: 24 px), at desktop
// width and again at phone width, where the layout reflows. Runs in the
// `member` project; the public and admin groups override the session. /onboarding, /intake,
// /pending, /rejected and /reset-password need an account in that state
// and are covered by the E4 route matrix instead.

const PUBLIC = ["/", "/login", "/privacy", "/terms", "/cookies"];
const MEMBER = [
  "/home", "/members", "/opportunities", "/events", "/vcs", "/calendar", "/committee",
  "/community", "/community/mine", "/connections", "/connections?tab=pending",
  "/connections?tab=sent", "/connections?view=graph", "/notifications", "/my-bookmarks",
  "/my-submissions", "/my-activity", "/foundry-ai", "/profile", "/settings", "/contact",
  "/opportunities/new", "/events/new", "/vcs/new",
];
const ADMIN = [
  "/admin", "/admin/members", "/admin/users", "/admin/opportunities", "/admin/events",
  "/admin/vcs", "/admin/edits", "/admin/reports", "/admin/connections", "/admin/banner",
  "/admin/graduates", "/admin/opportunities/new", "/admin/events/new", "/admin/vcs/new",
];

/** Navigate and wait for streamed sections to replace their skeletons
 *  (every skeleton region is aria-busy), so the page measured is the page. */
async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

async function scan(page: Page, path: string) {
  await settle(page, path);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const VIEWPORTS = [
  { name: "desktop", use: {} },
  { name: "phone", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}`, () => {
    test.use(vp.use);

    test.describe("public pages", () => {
      test.use({ storageState: { cookies: [], origins: [] } });
      for (const path of PUBLIC) {
        test(`axe: ${path}`, async ({ page }) => {
          expect(await scan(page, path)).toEqual([]);
        });
      }
    });

    test.describe("member pages", () => {
      for (const path of MEMBER) {
        test(`axe: ${path}`, async ({ page }) => {
          expect(await scan(page, path)).toEqual([]);
        });
      }
    });

    test.describe("admin pages", () => {
      test.use({ storageState: storageStatePath("admin") });
      for (const path of ADMIN) {
        test(`axe: ${path}`, async ({ page }) => {
          expect(await scan(page, path)).toEqual([]);
        });
      }
    });
  });
}

// Detail and edit pages need a listing. One of each kind, posted by the
// student (so the edit pages are theirs), removed afterwards.
test.describe("listing detail and edit pages", () => {
  const ids = { opportunity: "", event: "", vc: "" };
  const db = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  test.beforeAll(async () => {
    const s = db();
    const { data: list } = await s.auth.admin.listUsers({ page: 1, perPage: 200 });
    const idFor = (email: string) => list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    const student = idFor(USERS.student.email);
    const admin = idFor(USERS.admin.email);
    if (!student || !admin) throw new Error("seeded users not found");
    const approved = { status: "approved" as const, approved_at: new Date().toISOString(), approved_by: admin, posted_by: student };
    const inAYear = new Date(Date.now() + 365 * 86_400_000);

    const o = await s.from("opportunities").insert({
      ...approved, position_name: "Axe Engineer", company: "Axe Co", pay: "£1", location_type: "remote",
      description: "Seeded for the accessibility scan.", start_month: 1, start_year: 2030,
      application_deadline: inAYear.toISOString().slice(0, 10), apply_method: "email", contact_email: USERS.student.email,
    }).select("id").single();
    const e = await s.from("events").insert({
      ...approved, title: "Axe Demo Night", description: "Seeded for the accessibility scan.",
      luma_link: "https://lu.ma/axe", event_at: inAYear.toISOString(), location: "Imperial",
      organiser_name: "Axe", contact_email: USERS.student.email,
    }).select("id").single();
    const v = await s.from("vcs_grants").insert({
      ...approved, kind: "vc", name: "Axe Ventures", description: "Seeded for the accessibility scan.",
      link: "https://example.com/axe",
    }).select("id").single();
    for (const r of [o, e, v]) if (r.error) throw new Error(`seed: ${r.error.message}`);
    ids.opportunity = o.data!.id as string;
    ids.event = e.data!.id as string;
    ids.vc = v.data!.id as string;
  });

  test.afterAll(async () => {
    const s = db();
    if (ids.opportunity) await s.from("opportunities").delete().eq("id", ids.opportunity);
    if (ids.event) await s.from("events").delete().eq("id", ids.event);
    if (ids.vc) await s.from("vcs_grants").delete().eq("id", ids.vc);
  });

  for (const [kind, base] of [["opportunity", "/opportunities"], ["event", "/events"], ["vc", "/vcs"]] as const) {
    test(`axe: ${base}/[id] and ${base}/[id]/edit`, async ({ page }) => {
      const id = ids[kind];
      expect(await scan(page, `${base}/${id}`)).toEqual([]);
      expect(await scan(page, `${base}/${id}/edit`)).toEqual([]);
    });
  }
});

// D4: reflow (WCAG 1.4.10). At 320 CSS px — 1280 px at 400% zoom — no page
// may scroll sideways. A wide table or graph may scroll inside its own
// focusable region; the page itself may not.
test.describe("reflow at 320 px", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  const overflow = async (page: Page, path: string) => {
    await settle(page, path);
    return page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const px = document.documentElement.scrollWidth - vw;
      if (px <= 0) return 0;
      // Name the narrowest element sticking out: that is the one to fix.
      const culprit = [...document.querySelectorAll("body *")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.right > vw + 1 && r.width > 0)
        .sort((a, b) => a.r.width - b.r.width)[0];
      const el = culprit?.el;
      return `${px}px ${el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${(el.textContent ?? "").trim().slice(0, 30)}"` : ""}`;
    });
  };

  test("public pages", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    const wide: string[] = [];
    for (const path of PUBLIC) {
      const px = await overflow(page, path);
      if (px) wide.push(`${path} +${px}`);
    }
    await ctx.close();
    expect(wide).toEqual([]);
  });

  test("member pages", async ({ page }) => {
    test.setTimeout(120_000);
    const wide: string[] = [];
    for (const path of MEMBER) {
      const px = await overflow(page, path);
      if (px) wide.push(`${path} +${px}`);
    }
    expect(wide).toEqual([]);
  });

  test("admin pages", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, storageState: storageStatePath("admin") });
    const page = await ctx.newPage();
    const wide: string[] = [];
    for (const path of ADMIN) {
      const px = await overflow(page, path);
      if (px) wide.push(`${path} +${px}`);
    }
    await ctx.close();
    expect(wide).toEqual([]);
  });
});
