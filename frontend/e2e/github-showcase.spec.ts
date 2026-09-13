import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// ════════════════════════════════════════════════════════════════════
// The member-chosen GitHub showcase (20260907000004), end to end.
//
// Real GitHub OAuth cannot be driven from E2E, so every test here seeds
// `github_connections` directly via the service client — exactly the row
// shape server/app/worker.py's process_scan_github would have written —
// then drives the real profile UI against it. This is the layer the
// dedup bug found this session (a duplicate CV+GitHub skill rendered
// with a colliding React key) was invisible at: SQL/RLS tests proved the
// RPCs return the right rows, but nothing ever rendered RepoPicker.tsx
// or GithubDialog.tsx in a browser before now.
//
// A THROWAWAY account, not the shared e2e-student session: the seeded
// e2e-student fixture turned out to be the exact account used for real
// manual GitHub+CV QA earlier in this session (same member_id shows up
// in genuine scan_github/ingest_cv job history), so seeding/wiping
// github_connections against it would have clobbered a real person's
// real test data. Minting our own account, à la pipelines.spec.ts's
// makeAlum, avoids that entirely and needs no per-test cleanup beyond
// deleting the account.
// ════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = (): SupabaseClient =>
  createClient(SUPABASE_URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

type Repo = {
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  url: string | null;
  pushed_at: string | null;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const REPOS: Repo[] = [
  { name: "repo-alpha", description: "Alpha project", language: "TypeScript", stargazers_count: 5, url: "https://github.com/e2e/repo-alpha", pushed_at: daysAgo(2) },
  { name: "repo-beta", description: null, language: "Python", stargazers_count: 0, url: "https://github.com/e2e/repo-beta", pushed_at: daysAgo(400) },
  { name: "repo-gamma", description: "Gamma project", language: "Go", stargazers_count: 12, url: "https://github.com/e2e/repo-gamma", pushed_at: daysAgo(10) },
  { name: "repo-delta", description: "Delta project", language: "Rust", stargazers_count: 1, url: "https://github.com/e2e/repo-delta", pushed_at: daysAgo(0) },
];

const EMAIL = `e2e-github-showcase-${Date.now()}@example.com`;
const PASSWORD = "Github-Showcase-Pw-12345!";
let memberId = "";
let ctx: BrowserContext;
let page: Page;

// Mirrors e2e/global-setup.ts's sessionToStorageState — that helper is
// not exported, and duplicating ~15 lines here is cheaper than changing
// shared test infra for one spec.
async function storageStateFor(session: Session): Promise<Parameters<Browser["newContext"]>[0]> {
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(SUPABASE_URL, ANON, {
    cookies: {
      getAll: () => jar.map((c) => ({ name: c.name, value: c.value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          const i = jar.findIndex((c) => c.name === name);
          if (i >= 0) jar[i]!.value = value;
          else jar.push({ name, value });
        }
      },
    },
  });
  await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });

  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const hostname = new URL(SUPABASE_URL).hostname;
  return {
    storageState: {
      cookies: jar.map((c) => ({
        name: c.name,
        value: c.value,
        domain: hostname,
        path: "/",
        expires,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    },
  };
}

test.beforeAll(async ({ browser }) => {
  const admin = service();
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: "Gita", surname: "Showcase", role: "alum" },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  memberId = data.user!.id;

  const { error: pErr } = await admin
    .from("profiles")
    .update({ status: "approved", course: "MSc Innovation", grad_year: 2021 })
    .eq("id", memberId);
  if (pErr) throw new Error(`approve profile failed: ${pErr.message}`);

  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);

  ctx = await browser.newContext(await storageStateFor(signIn.session));
  page = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx?.close();
  const admin = service();
  await admin.auth.admin.deleteUser(memberId).catch(() => {});
});

async function seedConnection(overrides: Record<string, unknown>) {
  const admin = service();
  // access_token_encrypted is NOT NULL bytea; these tests never decrypt
  // it (the worker does, and is never invoked here), so Postgres's
  // hex-escape format for an empty value satisfies the constraint.
  const { error } = await admin.from("github_connections").upsert(
    {
      member_id: memberId,
      github_user_id: 999_000_001,
      github_username: "e2e-octocat",
      access_token_encrypted: "\\x00",
      scan_status: "ready",
      scan_failure_reason: null,
      github_signal: null,
      showcase_repos: null,
      showcase_selected_at: null,
      showcase_seen_repos: [],
      showcase_nudged_at: null,
      showcase_nudges_enabled: true,
      ...overrides,
    },
    { onConflict: "member_id" },
  );
  if (error) throw new Error(`seed github_connections failed: ${error.message}`);
}

test.afterEach(async () => {
  const admin = service();
  await admin.from("jobs").delete().eq("kind", "refresh_github_summary").contains("payload", { member_id: memberId });
  await admin.from("github_connections").delete().eq("member_id", memberId);
});

// The exact "N of 3 chosen[...]" line lives in one <p aria-live="polite">
// — the picks block above it repeats the same words in a longer sentence,
// which trips a plain getByText into a strict-mode ambiguity.
const liveCount = () => page.locator('p[aria-live="polite"]');

test.describe("GitHub showcase · picker", () => {
  test("picking repos saves names, blurbs and order, and queues a summary refresh", async () => {
    await seedConnection({ available_repos: REPOS });

    await page.goto("/profile");
    await page.getByRole("button", { name: "Choose projects" }).click();

    await expect(page.getByText("repo-alpha")).toBeVisible();
    await expect(page.getByText("repo-delta")).toBeVisible();

    const rowFor = (name: string) => page.locator("li", { hasText: name });
    await rowFor("repo-alpha").getByRole("checkbox").check();
    await rowFor("repo-gamma").getByRole("checkbox").check();

    await page.getByLabel("One line about repo-alpha").fill("My custom take on repo-alpha");

    await page.getByRole("button", { name: "Save projects" }).click();
    await expect(page.getByText("Saved. These are what recruiters will see")).toBeVisible();

    const admin = service();
    const { data: row, error } = await admin
      .from("github_connections")
      .select("showcase_repos, showcase_selected_at, showcase_seen_repos")
      .eq("member_id", memberId)
      .single();
    expect(error).toBeNull();

    const picks = row!.showcase_repos as Array<{ name: string; blurb: string | null }>;
    expect(picks.map((p) => p.name)).toEqual(["repo-alpha", "repo-gamma"]);
    expect(picks[0]!.blurb).toBe("My custom take on repo-alpha");
    // Untouched picks keep the GitHub description as their prefilled blurb.
    expect(picks[1]!.blurb).toBe("Gamma project");
    expect(row!.showcase_selected_at).not.toBeNull();
    expect((row!.showcase_seen_repos as string[]).sort()).toEqual(REPOS.map((r) => r.name).sort());

    const { data: jobs } = await admin
      .from("jobs")
      .select("id")
      .eq("kind", "refresh_github_summary")
      .contains("payload", { member_id: memberId });
    expect(jobs, "set_my_github_showcase must enqueue a refresh_github_summary job").toHaveLength(1);
  });

  test("reopening the picker shows existing picks already selected", async () => {
    await seedConnection({
      available_repos: REPOS,
      showcase_repos: [
        { ...REPOS[0], blurb: "x" },
        { ...REPOS[2], blurb: "y" },
      ],
      showcase_seen_repos: REPOS.map((r) => r.name),
    });

    await page.goto("/profile");
    await page.getByRole("button", { name: "Change projects" }).click();

    await expect(liveCount()).toHaveText("2 of 3 chosen");
    const rowFor = (name: string) => page.locator("li", { hasText: name });
    await expect(rowFor("repo-alpha").getByRole("checkbox")).toBeChecked();
    await expect(rowFor("repo-gamma").getByRole("checkbox")).toBeChecked();
    await expect(rowFor("repo-beta").getByRole("checkbox")).not.toBeChecked();
  });

  test("at the 3-repo cap, unpicked checkboxes are disabled", async () => {
    await seedConnection({
      available_repos: REPOS,
      showcase_repos: [
        { ...REPOS[0], blurb: "a" },
        { ...REPOS[1], blurb: "b" },
        { ...REPOS[2], blurb: "c" },
      ],
      showcase_seen_repos: REPOS.map((r) => r.name),
    });

    await page.goto("/profile");
    await page.getByRole("button", { name: "Change projects" }).click();

    await expect(liveCount()).toHaveText("3 of 3 chosen — deselect one below to swap it out");
    const deltaCheckbox = page.locator("li", { hasText: "repo-delta" }).getByRole("checkbox");
    await expect(deltaCheckbox).toBeDisabled();
  });

  test("empty repo list shows the connected-but-nothing-yet state, not an error", async () => {
    await seedConnection({ available_repos: [] });

    await page.goto("/profile");
    await page.getByRole("button", { name: "Choose projects" }).click();

    await expect(
      page.getByText(/we just didn.t find any public repositories on it yet/i),
    ).toBeVisible();
  });
});

test.describe("GitHub showcase · review nudge", () => {
  test("a new repo triggers the review banner; dismissing marks it seen without touching picks", async () => {
    await seedConnection({
      available_repos: REPOS,
      showcase_repos: [{ ...REPOS[0], blurb: "kept as-is" }],
      // Only repo-alpha has been seen — the other three are "new".
      showcase_seen_repos: ["repo-alpha"],
    });

    await page.goto("/profile");
    await expect(
      page.getByText("There's something new on your GitHub that you haven't looked at yet."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Not now" }).click();
    await expect(
      page.getByText("There's something new on your GitHub that you haven't looked at yet."),
    ).not.toBeVisible();

    const admin = service();
    const { data: row } = await admin
      .from("github_connections")
      .select("showcase_repos, showcase_seen_repos")
      .eq("member_id", memberId)
      .single();
    expect((row!.showcase_seen_repos as string[]).sort()).toEqual(REPOS.map((r) => r.name).sort());
    expect(row!.showcase_repos).toEqual([{ ...REPOS[0], blurb: "kept as-is" }]);
  });
});
