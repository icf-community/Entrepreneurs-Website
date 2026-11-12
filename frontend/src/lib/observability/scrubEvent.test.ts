import { afterEach, describe, expect, it, vi } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubString, scrubUrl } from "./scrubEvent";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("scrubString", () => {
  const redacted: [string, string, RegExp][] = [
    ["an email", "duplicate key: Key (email)=(jane.doe+x@imperial.ac.uk) already exists", /jane\.doe/],
    ["an email in a Postgres DETAIL", 'DETAIL: Failing row contains (a1, "x@y.co").', /x@y\.co/],
    ["an upper-case email", "JANE@IMPERIAL.AC.UK failed", /JANE@/],
    ["a JWT", `fetch failed with ${JWT}`, /eyJhbGci/],
    ["a bearer token", "Authorization: Bearer abcdef0123456789abcdef", /abcdef0123456789/],
    ["a 40-char hex secret", "key=0123456789abcdef0123456789abcdef01234567", /0123456789abcdef0123456789abcdef/],
    ["a long base64-ish token", "token AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEf here", /AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/],
    ["a query string in a URL", "GET https://www.example.com/members?q=Jane%20Doe&email=a@b.co 500", /Jane|a@b\.co|q=/],
    ["a relative path with a query", "navigated to /members?q=Jane+Doe", /Jane|q=/],
  ];
  for (const [name, input, leak] of redacted) {
    it(`redacts ${name}`, () => {
      const out = scrubString(input);
      expect(out, out).not.toMatch(leak);
    });
  }

  it("leaves ordinary text alone", () => {
    for (const text of [
      "Connection request failed",
      "Is this ok? yes",
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "at /app/.next/server/chunks/ssr/page.js:12:34",
      "fb1c6b9e-5d2a-4a0e-9a3c-2f6d1e7c8b90", // a uuid is not a secret here
      "status 429, retry after 12s",
    ]) {
      expect(scrubString(text)).toBe(text);
    }
  });

  it("is safe on empty and very long input", () => {
    expect(scrubString("")).toBe("");
    // Past the length cap the tail is dropped, never leaked; inside it, emails are redacted.
    const long = "a ".repeat(200_000) + "x@y.co";
    const out = scrubString(long);
    expect(out).not.toContain("x@y.co");
    expect(out.length).toBeLessThan(20_100);
    expect(scrubString("a ".repeat(1_000) + "x@y.co")).toContain("[email]");
  });
});

describe("scrubString on hostile input", () => {
  // An event body can be arbitrarily large (an upstream HTML page in an error message, a blob in a
  // log line). A scrubber that is quadratic on it would stall the process inside Sentry's hook.
  const BIG = [
    ["one long run with no @", "a".repeat(300_000)],
    ["hyphenated run", "ab-".repeat(100_000)],
    ["repeated JWT prefix", "eyJ".repeat(100_000)],
    ["repeated local parts", "a@a".repeat(100_000)],
    ["query marks", "?a".repeat(150_000)],
  ] as const;
  for (const [name, input] of BIG) {
    it(`stays fast on ${name}`, () => {
      const t0 = performance.now();
      scrubString(input);
      expect(performance.now() - t0, `${name} took too long`).toBeLessThan(400);
    });
  }

  it("still redacts an email that sits at the length cap", () => {
    const out = scrubString("x".repeat(19_990) + "jane@imperial.ac.uk");
    expect(out).not.toMatch(/jane@|imperial\.ac/);
    expect(scrubString("x".repeat(30_000) + " jane@imperial.ac.uk")).not.toMatch(/jane@/);
  });

  it("redacts a very long token and bounded email shapes", () => {
    expect(scrubString("k=" + "A".repeat(5_000))).not.toMatch(/AAAAAAAAAAAAAAAA/);
    expect(scrubString("a.b.c.d.e@sub.domain.example.co.uk")).toBe("[email]");
  });
});

describe("scrubUrl", () => {
  it("drops the query and fragment", () => {
    expect(scrubUrl("https://www.example.com/members?q=Jane#top")).toBe("https://www.example.com/members");
    expect(scrubUrl("/connections?tab=pending&cursor=abc")).toBe("/connections");
    expect(scrubUrl("/home")).toBe("/home");
  });
});

describe("scrubEvent", () => {
  const event = () => ({
    message: "failed for jane@imperial.ac.uk",
    transaction: "/members?q=Jane",
    user: { id: "u1", email: "jane@imperial.ac.uk", ip_address: "1.2.3.4" },
    request: {
      url: "https://www.example.com/members?q=Jane%20Doe",
      query_string: "q=Jane%20Doe",
      cookies: { sb: "x" },
      data: { email: "jane@imperial.ac.uk" },
      env: { REMOTE_ADDR: "1.2.3.4" },
      headers: {
        cookie: "sb-access-token=" + JWT,
        authorization: `Bearer ${JWT}`,
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "Mozilla/5.0",
        referer: "https://www.example.com/members?q=Jane",
      },
    },
    exception: {
      values: [
        {
          type: "Error",
          value: "duplicate key value (email)=(jane@imperial.ac.uk)",
          stacktrace: { frames: [{ function: "f", vars: { email: "jane@imperial.ac.uk" } }] },
        },
      ],
    },
    breadcrumbs: [
      { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/profiles?email=eq.jane@imperial.ac.uk", status_code: 400 } },
      { category: "navigation", data: { from: "/members?q=Jane", to: "/connections?tab=pending" } },
      { category: "console", message: "profile for jane@imperial.ac.uk loaded", level: "log" },
    ],
    extra: { who: "jane@imperial.ac.uk", nested: { token: "abc", note: "see jane@imperial.ac.uk", list: ["a@b.co"] } },
    contexts: { custom: { email: "jane@imperial.ac.uk" } },
    tags: { surface: "contact", contact_email: "jane@imperial.ac.uk" },
    spans: [{ description: "GET /members?q=Jane", data: { "http.query": "q=Jane", url: "/x?y=1" } }],
  });

  it("leaves no email, JWT, query string or identifying field anywhere in the serialised event", () => {
    const out = JSON.stringify(scrubEvent(event()));
    expect(out).not.toMatch(/jane/i);
    expect(out).not.toMatch(/imperial\.ac\.uk/);
    expect(out).not.toMatch(/eyJhbGci/);
    expect(out).not.toMatch(/1\.2\.3\.4/);
    expect(out).not.toMatch(/q=Jane|tab=pending|cursor=/);
  });

  it("keeps what is useful for debugging", () => {
    const out = scrubEvent(event()) as ReturnType<typeof event>;
    expect(out.request.url).toBe("https://www.example.com/members");
    expect(out.request.headers["user-agent"]).toBe("Mozilla/5.0");
    expect(out.exception.values[0]!.type).toBe("Error");
    expect(out.tags.surface).toBe("contact");
    const crumbs = out.breadcrumbs as { data?: Record<string, unknown> }[];
    expect(crumbs[0]!.data!.status_code).toBe(400);
    expect(crumbs[0]!.data!.url).toBe("https://x.supabase.co/rest/v1/profiles");
    expect(out.transaction).toBe("/members");
    expect("user" in out).toBe(false);
    expect("query_string" in out.request).toBe(false);
    expect("vars" in out.exception.values[0]!.stacktrace.frames[0]!).toBe(false);
  });

  it("redacts values under credential-like keys even when they look harmless", () => {
    const out = scrubEvent({ extra: { password: "hunter2", apiKey: "k", session: "s", n: 3 } }) as { extra: Record<string, unknown> };
    expect(out.extra).toEqual({ password: "[redacted]", apiKey: "[redacted]", session: "[redacted]", n: 3 });
  });

  it("accepts the breadcrumb shape that wraps values, and sparse events", () => {
    const wrapped = scrubEvent({ breadcrumbs: { values: [{ message: "a@b.co" }] } }) as { breadcrumbs: { values: { message: string }[] } };
    expect(wrapped.breadcrumbs.values[0]!.message).toBe("[email]");
    expect(() => scrubEvent({})).not.toThrow();
    expect(() => scrubEvent({ exception: {}, request: null, breadcrumbs: null, extra: null } as object)).not.toThrow();
  });

  it("survives cyclic and deeply nested data and non-string values", () => {
    const cyc: Record<string, unknown> = { name: "a@b.co" };
    cyc.self = cyc;
    let deep: Record<string, unknown> = { leaf: "a@b.co" };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    const out = scrubEvent({ extra: { cyc, deep, n: null, b: true, d: new Date(0), u: undefined } });
    expect(JSON.stringify(out)).not.toMatch(/a@b\.co/);
  });

  it("scrubs a transaction event's spans", () => {
    const out = JSON.stringify(scrubEvent({ type: "transaction", transaction: "/members?q=x", spans: [{ description: "GET /a?b=c" }] }));
    expect(out).not.toMatch(/q=x|b=c/);
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs the message and strips URL queries", () => {
    const b = scrubBreadcrumb({ category: "xhr", message: "x@y.co", data: { url: "/api/a?id=1", status: 200 } });
    expect(b.message).toBe("[email]");
    expect(b.data.url).toBe("/api/a");
    expect(b.data.status).toBe(200);
  });
});

// All three runtimes must carry the same hooks. Each config is imported with a
// DSN set and @sentry/nextjs mocked, and the options passed to init() are read back.
describe("every Sentry runtime is wired to the scrubber", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const configs = {
    "sentry.server.config": () => import("../../../sentry.server.config"),
    "sentry.edge.config": () => import("../../../sentry.edge.config"),
    "instrumentation-client": () => import("../../../instrumentation-client"),
  } as const;

  for (const [file, load] of Object.entries(configs)) {
    it(`${file} sets sendDefaultPii false and all three hooks`, async () => {
      vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o1.ingest.de.sentry.io/1");
      const init = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({ init, captureRouterTransitionStart: vi.fn() }));
      vi.resetModules();
      await load();
      // The config imports its own copy of the scrubber; read the same copy back.
      const scrub = await import("./scrubEvent");
      expect(init).toHaveBeenCalledTimes(1);
      const opts = init.mock.calls[0]![0] as Record<string, unknown>;
      expect(opts.sendDefaultPii).toBe(false);
      expect(opts.beforeSend).toBe(scrub.scrubEvent);
      expect(opts.beforeSendTransaction).toBe(scrub.scrubEvent);
      expect(opts.beforeBreadcrumb).toBe(scrub.scrubBreadcrumb);
      vi.doUnmock("@sentry/nextjs");
    });
  }
});
