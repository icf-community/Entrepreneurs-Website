// Shared Sentry scrubber for all three runtimes (server, edge, client), wired
// as beforeSend / beforeSendTransaction / beforeBreadcrumb so personal data
// never leaves the process. Kept in one place so they can't drift, the same
// way tracesSampler is.
//
// Sentry's own default (sendDefaultPii: false) already drops the user's IP,
// cookies and request body. What it does NOT touch is free text this app and
// its dependencies put in events: a Postgres error carries the offending value
// (`Key (email)=(x@y.com) already exists`), request and navigation URLs carry
// query strings (`/members?q=Jane Doe`), console breadcrumbs carry whatever
// was logged. This redacts those. Anything that must leave on purpose
// (a route, a status code, a tag) is not in these shapes and passes through.
//
// Redacted: email addresses, JWTs, bearer tokens, long hex and base64-ish
// secrets, query strings (all of them: no allow-list, nothing here needs one),
// and the values under keys that name a credential or a person.

const MAX_DEPTH = 8;

// Every pattern here is bounded or anchored so it runs in linear time, and strings are capped
// before any pattern touches them. An event body can be arbitrarily large (an upstream HTML page in
// an error message, a blob in a log line); an unbounded `[...]+@` is quadratic on a long run that
// has no "@" (300,000 characters took 99 seconds), which would freeze the process inside Sentry's
// hook. Lookbehind is avoided on purpose: this file ships in the browser bundle.
const MAX_STRING = 20_000;

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
const JWT = /eyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{0,4096}/g;
const BEARER = /\bBearer\s{1,8}[A-Za-z0-9._~+/=-]{8,2048}/gi;
const HEX_SECRET = /\b[A-Fa-f0-9]{32,}\b/g;
// A run of 40+ token characters that starts at the beginning or after a non-token character
// (the leading group replaces a lookbehind), so each run is scanned once.
const LONG_TOKEN = /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{40,}/g;
// ?key=value... only (so a sentence ending in "?" is left alone).
const QUERY = /\?[\w%.~+-]{1,256}=[^\s"'<>#]*/g;

const SENSITIVE_KEY = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|email|phone|session|otp|code$/i;

/** Cap a string before scanning it. A cut can leave half an email at the end, so drop that tail. */
function cap(text: string): string {
  if (text.length <= MAX_STRING) return text;
  return text.slice(0, MAX_STRING).replace(/[A-Za-z0-9._%+@-]{1,320}$/, "") + "…[truncated]";
}

/** Redact the personal and secret shapes inside one string. */
export function scrubString(text: string): string {
  return cap(text)
    .replace(JWT, "[jwt]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(EMAIL, "[email]")
    .replace(QUERY, "?[query]")
    .replace(HEX_SECRET, "[hex]")
    .replace(LONG_TOKEN, "$1[token]");
}

/** A URL without its query string or fragment, then scrubbed. */
export function scrubUrl(url: string): string {
  return scrubString(url.split("#")[0]!.split("?")[0]!);
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>, key?: string): unknown {
  if (typeof value === "string") return key && SENSITIVE_KEY.test(key) ? "[redacted]" : scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubValue(v, depth + 1, seen, k);
  }
  return out;
}

const URL_FIELDS = new Set(["url", "to", "from", "http.url", "http.query", "url.full"]);

function scrubUrlFields(data: Record<string, unknown>): void {
  for (const field of URL_FIELDS) {
    const v = data[field];
    if (typeof v === "string") data[field] = scrubUrl(v);
  }
  // Query strings travelling as their own field.
  for (const field of ["query", "query_string", "http.query", "search"]) delete data[field];
}

type AnyRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** beforeBreadcrumb: scrub one breadcrumb. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  const b = breadcrumb as AnyRecord;
  if (typeof b.message === "string") b.message = scrubString(b.message);
  if (b.data && typeof b.data === "object") {
    const data = scrubValue(b.data, 0, new WeakSet()) as Record<string, unknown>;
    // scrubValue already ran over the strings; URLs additionally lose the query.
    const raw = b.data as Record<string, unknown>;
    for (const field of URL_FIELDS) if (typeof raw[field] === "string") data[field] = raw[field];
    scrubUrlFields(data);
    b.data = data;
  }
  return breadcrumb;
}

/** beforeSend and beforeSendTransaction: scrub one event, in place, and return it. */
export function scrubEvent<T extends object>(event: T): T {
  const e = event as AnyRecord;

  if (typeof e.message === "string") e.message = scrubString(e.message);
  if (typeof e.transaction === "string") e.transaction = scrubUrl(e.transaction);

  // We never call setUser; make sure nothing identifying rides along.
  delete e.user;

  const request = e.request as AnyRecord | undefined;
  if (request && typeof request === "object") {
    if (typeof request.url === "string") request.url = scrubUrl(request.url);
    for (const field of ["data", "cookies", "query_string", "env"]) delete request[field];
    if (request.headers && typeof request.headers === "object") {
      const headers: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(request.headers as Record<string, unknown>)) {
        if (/^(authorization|cookie|set-cookie|x-forwarded-for|x-real-ip|cf-connecting-ip|x-service-token)$/i.test(k)) continue;
        headers[k] = typeof v === "string" ? scrubString(v) : v;
      }
      request.headers = headers;
    }
  }

  for (const exc of (e.exception?.values as AnyRecord[] | undefined) ?? []) {
    if (typeof exc.value === "string") exc.value = scrubString(exc.value);
    // Local variables captured with a frame can hold anything.
    for (const frame of (exc.stacktrace?.frames as AnyRecord[] | undefined) ?? []) delete frame.vars;
  }

  const crumbs = Array.isArray(e.breadcrumbs) ? e.breadcrumbs : e.breadcrumbs?.values;
  if (Array.isArray(crumbs)) for (const c of crumbs) scrubBreadcrumb(c);

  for (const field of ["extra", "contexts", "tags"]) {
    if (e[field] && typeof e[field] === "object") e[field] = scrubValue(e[field], 0, new WeakSet());
  }

  // Performance spans carry URLs and SQL-ish descriptions.
  for (const span of (e.spans as AnyRecord[] | undefined) ?? []) {
    if (typeof span.description === "string") span.description = scrubUrl(span.description);
    if (span.data && typeof span.data === "object") {
      span.data = scrubValue(span.data, 0, new WeakSet());
      scrubUrlFields(span.data);
    }
  }

  return event;
}
