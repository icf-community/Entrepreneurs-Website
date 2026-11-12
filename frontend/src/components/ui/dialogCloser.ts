/**
 * Closes the nearest enclosing <dialog>. Use this for a panel's own close
 * button rather than calling the parent's onClose directly: going through
 * the element means the browser closes it, which is what restores focus
 * to whatever opened it.
 */
export function closeDialog(e: { currentTarget: HTMLElement }) {
  e.currentTarget.closest("dialog")?.close();
}

/**
 * The same thing, for a handler that has work to do BEFORE it closes.
 *
 * `closeDialog(e)` reads `e.currentTarget`, and React clears that the
 * moment the event finishes dispatching — so in an async handler it is
 * already null by the time an `await` resolves, and the call closes
 * nothing (it throws on the null, inside a click handler, where nothing
 * surfaces it). The dialog then sits open over a completed action.
 *
 * Call this synchronously at the top of the handler and invoke the
 * returned function whenever you are done:
 *
 *   async function submit(e) {
 *     const close = dialogCloser(e);
 *     const res = await action();
 *     if (!res.ok) { setError(res.error); return; }
 *     close();
 *   }
 */
export function dialogCloser(e: { currentTarget: HTMLElement }): () => void {
  const el = e.currentTarget.closest("dialog");
  return () => el?.close();
}
