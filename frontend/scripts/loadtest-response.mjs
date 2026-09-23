// Shared by k6 and Node's regression tests. A streamed Next.js redirect
// or render failure can still have status 200: HTTP status is not enough.
export function classifyPage(status, body, authenticated, requiredText = "") {
  const text = typeof body === "string" ? body : "";
  const redirected = (status >= 300 && status < 400) ||
    text.includes("NEXT_REDIRECT;") || text.includes('id="__next-page-redirect"');
  const renderError = /\$RX\(["']/.test(text) ||
    text.includes("Something went wrong") || text.includes("Application error:");
  const served = status === 200 && !redirected && !renderError &&
    /<h1[\s>]/.test(text) && (!requiredText || text.includes(requiredText));
  return { redirected, ok: authenticated ? served : served || redirected };
}
