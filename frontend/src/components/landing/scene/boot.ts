// How the landing page's scene starts and stops. This is the only scene module in the page's own bundle, and it is tiny: it decides the mode, waits for
// the page to paint and the browser to be idle, and only then loads the engine (three.js and everything that draws, a separate chunk). The server's HTML
// is the whole page, so nothing here is needed to read it or to follow a link.
//
// `data-mode` on the page wrapper tells the stylesheet which page it is: "live" (the scene) or "static" (reduced motion, or no WebGL: a painted poster per
// station). Before this runs there is no mode and the server's page is the live layout, compacted when motion is reduced or scripting is off.

/** Run `run` once the page has painted and the browser has a free moment (a slow main thread still gets it within a second). Returns the cancel. */
function whenIdle(run: () => void): () => void {
  let id = 0;
  let idle = false;
  if (typeof window.requestIdleCallback === "function") {
    idle = true;
    id = window.requestIdleCallback(run, { timeout: 1000 });
  } else id = window.setTimeout(run, 120);
  return () => (idle ? window.cancelIdleCallback(id) : window.clearTimeout(id));
}

/** Start the scene on `root` (the page wrapper). Returns what to call when the page goes: it releases everything, whatever stage the start had reached. */
export function bootScene(root: HTMLElement): () => void {
  const controller = new AbortController();
  root.dataset.mode = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "static" : "live";
  const cancel = whenIdle(() => {
    import("./engine")
      .then(({ startEngine }) => startEngine(root, { signal: controller.signal }))
      .catch((error: unknown) => {
        // a page that was left while the scene was starting is not an error; anything else is, and says so
        if (!controller.signal.aborted) console.error("The landing scene failed to start", error);
      });
  });
  return () => {
    controller.abort();
    cancel();
    delete root.dataset.mode;
  };
}
