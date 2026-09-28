// A server action called from the browser can reject rather than return an
// error result: the network drops, the deploy changes under an open tab, or
// the action throws. Code that did `setBusy(true); await action();
// setBusy(false)` then never reached the last line, and the button spun
// forever (B5). settle() turns a rejection into the same `{ ok: false }`
// shape every action already returns, so one error path handles both.

export const NETWORK_ERROR = "Couldn't reach the server. Please try again.";

export async function settle<T extends { ok: boolean }>(
  call: Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await call;
  } catch (e) {
    console.error("Action failed:", e);
    return { ok: false, error: NETWORK_ERROR };
  }
}
