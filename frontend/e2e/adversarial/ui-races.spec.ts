import { test, expect, type Browser, type Page } from "@playwright/test";
import { storageStatePath } from "../fixtures";
import { newMember, deleteMember, storageStateFor, psql, validEvent, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Adversarial · two real browser contexts racing each other on the UI.
// Each test seeds its own throwaway poster + event so nothing else
// depends on queue position, and annotates what the loser actually saw.
// ════════════════════════════════════════════════════════════════════

test.describe.configure({ mode: "serial" });

const CRASH = /Something went wrong loading|Application error|Unhandled|TypeError|RangeError/i;
const SOFT = /Something went wrong\. Please try again\./i;

async function seedEvent(title: string): Promise<{ poster: Member; id: string }> {
  const poster = await newMember("uiRace");
  const { data, error } = await poster.client.rpc("submit_event", validEvent({ p_title: title }));
  if (error) throw new Error(`seed event: ${error.message}`);
  return { poster, id: data as string };
}

async function adminTab(browser: Browser, title: string): Promise<{ page: Page; card: ReturnType<Page["locator"]> }> {
  const ctx = await browser.newContext({ storageState: storageStatePath("admin") });
  const page = await ctx.newPage();
  await page.goto("/admin/events");
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 15_000 });
  return { page, card };
}

const emailsTo = (to: string) => Number(psql(`select count(*) from outbound_email where to_address='${to}'`));

test("two admins approve the same event at once: one approval, one email, loser sees a sane message", async ({ browser }) => {
  const title = `UI race approve ${Date.now()}`;
  const { poster, id } = await seedEvent(title);
  const a = await adminTab(browser, title);
  const b = await adminTab(browser, title);
  await Promise.all([
    a.card.getByRole("button", { name: "Approve", exact: true }).click(),
    b.card.getByRole("button", { name: "Approve", exact: true }).click(),
  ]);
  await a.page.waitForTimeout(2500);
  await b.page.waitForTimeout(2500);
  const status = psql(`select status from events where id='${id}'`);
  const bodies = [await a.page.locator("body").innerText(), await b.page.locator("body").innerText()];
  test.info().annotations.push({
    type: "observation",
    description: `status=${status}; generic-error-shown=${bodies.map((t) => SOFT.test(t))}; tabA toast/card: ${JSON.stringify(bodies[0].match(/(no longer|already|changed|reload|error|failed)[^\n]{0,80}/i)?.[0] ?? "none")}; tabB: ${JSON.stringify(bodies[1].match(/(no longer|already|changed|reload|error|failed)[^\n]{0,80}/i)?.[0] ?? "none")}`,
  });
  expect(status).toBe("approved");
  for (const t of bodies) expect(t).not.toMatch(CRASH);
  // F5: the loser must not be left on a generic error, and their stale card
  // must leave the queue (the action revalidates the admin list).
  for (const t of bodies) expect(t, "loser saw the generic error").not.toMatch(SOFT);
  await expect(a.card).toHaveCount(0, { timeout: 10_000 });
  await expect(b.card).toHaveCount(0, { timeout: 10_000 });
  const mails = emailsTo(poster.email);
  expect(mails, "poster is emailed once for one approval").toBeLessThanOrEqual(1);
  await a.page.context().close(); await b.page.context().close(); await deleteMember(poster);
});

test("double-click on Approve approves once and sends one email", async ({ browser }) => {
  const title = `UI race dbl ${Date.now()}`;
  const { poster, id } = await seedEvent(title);
  const a = await adminTab(browser, title);
  await a.card.getByRole("button", { name: "Approve", exact: true }).dblclick().catch(() => undefined);
  await a.page.waitForTimeout(2500);
  expect(psql(`select status from events where id='${id}'`)).toBe("approved");
  expect(await a.page.locator("body").innerText()).not.toMatch(CRASH);
  expect(emailsTo(poster.email)).toBeLessThanOrEqual(1);
  await a.page.context().close(); await deleteMember(poster);
});

test("admin approves from a stale card after the poster edited the listing: stale approval must not publish unreviewed content", async ({ browser }) => {
  const title = `UI race stale ${Date.now()}`;
  const { poster, id } = await seedEvent(title);
  const a = await adminTab(browser, title);
  // Poster rewrites the description AFTER the admin loaded the card.
  const { error } = await poster.client.rpc("update_event", {
    ...validEvent({ p_title: title, p_description: "REWRITTEN after the admin opened the card — not what was reviewed" }),
    p_id: id,
    p_expected_version: Number(psql(`select edit_version from events where id='${id}'`)),
  });
  expect(error?.message).toBeUndefined();
  await a.card.getByRole("button", { name: "Approve", exact: true }).click();
  await a.page.waitForTimeout(2500);
  const status = psql(`select status from events where id='${id}'`);
  const body = await a.page.locator("body").innerText();
  test.info().annotations.push({
    type: "observation",
    description: `status after stale approve=${status}; admin saw: ${JSON.stringify(body.match(/(changed|reload|no longer|stale|updated)[^\n]{0,100}/i)?.[0] ?? "none")}`,
  });
  expect(status, "a stale approval of since-edited content must be refused").toBe("pending");
  expect(body).not.toMatch(CRASH);
  await a.page.context().close(); await deleteMember(poster);
});

test("poster deletes the listing while the admin has it open: approve fails soft", async ({ browser }) => {
  const title = `UI race del ${Date.now()}`;
  const { poster, id } = await seedEvent(title);
  const a = await adminTab(browser, title);
  await poster.client.from("events").delete().eq("id", id);
  await a.card.getByRole("button", { name: "Approve", exact: true }).click();
  await a.page.waitForTimeout(2500);
  const body = await a.page.locator("body").innerText();
  test.info().annotations.push({ type: "observation", description: `admin saw: ${JSON.stringify(body.match(/(no longer|not found|deleted|exist|error|failed)[^\n]{0,100}/i)?.[0] ?? "none")}` });
  expect(body).not.toMatch(CRASH);
  expect(psql(`select count(*) from events where id='${id}'`)).toBe("0");
  await a.page.context().close(); await deleteMember(poster);
});

test("admin approve vs admin reject on the same event from two tabs: one coherent result", async ({ browser }) => {
  const title = `UI race rej ${Date.now()}`;
  const { poster, id } = await seedEvent(title);
  const a = await adminTab(browser, title);
  const b = await adminTab(browser, title);
  await b.card.getByRole("button", { name: /^Reject/ }).first().click();
  const reason = b.page.getByLabel(/reason/i).first();
  if (await reason.count()) await reason.fill("race test rejection reason");
  await Promise.all([
    a.card.getByRole("button", { name: "Approve", exact: true }).click(),
    b.page.getByRole("button", { name: /^(Reject|Confirm|Send)/ }).last().click().catch(() => undefined),
  ]);
  await a.page.waitForTimeout(3000);
  const row = psql(`select status || '|' || coalesce(rejected_reason,'') from events where id='${id}'`);
  test.info().annotations.push({ type: "observation", description: `final row: ${row || "(deleted)"}` });
  // Rejected listings may be deleted outright; otherwise never approved-with-reason.
  expect(row).not.toMatch(/^approved\|.+/);
  for (const p of [a.page, b.page]) expect(await p.locator("body").innerText()).not.toMatch(CRASH);
  await a.page.context().close(); await b.page.context().close(); await deleteMember(poster);
});

test("poster edits one pending listing in two tabs: the stale tab is told, not silently overwriting", async ({ browser }) => {
  const title = `UI race edit ${Date.now()}`;
  const { poster, id } = await seedEvent(title);
  const ctx = await browser.newContext({ storageState: await storageStateFor(poster) });
  const t1 = await ctx.newPage();
  const t2 = await ctx.newPage();
  await t1.goto(`/events/${id}/edit`);
  await t2.goto(`/events/${id}/edit`);
  await t1.getByLabel(/^Title/).fill(`${title} FIRST`);
  await t2.getByLabel(/^Title/).fill(`${title} SECOND`);
  await t1.getByRole("button", { name: "Save changes" }).click();
  await expect(t1).toHaveURL(/\/my-submissions/, { timeout: 15_000 });
  await t2.getByRole("button", { name: "Save changes" }).click();
  await t2.waitForTimeout(2500);
  const finalTitle = psql(`select title from events where id='${id}'`);
  const body = await t2.locator("body").innerText();
  test.info().annotations.push({
    type: "observation",
    description: `final title="${finalTitle}"; stale tab url=${t2.url()}; saw: ${JSON.stringify(body.match(/(changed|another tab|reload|conflict)[^\n]{0,100}/i)?.[0] ?? "none")}`,
  });
  expect(finalTitle, "the stale tab's write must not silently clobber the first save").toBe(`${title} FIRST`);
  expect(body).not.toMatch(CRASH);
  await ctx.close(); await deleteMember(poster);
});
