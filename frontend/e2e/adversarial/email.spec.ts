import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import { psql, service } from "./helpers";
import { withCompanyFooter } from "../../src/lib/emailFooter";

// ════════════════════════════════════════════════════════════════════
// Outbound email: the real drain route against a fake Resend.
//
// The route sends with the Resend SDK, which honours RESEND_BASE_URL, so a
// local HTTP server stands in for api.resend.com. Nothing leaves the
// machine. The webServer must be started with:
//
//   RESEND_API_KEY=re_fake_key RESEND_BASE_URL=http://127.0.0.1:4010
//   RESEND_FROM='Foundry <noreply@example.test>'
//
// (see the run recipe in tasks/e2e-adversarial-sweep.md). Without them the
// route answers 500 "not configured" and this file skips itself.
//
// Properties: exactly-once delivery under repeated and concurrent drains,
// the idempotency key is the row id, and each failure class lands in the
// state the route's contract promises (429 defers without burning an
// attempt; 5xx and network errors back off; other 4xx bury the row).
// ════════════════════════════════════════════════════════════════════

const PORT = 4010;
const AUTH = { authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret"}` };

type Seen = { to: string; subject: string; text: string; html: string; replyTo?: string; idempotencyKey?: string };
type Behaviour = { status: number; body?: unknown; delayMs?: number; hangUp?: boolean };

const seen: Seen[] = [];
const behaviour = new Map<string, Behaviour>();
let server: Server;
let configured = true;
let parked: string[] = [];

const tag = `drain-${Date.now().toString(36)}`;
const addr = (n: number | string) => `${tag}-${n}@example.test`;

function insert(to: string, over: Record<string, unknown> = {}) {
  return service().from("outbound_email").insert({
    to_address: to,
    subject: `Subject for ${to}`,
    text_body: "plain body",
    html_body: "<p>html body</p>",
    ...over,
  }).select("id").single();
}

const rowOf = async (to: string) => {
  const { data } = await service().from("outbound_email").select("*").eq("to_address", to).single();
  return data!;
};

function fake(req: IncomingMessage, res: ServerResponse) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw); } catch { /* leave empty */ }
    const to = String(Array.isArray(body.to) ? body.to[0] : body.to);
    seen.push({
      to,
      subject: String(body.subject),
      text: String(body.text),
      html: String(body.html),
      replyTo: (body.reply_to ?? body.replyTo) as string | undefined,
      idempotencyKey: req.headers["idempotency-key"] as string | undefined,
    });
    const b = behaviour.get(to) ?? { status: 200 };
    if (b.hangUp) { req.socket.destroy(); return; }
    setTimeout(() => {
      res.writeHead(b.status, { "content-type": "application/json" });
      res.end(JSON.stringify(b.body ?? (b.status < 300 ? { id: `fake-${seen.length}` } : { statusCode: b.status, message: `fake ${b.status}`, name: "fake_error" })));
    }, b.delayMs ?? 0);
  });
}

test.beforeAll(async ({ request }) => {
  // Park every unsent row that is not ours so a drain only touches this
  // file's rows, then put them back afterwards.
  const { data: others } = await service().from("outbound_email").select("id").is("sent_at", null);
  parked = (others ?? []).map((r) => r.id as string);
  if (parked.length) {
    await service().from("outbound_email").update({ next_attempt_at: new Date(Date.now() + 864e5).toISOString() }).in("id", parked);
  }
  server = createServer(fake);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); });

  const probe = await request.post("/api/cron/drain-email", { headers: AUTH });
  const text = await probe.text();
  if (probe.status() === 500 && /not configured/i.test(text)) configured = false;
});

test.afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await service().from("outbound_email").delete().like("to_address", `${tag}-%`);
  if (parked.length) await service().from("outbound_email").update({ next_attempt_at: new Date().toISOString() }).in("id", parked);
});

test.beforeEach(() => {
  test.skip(!configured, "drain-email is not configured with RESEND_* for the fake Resend (see file header)");
  seen.length = 0;
  behaviour.clear();
});

const drain = (request: import("@playwright/test").APIRequestContext) => request.post("/api/cron/drain-email", { headers: AUTH });

test("a pending row is sent once, with the row id as the idempotency key, and recorded", async ({ request }) => {
  const to = addr("ok");
  const { data } = await insert(to, { reply_to: "reply@example.test", subject: "Hello <b>there</b>", html_body: "<p>Hi &amp; welcome</p>" });
  const r = await drain(request);
  expect(r.status()).toBe(200);

  const mine = seen.filter((s) => s.to === to);
  expect(mine).toHaveLength(1);
  // The drain adds the company particulars to every message (lib/emailFooter.ts),
  // so the body sent is the queued body plus that footer, and nothing else.
  const sent = withCompanyFooter("plain body", "<p>Hi &amp; welcome</p>");
  expect(mine[0]).toMatchObject({ subject: "Hello <b>there</b>", text: sent.text, html: sent.html, replyTo: "reply@example.test", idempotencyKey: data!.id });

  const row = await rowOf(to);
  expect(row.sent_at).not.toBeNull();
  expect(row.provider_message_id).toMatch(/^fake-/);
  expect(row.last_error).toBeNull();
});

test("a sent row is never sent again, by a repeat drain or two concurrent drains", async ({ request }) => {
  const to = addr("once");
  await insert(to);
  const [a, b, c] = await Promise.all([drain(request), drain(request), drain(request)]);
  expect([a.status(), b.status(), c.status()]).toEqual([200, 200, 200]);
  await drain(request);
  expect(seen.filter((s) => s.to === to), "delivered more than once").toHaveLength(1);
  expect((await rowOf(to)).sent_at).not.toBeNull();
});

test("429 defers without burning an attempt, and is not retried straight away", async ({ request }) => {
  const to = addr("429");
  behaviour.set(to, { status: 429 });
  await insert(to);
  await drain(request);
  const row = await rowOf(to);
  expect(row.sent_at).toBeNull();
  expect(row.attempts).toBe(0);
  expect(row.last_error).toMatch(/429/);
  const minutes = (new Date(row.next_attempt_at).getTime() - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(25);
  expect(minutes).toBeLessThan(35);

  seen.length = 0;
  await drain(request);
  expect(seen.filter((s) => s.to === to), "a deferred row was retried immediately").toHaveLength(0);
});

test("a 5xx backs off exponentially and counts the attempt", async ({ request }) => {
  const to = addr("500");
  behaviour.set(to, { status: 503 });
  await insert(to);
  await drain(request);
  const row = await rowOf(to);
  expect(row.sent_at).toBeNull();
  expect(row.attempts).toBe(1);
  expect(row.last_error).toMatch(/503/);
  const minutes = (new Date(row.next_attempt_at).getTime() - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(1); // 2^1
  expect(minutes).toBeLessThan(3);
});

test("a permanent 4xx buries the row so it is never retried", async ({ request }) => {
  const to = addr("422");
  behaviour.set(to, { status: 422 });
  await insert(to);
  await drain(request);
  const row = await rowOf(to);
  expect(row.sent_at).toBeNull();
  expect(row.attempts).toBe(row.max_attempts);
  expect(row.last_error).toMatch(/422/);

  seen.length = 0;
  await service().from("outbound_email").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("to_address", to);
  await drain(request);
  expect(seen.filter((s) => s.to === to), "a buried row was claimed again").toHaveLength(0);
});

test("a dropped connection is transient: retried later, not lost", async ({ request }) => {
  const to = addr("drop");
  behaviour.set(to, { status: 200, hangUp: true });
  await insert(to);
  const r = await drain(request);
  expect(r.status()).toBe(200);
  const row = await rowOf(to);
  expect(row.sent_at).toBeNull();
  expect(row.attempts).toBe(1);
  expect(row.last_error).toBeTruthy();
});

test("a slow Resend cannot hold the batch hostage: the send times out and the row backs off", async ({ request }) => {
  test.setTimeout(60_000);
  const to = addr("slow");
  behaviour.set(to, { status: 200, delayMs: 20_000 });
  await insert(to);
  const t0 = Date.now();
  const r = await drain(request);
  expect(r.status()).toBe(200);
  expect(Date.now() - t0, "the route waited for the full 20s").toBeLessThan(19_000);
  const row = await rowOf(to);
  expect(row.sent_at).toBeNull();
  expect(row.attempts).toBe(1);
  expect(row.last_error).toMatch(/timed out/i);
});

test("one bad recipient does not stop the rest of the batch", async ({ request }) => {
  const rows = [addr("b-good1"), addr("b-bad"), addr("b-good2")];
  behaviour.set(rows[1]!, { status: 422 });
  for (const to of rows) await insert(to);
  const r = await drain(request);
  const body = await r.json();
  expect(body.drained).toBe(3);
  expect((await rowOf(rows[0]!)).sent_at).not.toBeNull();
  expect((await rowOf(rows[2]!)).sent_at).not.toBeNull();
  expect((await rowOf(rows[1]!)).sent_at).toBeNull();
});

test("a drain claims at most 20 rows, oldest first, and the rest wait for the next", async ({ request }) => {
  test.setTimeout(90_000);
  const all = Array.from({ length: 23 }, (_, i) => addr(`cap-${String(i).padStart(2, "0")}`));
  for (const to of all) await insert(to);
  const first = await (await drain(request)).json();
  expect(first.drained).toBe(20);
  expect(psql(`select count(*) from public.outbound_email where to_address like '${tag}-cap-%' and sent_at is null`)).toBe("3");
  const second = await (await drain(request)).json();
  expect(second.drained).toBe(3);
  expect(psql(`select count(*) from public.outbound_email where to_address like '${tag}-cap-%' and sent_at is null`)).toBe("0");
});
