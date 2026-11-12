import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { USERS } from "./fixtures";
import { psql, setAiFlags, startAiServices, waitFor, waitForExecutorGone } from "./ai-services";

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

  // ai_submit_turn (20261025000002) refuses admission while any model it
  // prices is unconfirmed, and every real model_prices row ships
  // confirmed=false until the owner checks it against the provider's price
  // page. Confirmed for this run only; afterAll puts it back.
  psql(`update ai_private.model_prices set confirmed = true
         where model in ('gpt-5.4-mini', 'gpt-6.1-sol', 'text-embedding-3-small')`);

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
  psql(`update ai_private.model_prices set confirmed = false
         where model in ('gpt-5.4-mini', 'gpt-6.1-sol', 'text-embedding-3-small')`);
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

// The submit action also sits behind the app's own limiter (ratelimit.ts
// aiSubmit: 10 a minute, in-process when Upstash is unset), which the line
// above cannot reset. This serial file submits faster than a person can, and
// a refusal there shows the page's "a lot of searches in a minute" alert in
// place of whatever the test is checking. Record this file's submissions, and
// before each test wait until few enough are under a minute old that the
// test's own (at most four) fit. Waiting before the test, not at the click,
// keeps a test's own assertions inside their timeouts.
const submitTimes: number[] = [];
const WINDOW_MS = 61_000;
const SUBMITS_LEFT_FOR_A_TEST = 4;
test.beforeEach(async ({ page }, testInfo) => {
  const now = Date.now();
  while (submitTimes.length && now - submitTimes[0] >= WINDOW_MS) submitTimes.shift();
  const excess = submitTimes.length - (10 - SUBMITS_LEFT_FOR_A_TEST);
  if (excess >= 0) {
    const wait = submitTimes[excess] + WINDOW_MS - now;
    testInfo.setTimeout(testInfo.timeout + wait);
    await new Promise((r) => setTimeout(r, wait));
  }
  await page.route(/foundry-ai/, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && (req.postData() ?? "").includes("idempotencyKey")) submitTimes.push(Date.now());
    await route.continue();
  });
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
  const picker = page.getByRole("combobox", { name: /Job/ });
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

test("reopening a saved conversation makes no new turn and no new provider spend (scenario 20)", async ({ page }) => {
  // Reuses the "deep learning and chess" conversation from the first test in
  // this file rather than starting a fresh one — both because that is what
  // "reopening" actually means (an existing saved chat, not a new search) and
  // because member threads are capped at 5; this file already opens exactly
  // 5 fresh ones elsewhere, and a 6th here would starve a later test's admission.
  await page.goto("/foundry-ai?mode=network");
  await page.getByRole("main").getByRole("complementary")
    .getByRole("button", { name: "deep learning and chess" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toBeVisible({ timeout: 10_000 });

  const turnsBefore = psql(`select count(*) from ai_private.turns where conversation_id in
    (select id from ai_private.conversations where owner_id = '${ids.student}')`).trim();
  const spendBefore = psql(`select count(*) from ai_private.spend where member_id = '${ids.student}'`).trim();

  // Reload the whole page cold (not a client-side nav) — the strongest version of
  // "reopening" a saved conversation: it forces loadConversation()/loadResults()
  // to run from scratch, with no in-memory React state to coast on.
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toBeVisible({ timeout: 10_000 });

  const turnsAfter = psql(`select count(*) from ai_private.turns where conversation_id in
    (select id from ai_private.conversations where owner_id = '${ids.student}')`).trim();
  const spendAfter = psql(`select count(*) from ai_private.spend where member_id = '${ids.student}'`).trim();

  expect(turnsAfter).toBe(turnsBefore);
  expect(spendAfter).toBe(spendBefore);
});

// The rest of this file's tests reuse the "deep learning and chess"
// conversation via the recent-searches rail rather than a fresh
// `page.goto` + direct search. A fresh goto with no rail click always
// starts a brand-new conversation (conversationId is null until one is
// loaded), and this file already opens its full 5-thread budget across
// the tests above (network, off-task, recruiter, opportunities, a11y) —
// a 6th anywhere below would make the member's next admission refuse
// with too_many_threads.
async function openMainConversation(page: Page) {
  await page.goto("/foundry-ai?mode=network");
  await page.getByRole("main").getByRole("complementary")
    .getByRole("button", { name: "deep learning and chess" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toBeVisible({ timeout: 10_000 });
}

test("mixed: the off-task half is dropped, and confirming applies only the search half (scenario-adjacent, gap 22)", async ({ page }) => {
  await openMainConversation(page);
  await search(page, "find people who know chess, and also write me a poem");
  await expect(page.getByText("Part of that wasn't a search, so I've left it out.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Search with these criteria" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toBeVisible({ timeout: 20_000 });
});

test("budget exhausted refuses admission with the daily-limit message (gap 22)", async ({ page }) => {
  const saved = psql("select member_daily_cap_micro from ai_private.settings where id = 1").trim();
  psql("update ai_private.settings set member_daily_cap_micro = 0 where id = 1");
  try {
    await openMainConversation(page);
    await search(page, "find python people");
    await expect(page.getByRole("alert").filter({ hasText: "AI search has reached today's limit." })).toBeVisible({ timeout: 10_000 });
  } finally {
    psql(`update ai_private.settings set member_daily_cap_micro = ${saved} where id = 1`);
  }
});

test("queue busy refuses admission and keeps the draft message (gap 22)", async ({ page }) => {
  // queue_capacity counts ai_private.turns WHERE status='queued', system-wide
  // (ai_submit_turn). The CHECK constraint forbids 0, so this fills the one
  // slot for real with a turn in the still-open recruiter conversation
  // (different conversation from the one under test, so the second
  // submission below hits queue_full, not the per-conversation "busy").
  // The executor is stopped first so the filling turn can't drain itself.
  const saved = psql("select queue_capacity from ai_private.settings where id = 1").trim();
  stopServices?.();
  stopServices = null;
  await waitForExecutorGone();
  psql("update ai_private.settings set queue_capacity = 1 where id = 1");
  try {
    // Reuse the recruiter conversation from the earlier test rather than a
    // fresh job pick — a fresh `page.goto` + direct submission (no rail
    // click) always starts a NEW conversation, and this account is already
    // at its 5-thread budget.
    await page.goto("/foundry-ai?mode=recruiter");
    // The rail (and the rest of the page) only renders once a job is
    // picked — picking it sets state only, no submission, so this doesn't
    // start a new conversation on its own.
    await page.getByRole("combobox", { name: /Job/ }).selectOption({ label: "E2E Vision Engineer · E2E AI Co" });
    // Titled from its first message ("python", from the earlier recruiter
    // test), not from the job — this is the only recruiter conversation.
    await page.getByRole("main").getByRole("complementary")
      .getByRole("listitem").first().getByRole("button").click();
    await page.getByLabel("Your search").fill("find more candidates");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/Waiting to start|Working…/)).toBeVisible({ timeout: 10_000 });

    await openMainConversation(page);
    const box = page.getByLabel("Your search");
    await box.fill("find python people");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "AI search is busy right now." })).toBeVisible({ timeout: 10_000 });
    // "Your message is still here" (outcomes.ts queue_full copy) — the draft isn't cleared on refusal.
    await expect(box).toHaveValue("find python people");
  } finally {
    psql(`update ai_private.settings set queue_capacity = ${saved} where id = 1`);
    stopServices = startAiServices();
    await waitFor(
      () => psql("select count(*) from ai_private.turns where status = 'queued'").trim() === "0",
      "the filling turn to drain",
      20_000,
    );
  }
});

test("an executor outage leaves the turn queued, and it drains once the executor is back (gap 22)", async ({ page }) => {
  await openMainConversation(page);
  stopServices?.();
  stopServices = null;
  await waitForExecutorGone();
  try {
    await search(page, "find more chess enthusiasts");
    // No executor claims it: the turn sits queued/running with the "waiting" stage for several seconds.
    await page.waitForTimeout(3_000);
    await expect(page.getByText(/Waiting to start|Working…/)).toBeVisible();
  } finally {
    stopServices = startAiServices();
  }
  // Back up: the queued turn drains without a fresh submission.
  await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toBeVisible({ timeout: 30_000 });
});

test("consent toggles change who is found, immediately (gap 22)", async ({ page }) => {
  // Mirrors what save_my_ai_settings itself does on a toggle-off (AI-plan
  // §5.1): consent alone doesn't gate retrieval, the member_docs/evidence
  // projection does, and that's deleted synchronously by the RPC — not by
  // a background rebuild — which is what "removes you at once" promises.
  await openMainConversation(page);
  psql(`update ai_private.member_settings set network_discoverable = false where member_id = '${ids.cand}';
        delete from ai_private.member_docs where member_id = '${ids.cand}' and purpose = 'network';
        delete from ai_private.member_evidence where member_id = '${ids.cand}' and purpose = 'network';`);
  try {
    await search(page, "find people into chess and deep learning right now");
    await expect(page.getByText(/Waiting to start|Working…/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toHaveCount(0);
  } finally {
    psql(`update ai_private.member_settings set network_discoverable = true where member_id = '${ids.cand}'`);
    psql(`select ai_private.bump_member_source('${ids.cand}')`);
  }
  await waitFor(
    () => psql(`select count(*) from ai_private.member_docs where member_id = '${ids.cand}' and purpose = 'network'`).trim() === "1",
    "the candidate's network projection to rebuild",
    30_000,
  );
  await search(page, "find people into chess and deep learning once more");
  await expect(page.getByRole("article").filter({ hasText: "Ada Candidate" })).toBeVisible({ timeout: 20_000 });
});

test("rerunning the same search is stable: same person, same score, no re-flagging as new (gap 22)", async ({ page }) => {
  // The conversation already shows "Ada Candidate" from an earlier test's
  // saved results, so a frontend "is it done" signal (status text, button
  // state) can race the UI's own poll. Ask the database directly instead.
  async function waitForIdle() {
    await waitFor(
      () => psql(`select count(*) from ai_private.turns where conversation_id in
        (select id from ai_private.conversations where owner_id = '${ids.student}' and title ilike '%chess%')
        and status in ('queued', 'running')`).trim() === "0",
      "the turn to finish",
      20_000,
    );
  }

  await openMainConversation(page);
  await waitForIdle();
  await search(page, "deep learning and chess stability check");
  await waitForIdle();
  await page.waitForTimeout(500); // the finished turn's own poll to reach the page and render.
  const card = page.getByRole("article").filter({ hasText: "Ada Candidate" });
  await expect(card).toBeVisible();
  const scoreBefore = await card.locator("text=/evidence match/").locator("..").textContent();

  await search(page, "deep learning and chess stability check");
  await waitForIdle();
  await page.waitForTimeout(500);
  const card2 = page.getByRole("article").filter({ hasText: "Ada Candidate" });
  await expect(card2).toBeVisible();
  const scoreAfter = await card2.locator("text=/evidence match/").locator("..").textContent();
  expect(scoreAfter).toBe(scoreBefore);
  await expect(card2.getByText("New")).toHaveCount(0);
});

test("Connect is reachable from an AI result's profile dialog (gap 22)", async ({ page }) => {
  await openMainConversation(page);
  const card = page.getByRole("article").filter({ hasText: "Ada Candidate" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole("button", { name: "View profile" }).click();
  const dialog = page.getByRole("dialog", { name: /Profile of Ada Candidate/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});

test("forgetting a message removes the criteria it added, and only those (gap 22)", async ({ page }) => {
  await openMainConversation(page);
  await search(page, "must also know python");
  const criteria = page.getByRole("region", { name: "Search criteria" });
  await expect(criteria.getByText("Python")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("listitem").filter({ hasText: "must also know python" })
    .getByRole("button", { name: "Forget this message and any criteria it added" }).click();

  await expect(criteria.getByText("Python")).toHaveCount(0);
  await expect(criteria.getByText("Chess")).toBeVisible();
  await expect(criteria.getByText("Deep learning")).toBeVisible();
});

test("an expired message's criteria drop out of the active spec (gap 22)", async ({ page }) => {
  await openMainConversation(page);
  await search(page, "must also know rust programming");
  const criteria = page.getByRole("region", { name: "Search criteria" });
  await expect(criteria.getByText("Rust")).toBeVisible({ timeout: 20_000 });

  // Each atom bakes its originating message's expires_at into
  // spec->atoms[]->source->expires_at at the moment it's added (AI-plan
  // §5.1's eval transformation "source expiry") — it isn't a live join to
  // ai_private.messages, so moving that message's own row is a no-op here.
  // The atom's embedded copy has to move too.
  psql(`update ai_private.conversations c
        set spec = jsonb_set(c.spec, '{atoms}', (
          select jsonb_agg(case when a #>> '{source,message_id}' = m.id::text
                                 then jsonb_set(a, '{source,expires_at}', to_jsonb((now() - interval '1 hour')::text))
                                 else a end)
          from jsonb_array_elements(c.spec->'atoms') a,
               ai_private.messages m
          where m.conversation_id = c.id and m.body = 'must also know rust programming'
        ))
        where c.owner_id = '${ids.student}' and c.title ilike '%chess%'`);

  // apply_spec_ops sweeps expired atoms out of the stored spec when it next
  // runs — on the NEXT op, not on a plain read/reload. A harmless follow-up
  // message is what triggers that sweep here.
  await search(page, "and let's also look for climbing partners");
  await expect(page.getByRole("region", { name: "Search criteria" }).getByText("Rust")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Search criteria" }).getByText("Chess")).toBeVisible();
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

test("deleting a chat removes it from the rail (gap 22)", async ({ page }) => {
  // The recruiter-mode conversation from the earlier test — the network
  // conversation other tests above still need is left alone.
  await page.goto("/foundry-ai?mode=recruiter");
  await page.getByRole("combobox", { name: /Job/ }).selectOption({ label: "E2E Vision Engineer · E2E AI Co" });
  await page.getByRole("main").getByRole("complementary").getByRole("listitem").first()
    .getByRole("button").click();
  await page.getByRole("button", { name: "Delete this chat" }).click();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete this chat" })).toHaveCount(0);
  const left = psql(`select count(*) from ai_private.conversations where owner_id = '${ids.student}' and mode = 'recruiter'`).trim();
  expect(left).toBe("0");
});

test("deleting all AI history clears every conversation (gap 22)", async ({ page }) => {
  await page.goto("/foundry-ai?mode=network");
  await page.getByRole("button", { name: "Delete all AI history" }).click();
  await page.getByRole("button", { name: "Delete everything", exact: true }).click();
  await expect(page.getByText("No recent searches.")).toBeVisible({ timeout: 10_000 });
  const left = psql(`select count(*) from ai_private.conversations where owner_id = '${ids.student}'`).trim();
  expect(left).toBe("0");
});

test("deleting a member's account removes their AI projections and settings (gap 22)", async () => {
  // Last test in the file on purpose — it permanently removes "Ada
  // Candidate", which every test above this point depends on.
  const candId = ids.cand!;
  // The consent test above re-queued a refresh_member_ai job for the
  // candidate; let the worker finish it first so this test measures the
  // delete's own cascade, not a race against a job still writing docs.
  await waitFor(
    () => psql(`select count(*) from public.jobs where kind = 'refresh_member_ai'
      and (payload->>'member_id')::uuid = '${candId}' and status in ('pending', 'running')`).trim() === "0",
    "the candidate's pending refresh job to finish",
    20_000,
  );
  const docsBefore = psql(`select count(*) from ai_private.member_docs where member_id = '${candId}'`).trim();
  const settingsBefore = psql(`select count(*) from ai_private.member_settings where member_id = '${candId}'`).trim();
  expect(Number(docsBefore)).toBeGreaterThan(0);
  expect(settingsBefore).toBe("1");

  // opportunities.posted_by is NOT NULL, so GoTrue's own deleteUser (which
  // only runs the FK cascades, not admin_delete_user's extra cleanup) fails
  // silently against it for a candidate who posted a job — same reason
  // admin_delete_user deletes posted listings itself first (D9 §admin
  // RPCs). ids.candJob is this test file's job posted by the candidate.
  psql(`delete from public.opportunities where id = '${ids.candJob}'`);
  const { error: delErr } = await admin().auth.admin.deleteUser(candId);
  expect(delErr).toBeNull();
  ids.cand = undefined; // afterAll's `if (ids.cand)` guard then skips the already-done delete.

  expect(psql(`select count(*) from ai_private.member_docs where member_id = '${candId}'`).trim()).toBe("0");
  expect(psql(`select count(*) from ai_private.member_settings where member_id = '${candId}'`).trim()).toBe("0");
});
