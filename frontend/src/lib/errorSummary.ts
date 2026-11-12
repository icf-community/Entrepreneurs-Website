// B24: what a log line may say about an error. Raw error objects can carry
// request data (a CV's text in a parser error, a member's message in a
// queue error, a blob key in a storage error) into Vercel's logs, which
// are kept and searched outside our privacy controls. The full error still
// goes to Sentry, which scrubs and is a listed processor; the log gets the
// class and code only.
export function errorSummary(e: unknown): { name: string; code?: string } {
  if (e && typeof e === "object") {
    const name = e instanceof Error ? e.name : (e.constructor?.name ?? "object");
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" || typeof code === "number"
      ? { name, code: String(code).slice(0, 40) }
      : { name };
  }
  return { name: typeof e };
}
