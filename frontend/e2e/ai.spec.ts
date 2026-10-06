import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { USERS } from "./fixtures";
import { psql, setAiFlags, startAiServices, waitFor } from "./ai-services";

// ════════════════════════════════════════════════════════════════════
// Foundry AI through the browser (AI-plan §14.4), against a fresh build,
// the local Supabase and the real executor and worker running the fake
// provider. Each mode's happy path, refinement, refusal, recruiter gating
// on confirmed requirements and admin-created jobs, the audience prompt,
// accessibility, and the network rules: the browser never talks to a model
// provider, status polls are private and uncached, and no criteria reach a
// URL.
// ════════════════════════════════════════════════════════════════════

test.describe.configure({ mode: "serial" });

const CAND_EMAIL = "e2e-ai-candidate@imperial.ac.uk";
const ids: { student?: string; cand?: string; candJob?: string; ownJob?: string; adminJob?: string } = {};
let stopServices: (() => void) | null = null;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function userId(email: string): Promise<string> {
  const { data } = await admin().auth.admin.listUsers({ page: 1, perPage: 200 });
  const id = data.users.find((u) => u.email === email)?.id;
  if (!id) throw new Error(`no user ${email}`);
  return id;
}

function job(id: string, poster: string, title: string, description: string, source: "member" | "admin", audience = "both") {
  psql(`insert into public.opportunities (id, posted_by, status, position_name, company, pay, location_type, description,
          start_month, start_year, application_deadline, contact_email, contact_email_visible, apply_method,
          approved_at, approved_by, eligible_audience, creation_source)
        values ('${id}', '${poster}', 'approved', '${title}', 'E2E AI Co', 'Paid', 'remote', '${description}',
          6, 2030, current_date + 60, 'jobs@e2e-ai.test', true, 'email', now(), '${poster}', '${audience}', '${source}')`);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const db = admin();
  ids.student = await userId(USERS.student.email);

  const created = await db.auth.admin.createUser({
    email: CAND_EMAIL, password: "e2e-ai-password-123", email_confirm: true,
    user_metadata: { first_name: "Ada", surname: "Candidate", role: "student" },
  });
  ids.cand = created.data.user?.id ?? (await userId(CAND_EMAIL));
  await db.from("profiles").update({
    status: "approved", course: "MEng Computing", grad_year: 2027, intake_deferred_at: new Date().toISOString(),
    bio_focus: "Training PyTorch vision models", bio_hobbies: "Chess and climbing",
  }).eq("id", ids.cand);
  psql(`insert into public.profile_skills (profile_id, skill_id) select '${ids.cand}', id from public.skills where name = 'Deep learning' on conflict do nothing;
        insert into public.member_education (member_id, currently_enrolled, has_completed_degree) values ('${ids.cand}', true, false) on conflict (member_id) do update set currently_enrolled = true;
        insert into ai_private.member_settings (member_id, recruiter_discoverable, network_discoverable, evidence_sharing, consent_version, consent_epoch)
          values ('${ids.cand}', true, true, true, 'e2e', 1) on conflict (member_id) do update set recruiter_discoverable = true, network_discoverable = true;
        update public.profiles set bio_focus = 'Building Python and PyTorch projects' where id = '${ids.student}';`);

  ids.candJob = crypto.randomUUID();
  ids.ownJob = crypto.randomUUID();
  ids.adminJob = crypto.randomUUID();
  job(ids.candJob, ids.cand, "E2E ML Intern", "We need an ML intern. You must know PyTorch. Python is a plus.", "member");
  job(ids.ownJob, ids.student, "E2E Vision Engineer", "You must know PyTorch and have deep learning experience.", "member");
  job(ids.adminJob, ids.student, "E2E Admin Posted Role", "An admin-posted role using Python and SQL daily.", "admin");

  setAiFlags(true);
  stopServices = startAiServices();
  psql("select ai_private.enqueue_ai_backfill(5000)");
  await waitFor(
    () => psql(`select count(*) from ai_private.member_docs where member_id = '${ids.cand}' and purpose = 'network'`).trim() === "1"
      && psql(`select count(*) from ai_private.member_docs where member_id = '${ids.student}' and purpose = 'self'`).trim() === "1"
      && psql(`select count(*) from ai_private.job_requirements where opportunity_id = '${ids.ownJob}' and status = 'parsed'`).trim() === "1",
    "AI projections",
    60_000,
  );
});

test.afterAll(async () => {
  stopServices?.();
  setAiFlags(false);
  psql(`delete from public.opportunities where id in ('${ids.candJob}', '${ids.ownJob}', '${ids.adminJob}');
        delete from ai_private.conversations where owner_id = '${ids.student}';
        delete from ai_private.usage_events where owner_id = '${ids.student}';
        delete from public.jobs where kind in ('refresh_member_ai', 'refresh_job_ai') and status = 'pending';`);
  if (ids.cand) await admin().auth.admin.deleteUser(ids.cand);
});

// The minute limit (5) is real; tests share one member, so reset it between them.
test.beforeEach(() => {
  psql(`delete from ai_private.usage_events where owner_id = '${ids.student}'`);
});

/** Records anything the page sends that the spec must never see. */
function watchNetwork(page: Page) {
  const offending: string[] = [];
  const statusHeaders: (string | null)[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/openai\.com|azurecontainerapps\.io/.test(url)) offending.push(url);
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/ai/turns/")) statusHeaders.push(res.headers()["cache-control"] ?? null);
  });
  return { offending, statusHeaders };
}

async function search(page: Page, text: string) {
  await page.getByLabel("Your search").fill(text);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

test("network: a search finds an opted-in member and View profile opens their dialog", async ({ page }) => {
  const net = watchNetwork(page);
  await page.goto("/foundry-ai?mode=network");
  await expect(page.getByRole("heading", { name: "Search the network" })).toBeVisible();
  await search(page, "deep learning and chess");

  const card = page.getByRole("article").filter({ hasText: "Ada Candidate" });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("evidence match")).toBeVisible();
  await card.getByRole("button", { name: "View profile" }).click();
  await expect(page.getByRole("dialog", { name: /Profile of Ada Candidate/ })).toBeVisible();

  expect(net.offending).toEqual([]);
  expect(net.statusHeaders.length).toBeGreaterThan(0);
  expect(net.statusHeaders.every((h) => h === "private, no-store")).toBe(true);
  // The URL carries the mode and conversation id, never the criteria.
  expect(page.url()).not.toMatch(/chess|deep/i);
});

test("network: a follow-up keeps the earlier criteria", async ({ page }) => {
  await page.goto("/foundry-ai?mode=network");
  // The conversation in the recent-searches rail, not the starter chip.
  await page.getByRole("main").getByRole("complementary")
    .getByRole("button", { name: "deep learning and chess" }).click();
  await expect(page.getByRole("region", { name: "Search criteria" })).toBeVisible();
  await search(page, "must also like chess");
  const criteria = page.getByRole("region", { name: "Search criteria" });
  await expect(criteria.getByText("Chess")).toBeVisible({ timeout: 20_000 });
  await expect(criteria.getByText("Deep learning")).toBeVisible();
  await expect(criteria.getByText("· must have")).toBeVisible();
});

test("an off-task request is refused and adds no criteria", async ({ page }) => {
  await page.goto("/foundry-ai?mode=network");
  await search(page, "explain the pythagorean theorem");
  await expect(page.getByText("I can only search for people and jobs.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Search criteria" }).getByText("No criteria yet")).toBeVisible();
});

test("recruiter: requirements are confirmed first, admin-created jobs never appear, then candidates are found", async ({ page }) => {
  await page.goto("/foundry-ai?mode=recruiter");
  const picker = page.getByLabel("Job");
  await expect(picker).toBeVisible();
  await expect(picker.locator("option", { hasText: "E2E Admin Posted Role" })).toHaveCount(0);
  await picker.selectOption({ label: "E2E Vision Engineer · E2E AI Co" });

  await expect(page.getByRole("heading", { name: "Confirm what this job requires" })).toBeVisible();
  await expect(page.getByText("PyTorch")).toBeVisible();
  await page.getByRole("button", { name: "Confirm requirements" }).click();

  await search(page, "python");
  const card = page.getByRole("article").filter({ hasText: "Ada Candidate" });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Save these matches" })).toBeVisible();
});

test("opportunities: jobs that match my own profile, with Apply and the job page", async ({ page }) => {
  await page.goto("/foundry-ai?mode=opportunities");
  await search(page, "jobs that match my profile");
  const card = page.getByRole("article").filter({ hasText: "E2E ML Intern" });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole("link", { name: "View job" })).toHaveAttribute("href", `/opportunities/${ids.candJob}`);
  await expect(card.getByRole("link", { name: /Email to apply/ })).toBeVisible();
  // Never a member's own job.
  await expect(page.getByRole("article").filter({ hasText: "E2E Vision Engineer" })).toHaveCount(0);
});

test("the AI page has no serious accessibility violations with results on screen", async ({ page }) => {
  await page.goto("/foundry-ai?mode=network");
  await search(page, "deep learning");
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 20_000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => v.id)).toEqual([]);
});

test("settings shows the three separate AI choices", async ({ page }) => {
  await page.goto("/settings");
  const card = page.locator("#ai");
  await expect(card.getByRole("switch", { name: "Let recruiters find me" })).toBeVisible();
  await expect(card.getByRole("switch", { name: "Suggest me to members building their network" })).toBeVisible();
  await expect(card.getByRole("switch", { name: "Show recruiters lines from my CV" })).toBeVisible();
});

test("a member with no education status is asked for it instead of seeing an empty board", async ({ page }) => {
  psql(`delete from public.member_education where member_id = '${ids.student}'`);
  try {
    await page.goto("/opportunities");
    await expect(page.getByRole("heading", { name: "Confirm your status to see jobs" })).toBeVisible();
    await page.getByRole("group", { name: /currently enrolled/ }).getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("group", { name: /completed a degree/ }).getByRole("radio", { name: "No" }).check();
    await page.getByRole("button", { name: "Confirm and show jobs" }).click();
    await expect(page.getByRole("heading", { name: "Confirm your status to see jobs" })).toHaveCount(0);
    await expect(page.getByText("E2E ML Intern")).toBeVisible();
  } finally {
    psql(`insert into public.member_education (member_id, currently_enrolled, has_completed_degree)
          values ('${ids.student}', true, false) on conflict (member_id) do update set currently_enrolled = true, has_completed_degree = false`);
  }
});
