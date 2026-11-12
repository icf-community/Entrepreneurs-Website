import { expect, test as base, type Page } from "@playwright/test";
import { psql as aiPsql, setAiFlags, startAiServices, waitFor } from "../ai-services";
import { assertLocal, deleteMember, newMember, psql, storageStateFor, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Foundry AI composer and layout edges, through the browser against the
// fake provider (the happy paths live in e2e/ai.spec.ts, the database limits
// in server/tests/integration/test_ai_limits.py).
//
//   - the 600-character cap and the counter, whitespace-only drafts
//   - Enter sends, Shift+Enter is a newline, a double Enter makes one turn
//   - "Temporary search" is recorded on the conversation
//   - RTL / emoji / combining text is accepted or refused cleanly, never an error page
//   - 320px and 390px: no sideways scroll, the composer and Search stay usable
//   - keyboard-only: the composer is reachable and sends with no pointer
//
// Own member, own services; the AI flags are switched on for this run only.
// Needs a fresh build (playwright.adversarial.config.ts, project adv-ai).
// ════════════════════════════════════════════════════════════════════

let state: Awaited<ReturnType<typeof storageStateFor>>;
// Each test signs in as the member created in beforeAll.
const test = base.extend({
  storageState: async ({}, provide) => {
    await provide(state as never);
  },
});

test.describe.configure({ mode: "serial" });

const MODELS = "('gpt-5.4-mini', 'gpt-6.1-sol', 'text-embedding-3-small')";
let m: Member;
let stop: (() => void) | null = null;

const turns = () => Number(psql(`select count(*) from ai_private.turns where owner_id = '${m.id}'`));
const resetMinute = () => psql(`delete from ai_private.usage_events where owner_id = '${m.id}'`);

// The turn row is the stable signal that a send happened. The screen's "Waiting to start…" and
// "Working…" last only until the fake provider finishes, so a test that waits for that text races it.
const turnRecorded = (before: number) => waitFor(() => turns() > before, "the turn to be recorded", 15_000);

test.beforeAll(async () => {
  test.setTimeout(120_000);
  assertLocal();
  m = await newMember("aiedge");
  state = await storageStateFor(m);
  aiPsql(`update ai_private.model_prices set confirmed = true where model in ${MODELS}`);
  aiPsql(`update public.profiles set bio_focus = 'Building Python and PyTorch projects' where id = '${m.id}'`);
  setAiFlags(true);
  stop = startAiServices();
  aiPsql("select ai_private.enqueue_ai_backfill(5000)");
  await waitFor(
    () => aiPsql(`select count(*) from ai_private.member_docs where member_id = '${m.id}' and purpose = 'self'`).trim() === "1",
    "the member's AI projection",
    60_000,
  );
});

test.afterAll(async () => {
  stop?.();
  setAiFlags(false);
  aiPsql(`update ai_private.model_prices set confirmed = false where model in ${MODELS}`);
  if (m) {
    aiPsql(`delete from ai_private.conversations where owner_id = '${m.id}'; delete from ai_private.usage_events where owner_id = '${m.id}'`);
    await deleteMember(m);
  }
});

// Each test starts with no threads (the product allows five) and a clear minute window.
test.beforeEach(() => {
  resetMinute();
  aiPsql(`delete from ai_private.conversations where owner_id = '${m.id}'`);
});

async function open(page: Page, w = 1280) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto("/foundry-ai?mode=network");
  await expect(page.getByRole("heading", { name: "Search the network" })).toBeVisible();
  return page.getByLabel("Your search");
}

test("control: the page loads for a fresh member and Search starts disabled", async ({ page }) => {
  const box = await open(page);
  await expect(box).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
});

test("the draft is capped at 600 characters and the counter says so", async ({ page }) => {
  const box = await open(page);
  await box.fill("a".repeat(700));
  await expect(box).toHaveValue("a".repeat(600));
  await expect(page.getByText("600/600")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeEnabled();
});

test("a whitespace-only draft cannot be sent, by button or by Enter", async ({ page }) => {
  const box = await open(page);
  const before = turns();
  await box.fill("   \n  ");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  await box.press("Enter");
  await page.waitForTimeout(500);
  expect(turns(), "a blank draft created a turn").toBe(before);
});

test("Shift+Enter is a newline and does not send", async ({ page }) => {
  const box = await open(page);
  const before = turns();
  await box.fill("python");
  await box.press("Shift+Enter");
  await box.pressSequentially("pytorch");
  await expect(box).toHaveValue("python\npytorch");
  await page.waitForTimeout(400);
  expect(turns()).toBe(before);
});

test("pressing Enter twice quickly makes exactly one turn", async ({ page }) => {
  const box = await open(page);
  const before = turns();
  await box.fill("python and pytorch");
  await box.press("Enter");
  await box.press("Enter").catch(() => {}); // the field may already be disabled/cleared
  await turnRecorded(before);
  await page.waitForTimeout(800); // room for a second, wrongly created turn to show up
  expect(turns() - before, "double Enter created more than one turn").toBe(1);
});

test("a starter chip fills the draft without sending it", async ({ page }) => {
  const box = await open(page);
  const before = turns();
  const chip = page.locator("form button[type=button]").filter({ hasNotText: /^$/ }).first();
  const text = (await chip.textContent())!.trim();
  await chip.click();
  await expect(box).toHaveValue(text);
  expect(turns()).toBe(before);
});

test("a temporary search is recorded as temporary", async ({ page }) => {
  const box = await open(page);
  const toggle = page.getByLabel(/Temporary search/);
  await toggle.check();
  await box.fill("pytorch experience");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await waitFor(() => Number(psql(`select count(*) from ai_private.conversations where owner_id = '${m.id}' and temporary`)) >= 1, "a temporary conversation", 15_000);
});

for (const [label, text] of [
  ["right-to-left text", "مطور بايثون وتعلم عميق"],
  ["emoji and combining marks", "python 🐍 é́ ‍‍ people"],
  ["a bidi override", "‮python‬ developers"],
  ["markup", "<img src=x onerror=alert(1)> python"],
] as const) {
  test(`${label} is handled without an error page or script`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });
    const box = await open(page);
    const before = turns();
    await box.fill(text);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    // Either a turn is recorded or the screen refuses it plainly; the page stays up.
    await expect
      .poll(async () => turns() > before || (await page.getByText(/couldn't turn that|can't search|Try naming/).count()) > 0, { timeout: 20_000 })
      .toBe(true);
    await expect(page.getByRole("heading", { name: "Search the network" })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    expect(await page.locator("img[src='x']").count(), "markup in the draft rendered as an element").toBe(0);
  });
}

for (const w of [320, 390]) {
  test(`at ${w}px the page does not scroll sideways and Search is reachable`, async ({ page }) => {
    const box = await open(page, w);
    await box.fill("python");
    const btn = page.getByRole("button", { name: "Search", exact: true });
    await expect(btn).toBeVisible();
    const box2 = await btn.boundingBox();
    expect(box2!.x + box2!.width, "Search button is cut off at the right edge").toBeLessThanOrEqual(w + 0.5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);
  });
}

test("keyboard only: Tab reaches the composer and Enter sends", async ({ page }) => {
  await open(page);
  const before = turns();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.id === "ai-composer");
  }
  expect(reached, "the composer is not reachable by Tab").toBe(true);
  await page.keyboard.type("pytorch");
  await page.keyboard.press("Enter");
  await turnRecorded(before);
  expect(turns() - before).toBe(1);
});
