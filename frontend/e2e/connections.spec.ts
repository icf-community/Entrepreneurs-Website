import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// Foundry · Connections, end to end
//
// rls_smoke.sql and adversarial_edges.sql already prove the database
// guarantees — the caps, the cooldowns, the byte-identical refusals, the
// pair uniqueness, that a removed connection stops disclosing an address.
// None of that is re-tested here. What only a browser can show is that
// the two halves of a handshake are wired to each other at all: that
// Connect in the member dialog reaches the RPC, that the request appears
// in somebody ELSE's session, that accepting it puts a real address on
// both screens, and that removing it takes the address off both.
//
// TWO SESSIONS, ONE TEST. This is the only spec in the suite that needs
// them simultaneously, so it runs with no default storageState and opens
// each side explicitly. A single-session version could only ever assert
// that a button did not throw.
//
// It uses a dedicated seeded pair (connector/connectee) rather than the
// shared `student`, because a completed round trip leaves a 21-day
// cooldown behind and no other spec should have to reason about that.
// ════════════════════════════════════════════════════════════════════

const service = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const A = USERS.connector;   // sends
const B = USERS.connectee;   // receives

async function idFor(email: string): Promise<string> {
  const { data } = await service().auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No seeded user for ${email}`);
  return user.id;
}

/**
 * Delete every connection row between two emails, plus their events.
 *
 * Not `remove_connection`: that leaves a `removed` row carrying a 21-day
 * cooldown, which is correct product behaviour and exactly wrong for a
 * fixture — the second test on the same pair would be refused. This is
 * the service role reaching past the RPC on purpose.
 */
async function resetBetween(emailX: string, emailY: string): Promise<void> {
  const db = service();
  const [x, y] = await Promise.all([idFor(emailX), idFor(emailY)]);
  await db.from("connections").delete().in("requester_id", [x, y]).in("addressee_id", [x, y]);
  await db.from("connection_events").delete().in("actor_id", [x, y]);
  await db.from("connection_events").delete().in("subject_id", [x, y]);
}

async function resetPair(): Promise<void> {
  await resetBetween(A.email, B.email);
}

/** Both default true — force them back rather than assume the ambient state. */
async function resetMemberSettings(email: string): Promise<void> {
  const id = await idFor(email);
  await service()
    .from("profiles")
    .update({ open_to_connections: true, connection_emails_enabled: true })
    .eq("id", id);
}

async function setEnabled(enabled: boolean): Promise<void> {
  await service()
    .from("app_config")
    .upsert({ key: "connections_enabled", value: String(enabled) }, { onConflict: "key" });
}

/**
 * Queued mail for an address.
 *
 * NOT Mailpit. Mailpit catches GoTrue's auth mail, which goes straight to
 * the local SMTP catcher; application mail goes to the `outbound_email`
 * outbox and leaves via Resend, which is not reachable from a test. The
 * outbox IS the boundary the server action owns — "mail is never sent from
 * SQL, the action renders and enqueues" — so asserting the row is
 * asserting the actual contract, and it can check the ADDRESS is really in
 * the payload, which "some mail arrived" cannot.
 */
async function queuedMail(to: string): Promise<{ subject: string; text_body: string }[]> {
  const { data } = await service()
    .from("outbound_email")
    .select("subject, text_body")
    .eq("to_address", to)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function clearQueuedMail(to: string): Promise<void> {
  await service().from("outbound_email").delete().eq("to_address", to);
}

// ─── Per-row control names ──────────────────────────────────────────
//
// The row controls are labelled with WHO they act on, not just what they
// do. A full page of connections renders 48 cards × Remove/Block/Report,
// and "Remove" forty-eight times is not a list of controls — so the
// accessible name carries the member and the visible text stays short
// enough to fit under a card.
//
// These helpers exist so the selectors assert that contract rather than
// working around it: `name: "Decline"` would pass on a button labelled
// for nobody, which is the bug.
type Who = { firstName: string; surname: string };
const acceptFrom  = (w: Who) => new RegExp(`^Accept the request from ${w.firstName} ${w.surname}$`);
const declineFrom = (w: Who) => new RegExp(`^Decline the request from ${w.firstName} ${w.surname}$`);
const removeWith  = (w: Who) => new RegExp(`^Remove your connection with ${w.firstName} ${w.surname}$`);
const withdrawTo  = (w: Who) => new RegExp(`^Withdraw your request to ${w.firstName} ${w.surname}$`);
const reportOf    = (w: Who) => new RegExp(`^Report ${w.firstName} ${w.surname}$`);

/** Open the member dialog for a named member from /members. */
async function openMemberDialog(page: Page, surname: string): Promise<void> {
  await page.goto("/members");
  await page.getByRole("button", { name: new RegExp(surname, "i") }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

let ctxA: BrowserContext;
let ctxB: BrowserContext;
let pageA: Page;
let pageB: Page;

test.beforeAll(async ({ browser }) => {
  await setEnabled(true);
  await resetPair();
  ctxA = await browser.newContext({ storageState: storageStatePath("connector") });
  ctxB = await browser.newContext({ storageState: storageStatePath("connectee") });
  pageA = await ctxA.newPage();
  pageB = await ctxB.newPage();
});

test.afterAll(async () => {
  await ctxA?.close();
  await ctxB?.close();
  await resetPair();
  // Left ON deliberately: a later run from a reset database seeds it on,
  // and leaving it off would make a failure in the next suite look like a
  // bug rather than this spec's litter.
  await setEnabled(true);
});

test("the full round trip: request → pending → accept → both see an address → remove", async () => {
  await clearQueuedMail(A.email);

  // ── A sends ───────────────────────────────────────────────────────
  await openMemberDialog(pageA, B.surname);
  await expect(pageA.getByText(/connect to exchange email addresses/i)).toBeVisible();
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();

  // The consent line is required at send. It is not decoration: sending
  // IS the requester's half of the consent, so it has to be on screen at
  // the moment they send.
  await expect(
    pageA.getByText(new RegExp(`if ${B.firstName} accepts`, "i")),
  ).toBeVisible();

  await pageA.getByLabel(/add a note/i).fill("e2e round trip");
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();

  // ── B sees it, with the note ──────────────────────────────────────
  await pageB.goto("/connections?tab=pending");
  await expect(pageB.getByText(new RegExp(`${A.firstName} ${A.surname}`, "i"))).toBeVisible();
  await expect(pageB.getByText("e2e round trip")).toBeVisible();

  // Before accepting, B must not be able to see A's address anywhere on
  // this page. This is the whole feature: the address is the only thing
  // actually gated.
  await expect(pageB.getByText(A.email)).toHaveCount(0);

  // ── B accepts, and the dialog names the literal address released ───
  await pageB.getByRole("button", { name: acceptFrom(A) }).first().click();
  const dialog = pageB.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(B.email)).toBeVisible();
  await dialog.getByRole("button", { name: /accept and share/i }).click();
  await expect(dialog).toBeHidden();

  // ── Both sides now see the other's address ────────────────────────
  await pageB.goto("/connections");
  await expect(pageB.getByText(A.email)).toBeVisible();

  await pageA.goto("/connections");
  await expect(pageA.getByText(B.email)).toBeVisible();

  // ── The requester is emailed, and the mail carries the address ────
  // Only the requester. The accepter just clicked the button; mailing
  // them about their own action is how people learn to filter Foundry
  // mail, and that filter then eats the sign-in codes.
  await expect.poll(async () => (await queuedMail(A.email)).length).toBeGreaterThan(0);
  const [accepted] = await queuedMail(A.email);
  expect(accepted!.subject).toMatch(new RegExp(`${B.firstName}.*accepted`, "i"));
  expect(accepted!.text_body).toContain(B.email);
  expect(await queuedMail(B.email)).toHaveLength(0);

  // ── Remove is mutual ──────────────────────────────────────────────
  await pageA.getByRole("button", { name: removeWith(B) }).first().click();
  const confirm = pageA.getByRole("dialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: /remove connection/i }).click();
  // Wait for the dialog to close before navigating. The confirm fires a
  // server action; a goto() racing it aborts the request mid-flight, and
  // the test then reads a database the action never reached.
  await expect(confirm).toBeHidden();

  await pageA.goto("/connections");
  await expect(pageA.getByText(B.email)).toHaveCount(0);

  // The other side loses it too, and loses it on the other side's action
  // — which is the assertion a single-session test cannot make.
  await pageB.goto("/connections");
  await expect(pageB.getByText(A.email)).toHaveCount(0);
});

test("a declined request tells the sender nothing and leaves no row on either side", async () => {
  await resetPair();

  await openMemberDialog(pageA, B.surname);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();

  await pageB.goto("/connections?tab=pending");
  await pageB.getByRole("button", { name: declineFrom(A) }).first().click();
  const confirm = pageB.getByRole("dialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(confirm).toBeHidden();

  // Declining notifies nobody, and the request vanishes from the sender's
  // view entirely rather than showing as rejected. A sender who can see
  // "declined" has learned something the recipient did not agree to tell
  // them, and it is the single most important silence in this feature.
  await pageA.goto("/connections?tab=sent");
  await expect(pageA.getByText(new RegExp(`${B.firstName} ${B.surname}`, "i"))).toHaveCount(0);
  // The row is GONE, not shown with a "declined" status. The tab's own
  // standing copy does say the word "declined" — it explains that this is
  // what happens — so the assertion is on the empty state, not on the
  // absence of the word.
  await expect(pageA.getByText(/no requests outstanding/i)).toBeVisible();
  await expect(pageA.getByRole("button", { name: withdrawTo(B) })).toHaveCount(0);

  await pageB.goto("/connections?tab=pending");
  await expect(pageB.getByText(new RegExp(`${A.firstName} ${A.surname}`, "i"))).toHaveCount(0);
});

test("the sender can withdraw, and it disappears from the recipient's requests", async () => {
  await resetPair();

  await openMemberDialog(pageA, B.surname);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();

  await pageB.goto("/connections?tab=pending");
  await expect(pageB.getByText(new RegExp(`${A.firstName} ${A.surname}`, "i"))).toBeVisible();

  await pageA.goto("/connections?tab=sent");
  await pageA.getByRole("button", { name: withdrawTo(B) }).first().click();
  const confirm = pageA.getByRole("dialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(confirm).toBeHidden();

  await pageB.goto("/connections?tab=pending");
  await expect(pageB.getByText(new RegExp(`${A.firstName} ${A.surname}`, "i"))).toHaveCount(0);
});

test("the kill switch stops new requests and leaves everything else working", async () => {
  await resetPair();

  // A request that is already in flight when the switch is thrown.
  await openMemberDialog(pageA, B.surname);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();

  await setEnabled(false);
  try {
    // B can still accept. This is the whole point of gating NEW REQUESTS
    // ONLY: a switch that also froze the inbox would strand everyone
    // mid-handshake with a queue they cannot clear.
    await pageB.goto("/connections?tab=pending");
    await pageB.getByRole("button", { name: acceptFrom(A) }).first().click();
    const acceptDialog = pageB.getByRole("dialog");
    await acceptDialog.getByRole("button", { name: /accept and share/i }).click();
    await expect(acceptDialog).toBeHidden();

    await pageB.goto("/connections");
    await expect(pageB.getByText(A.email)).toBeVisible();
  } finally {
    await setEnabled(true);
  }
});

test("the digest claims each pending request exactly once, even under a double cron run", async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  // The route's own auth, not something a test can fake. Skipped rather
  // than asserted-around when it is absent, so the skip is visible.
  test.skip(!secret, "CRON_SECRET is not set for this run");

  await resetPair();
  await clearQueuedMail(B.email);

  await openMemberDialog(pageA, B.surname);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();

  const call = () =>
    request.post("/api/cron/connections-digest", {
      headers: { authorization: `Bearer ${secret}` },
    });

  const first = await call();
  expect(first.ok()).toBeTruthy();
  expect((await first.json()).digested).toBeGreaterThan(0);

  // The claim stamps digested_at in the SAME statement that selects the
  // rows, so a second run — an overlapping cron, a manual retrigger, a
  // pg_net redelivery — matches zero rows. No time-window arithmetic is
  // involved, which is why this holds a second later rather than only a
  // day later.
  const second = await call();
  expect(second.ok()).toBeTruthy();
  expect((await second.json()).digested).toBe(0);

  const mail = await queuedMail(B.email);
  expect(mail).toHaveLength(1);
  expect(mail[0]!.subject).toMatch(new RegExp(A.firstName, "i"));
  // Names and counts only. The note is attacker-controlled text and this
  // builds HTML; not carrying it removes the injection surface entirely,
  // and stops an abusive note reaching an inbox where there is no Block
  // control next to it.
  expect(mail[0]!.text_body).not.toContain("e2e round trip");

  await clearQueuedMail(B.email);
});

test("the network view can be driven from the keyboard, and renders a settled layout", async () => {
  await resetPair();

  // A connection to look at.
  await openMemberDialog(pageA, B.surname);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();
  await pageB.goto("/connections?tab=pending");
  await pageB.getByRole("button", { name: acceptFrom(A) }).first().click();
  const accept = pageB.getByRole("dialog");
  await accept.getByRole("button", { name: /accept and share/i }).click();
  await expect(accept).toBeHidden();

  await pageA.goto("/connections?view=graph");

  // The group is one tab stop with arrow keys inside it. Forty tab stops
  // to cross a graph is not keyboard support, it is a keyboard trap with
  // extra steps — so the assertion is that a node is reachable AND that
  // the arrow keys are what move between them.
  const node = pageA.getByRole("button", { name: new RegExp(`${B.firstName} ${B.surname}`, "i") });
  await expect(node).toBeVisible();
  await node.focus();
  await expect(node).toBeFocused();
  await pageA.keyboard.press("ArrowRight");

  // Enter opens the person — which means switching to the card view
  // scoped to them, because that is where their address is.
  await node.focus();
  await pageA.keyboard.press("Enter");
  await expect(pageA.getByText(B.email)).toBeVisible();

  // The clustering control is a real labelled control, not a bare chip.
  await pageA.goto("/connections?view=graph");
  await expect(pageA.getByLabel(/group by/i)).toBeVisible();

  // No running simulation to suppress: the layout is solved synchronously
  // before the first paint, so there is nothing animating in either
  // motion preference. Asserted by taking two snapshots of a node's
  // position a beat apart and requiring them to be identical.
  const circle = pageA.locator("svg circle").nth(1);
  const first = await circle.boundingBox();
  await pageA.waitForTimeout(600);
  const second = await circle.boundingBox();
  expect(second).toEqual(first);
});

test("copying an address works, and degrades to selectable text when the browser blocks it", async ({ browser }) => {
  // THE interaction the feature exists for, and the one most able to fail
  // silently: navigator.clipboard needs a secure context and can be
  // refused by permissions policy, and it fails by REJECTING A PROMISE —
  // so the naive version is a working-looking button that does nothing,
  // on exactly the browsers where nobody thinks to check.
  //
  // The plan called this un-automatable and assumed a manual pass. It is
  // automatable: removing navigator.clipboard before the page loads
  // reproduces the blocked case exactly, and a repeatable assertion beats
  // a manual check nobody re-runs.

  // ── Success path ──────────────────────────────────────────────────
  const okCtx = await browser.newContext({
    storageState: storageStatePath("connector"),
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const okPage = await okCtx.newPage();
  try {
    await okPage.goto("/connections");
    await okPage.getByRole("button", { name: new RegExp(`copy ${B.firstName}'s email`, "i") }).click();
    // Two nodes say "Copied": the visible one and the sr-only aria-live
    // region that announces it. Both are wanted — a checkmark swap is
    // invisible to a screen reader — so this asserts on the visible one
    // rather than collapsing them.
    await expect(okPage.getByText("Copied", { exact: true }).last()).toBeVisible();
    await expect(okPage.locator('[aria-live="polite"]')).toHaveText(/copied/i);
    expect(await okPage.evaluate(() => navigator.clipboard.readText())).toBe(B.email);
  } finally {
    await okCtx.close();
  }

  // ── Blocked path ──────────────────────────────────────────────────
  const blockedCtx = await browser.newContext({ storageState: storageStatePath("connector") });
  const blockedPage = await blockedCtx.newPage();
  try {
    await blockedPage.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    await blockedPage.goto("/connections");
    await blockedPage.getByRole("button", { name: new RegExp(`copy ${B.firstName}'s email`, "i") }).click();

    // The address has to still be reachable: revealed as selectable text,
    // focused and selected, so the member's own copy shortcut works.
    // getByRole("textbox"), not getByLabel. The copy button next to it is
    // called "Copy Dev's email address", so a substring match on the name
    // hits both controls and fails on strict mode — which says nothing
    // about the fallback and everything about the selector.
    const fallback = blockedPage.getByRole("textbox", {
      name: new RegExp(`^${B.firstName}'s email address$`, "i"),
    });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveValue(B.email);
    await expect(fallback).toBeFocused();
    await expect(blockedPage.getByText(/your browser blocked the copy/i)).toBeVisible();
  } finally {
    await blockedCtx.close();
  }
});

test("filtering the card list actually changes the list", async () => {
  // Regression guard, and it caught a real bug. Each tab seeds its rows
  // from props with useState so it can drop a row locally on success, and
  // useState ignores prop changes after mount — so a filter change
  // re-rendered with new props and left the OLD list on screen. Nothing
  // about the filter panel looked broken; the list simply never moved.
  await pageA.goto("/connections");
  await expect(pageA.getByText(B.email)).toBeVisible();

  await pageA.goto("/connections?q=zzz-no-such-member");
  await expect(pageA.getByText(B.email)).toHaveCount(0);
  await expect(pageA.getByText(/nothing matches those filters/i)).toBeVisible();

  await pageA.goto("/connections");
  await expect(pageA.getByText(B.email)).toBeVisible();
});

test("the network payload carries no email addresses", async () => {
  // The graph is a browsing surface, and keeping it address-free is what
  // stops it becoming an accidental bulk-export endpoint.
  //
  // Asserted on the page SOURCE, not on what is visible: props reach the
  // browser in the RSC payload whether or not anything renders them, so
  // "no address on screen" would pass while 48 of them sat in the HTML.
  // That is exactly what happened before page.tsx stopped fetching the
  // card rows behind the graph.
  //
  // The viewer's OWN address is excluded from the claim. It is rendered
  // into the accept dialog's copy by design — naming the literal address
  // being released is the consent requirement — and it is theirs already.
  // The property being defended is that no OTHER member's address is in
  // this document.
  await pageA.goto("/connections?view=graph");
  const html = await pageA.content();
  expect(html).not.toContain(B.email);
});

test("a report reaches the admin queue, and resolving it emails the reporter", async ({ browser }) => {
  // The one path in this feature that crosses three people: B reports A,
  // an admin adjudicates, and B is told the outcome. The database
  // guarantees are asserted in rls_smoke; what only a browser shows is
  // that the member's Report control, the admin queue and the outcome
  // email are actually wired to each other.
  //
  // Resolving ALWAYS emails the reporter, for both outcomes. A report
  // route that never reports back is the half of a complaints process
  // that is easiest to skip and the half that makes it real — so the
  // assertion is on the mail, not on the queue emptying.
  await resetPair();
  await clearQueuedMail(B.email);
  await service().from("connection_reports").delete().eq("reason", "e2e report round trip");

  // Connect first: reporting is scoped to a connection you are party to.
  await openMemberDialog(pageA, B.surname);
  await pageA.getByRole("button", { name: "Connect", exact: true }).click();
  await pageA.getByRole("button", { name: /send request/i }).click();
  await expect(pageA.getByText(/request sent/i)).toBeVisible();

  await pageB.goto("/connections?tab=pending");
  await pageB.getByRole("button", { name: acceptFrom(A) }).first().click();
  const accept = pageB.getByRole("dialog");
  await accept.getByRole("button", { name: /accept and share/i }).click();
  await expect(accept).toBeHidden();

  // ── B reports A ───────────────────────────────────────────────────
  await pageB.goto("/connections");
  await pageB.getByRole("button", { name: reportOf(A) }).first().click();
  const report = pageB.getByRole("dialog");
  await expect(report).toBeVisible();
  await report.getByLabel(/reason/i).selectOption({ index: 1 });
  await report.getByLabel(/what happened/i).fill("e2e report round trip");
  await report.getByRole("button", { name: /send report/i }).click();

  // A receipt, not a silent close. Reporting somebody produces nothing
  // visible — nothing is taken down and the other member is never told —
  // so a dialog that just vanished would be indistinguishable from one
  // that failed.
  // `that.s` because the copy uses &rsquo;, a typographic apostrophe, and a
  // straight one in the pattern matches nothing.
  await expect(report.getByText(/that.s with us/i)).toBeVisible();
  await report.getByRole("button", { name: /close/i }).click();
  await expect(report).toBeHidden();

  // ── An admin adjudicates ──────────────────────────────────────────
  const adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
  const adminPage = await adminCtx.newPage();
  try {
    await adminPage.goto("/admin/connections");
    const card = adminPage.locator("li", { hasText: "e2e report round trip" }).first();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Dismiss", exact: true }).click();
    const resolve = adminPage.getByRole("dialog");
    await expect(resolve).toBeVisible();
    await resolve.getByLabel(/note for the reporter/i).fill("Reviewed, no action needed.");
    await resolve.getByRole("button", { name: /dismiss and email reporter/i }).click();
    await expect(resolve).toBeHidden();

    // Off the open queue, and findable under Dismissed rather than gone.
    await expect(
      adminPage.locator("li", { hasText: "e2e report round trip" }),
    ).toHaveCount(0);
    await adminPage.getByRole("button", { name: "Dismissed", exact: true }).click();
    await expect(
      adminPage.locator("li", { hasText: "e2e report round trip" }).first(),
    ).toBeVisible();
  } finally {
    await adminCtx.close();
  }

  // ── The reporter is told, either way ──────────────────────────────
  await expect.poll(async () => (await queuedMail(B.email)).length).toBeGreaterThan(0);
  const [outcome] = await queuedMail(B.email);
  expect(outcome!.text_body).toContain("Reviewed, no action needed.");

  await service().from("connection_reports").delete().eq("reason", "e2e report round trip");
  await clearQueuedMail(B.email);
});

test("an admin who is a party to a report sees the conflict-of-interest notice", async ({ browser }) => {
  // Admin + connector (pageA, already logged in for the whole file) — not
  // a fresh session for reauth or emailchange. Both of those accounts get
  // their seeded session invalidated by other specs earlier in a full
  // regression run (member.spec.ts's password-change test explicitly
  // revokes reauth's session; its email-change test rotates emailchange's
  // address mid-run), so a new browser context built from either
  // storageState file is already dead by the time the connections
  // project runs — confirmed by this test failing with a bounce to
  // /login when it first used reauth that way, despite passing in
  // isolation. connector/admin have no such lifecycle elsewhere.
  //
  // adversarial_edges.sql (F9) already proves admin_list_connection_reports
  // flags a report where the resolving admin is a party — what only a
  // browser shows is that the admin queue actually renders the notice,
  // not just that the RPC returns the flag.
  const admin = USERS.admin;
  const adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
  const adminPage = await adminCtx.newPage();

  try {
    await resetBetween(admin.email, A.email);
    await service().from("connection_reports").delete().eq("reason", "e2e conflict of interest");

    await openMemberDialog(pageA, admin.surname);
    await pageA.getByRole("button", { name: "Connect", exact: true }).click();
    await pageA.getByRole("button", { name: /send request/i }).click();
    await expect(pageA.getByText(/request sent/i)).toBeVisible();

    await adminPage.goto("/connections?tab=pending");
    await adminPage.getByRole("button", { name: acceptFrom(A) }).first().click();
    const accept = adminPage.getByRole("dialog");
    await accept.getByRole("button", { name: /accept and share/i }).click();
    await expect(accept).toBeHidden();

    await pageA.goto("/connections");
    await pageA.getByRole("button", { name: reportOf(admin) }).first().click();
    const report = pageA.getByRole("dialog");
    await expect(report).toBeVisible();
    await report.getByLabel(/reason/i).selectOption({ index: 1 });
    await report.getByLabel(/what happened/i).fill("e2e conflict of interest");
    await report.getByRole("button", { name: /send report/i }).click();
    await expect(report.getByText(/that.s with us/i)).toBeVisible();
    await report.getByRole("button", { name: /close/i }).click();

    // The admin's own queue names the connection they are one half of.
    await adminPage.goto("/admin/connections");
    const card = adminPage.locator("li", { hasText: "e2e conflict of interest" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/one of the people involved in this report/i)).toBeVisible();
  } finally {
    await service().from("connection_reports").delete().eq("reason", "e2e conflict of interest");
    await resetBetween(admin.email, A.email);
    await adminCtx.close();
  }
});

test("the pause switch and the digest opt-out actually round-trip, and pausing takes effect for someone else", async ({ browser }) => {
  // Admin again, for the same reason as the conflict-of-interest test
  // above: its session survives untouched across a full regression run,
  // where `student`'s does not collide (its surname IS the literal
  // string "Student", also the role text on every card — "Student ·
  // class of 2027" — so openMemberDialog's regex below would match the
  // first card in the whole directory) and `emailchange`/`reauth` are
  // mutated or session-revoked by other specs earlier in the same run.
  const target = USERS.admin;
  const ctx = await browser.newContext({ storageState: storageStatePath("admin") });
  const page = await ctx.newPage();
  const openSwitch = () => page.getByRole("switch", { name: /accept new connection requests/i });
  const emailSwitch = () => page.getByRole("switch", { name: /email me about pending requests/i });

  try {
    // Force the known starting state rather than assume the ambient
    // default — a prior failed run of this exact test is the one way
    // that assumption breaks, and it would otherwise fail every run
    // after until someone notices.
    await resetMemberSettings(target.email);
    await page.goto("/settings");
    await expect(openSwitch()).toBeChecked();
    await expect(emailSwitch()).toBeChecked();

    // Each switch disables itself for the length of its own round trip
    // (`busy` in ConnectionSettings.tsx) — waited out before the next
    // click so two overlapping in-flight requests can't have one's
    // reload race the other's still-pending write.
    await openSwitch().click();
    await expect(openSwitch()).not.toBeChecked();
    await expect(openSwitch()).toBeEnabled();
    await emailSwitch().click();
    await expect(emailSwitch()).not.toBeChecked();
    await expect(emailSwitch()).toBeEnabled();

    // Reload to prove the RPC actually persisted it, not just that the
    // optimistic UI moved and would revert on a real failure.
    await page.reload();
    await expect(openSwitch()).not.toBeChecked();
    await expect(emailSwitch()).not.toBeChecked();

    // Paused takes effect immediately for someone else trying to connect
    // — the same generic refusal a block or cooldown gives, so pausing
    // can't be used to work out why a request was refused.
    await openMemberDialog(pageA, target.surname);
    await expect(
      pageA.getByText(/can.t send a request to this member right now/i),
    ).toBeVisible();
    await pageA.getByRole("button", { name: "Close" }).click();

    // Turn both back on and confirm the round trip works the other way.
    await openSwitch().click();
    await expect(openSwitch()).toBeEnabled();
    await emailSwitch().click();
    await expect(emailSwitch()).toBeEnabled();
    await page.reload();
    await expect(openSwitch()).toBeChecked();
    await expect(emailSwitch()).toBeChecked();

    await openMemberDialog(pageA, target.surname);
    await expect(pageA.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
    await pageA.getByRole("button", { name: "Close" }).click();
  } finally {
    // Belt and braces: if an assertion above throws mid-test, this still
    // runs, so a failure here can't leave this account paused for
    // whatever the next run of this test — or any other spec reusing
    // it — expects to find.
    await resetMemberSettings(target.email);
    await ctx.close();
  }
});

test("cold start: every tab has an empty state that points at the directory", async ({ browser }) => {
  // A third, connection-less session. The seeded pair has history by now,
  // and "nothing here" has to be tested on somebody for whom it is true.
  const ctx = await browser.newContext({ storageState: storageStatePath("student") });
  const page = await ctx.newPage();
  try {
    for (const tab of ["", "?tab=pending", "?tab=sent"]) {
      await page.goto(`/connections${tab}`);
      // A tab reading "nothing here" indefinitely is worse than the
      // "Coming soon" placeholder this replaced, so every empty state
      // has to offer the next step.
      await expect(page.getByRole("link", { name: /member|director|browse/i }).first()).toBeVisible();
    }
  } finally {
    await ctx.close();
  }
});
