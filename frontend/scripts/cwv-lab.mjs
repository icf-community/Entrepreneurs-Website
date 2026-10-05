// Local lab Web Vitals (D1): Moto-G-class emulation — 4x CPU slowdown,
// slow 4G (150 ms RTT, 1.6 Mbps down, 750 kbps up), 412x823 viewport,
// against a perf-serve.sh build on :3100. Lighthouse's simulated
// throttling is unreliable on localhost and its headless runs failed with
// NO_FCP here, so this applies the throttling through CDP instead.
// TBT is the load-time stand-in for INP; LCP's element is printed so a
// late LCP can be traced (a hydration mismatch re-renders the page).
//
// usage: node scripts/cwv-lab.mjs <path> [cookie]
//   cookie: a "name=value" from scripts/.loadtest-sessions.json
import { chromium, devices } from "@playwright/test";
const [, , path, cookie] = process.argv;
const base = "http://127.0.0.1:3100";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Moto G4"], viewport: { width: 412, height: 823 } });
if (cookie) {
  const [name, ...rest] = cookie.split("=");
  await ctx.addCookies([{ name, value: rest.join("="), url: base }]);
}
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.addInitScript(() => {
  window.__cwv = { lcp: 0, fcp: 0, tbt: 0, cls: 0, longest: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__cwv.lcp = e.startTime; window.__cwv.el = (e.element?.tagName ?? "") + "." + String(e.element?.className ?? "").slice(0, 60) + " " + (e.element?.textContent ?? "").slice(0, 40); } }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__cwv.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__cwv.tbt += Math.max(0, e.duration - 50); window.__cwv.longest = Math.max(window.__cwv.longest, e.duration); } }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cwv.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
});
const t0 = Date.now();
const res = await page.goto(base + path, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(3000); // let late long tasks and LCP settle
const v = await page.evaluate(() => window.__cwv);
const bytes = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script").reduce((a, r) => a + (r.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0));
console.log(`${path.padEnd(16)} ${res.status()} → ${new URL(page.url()).pathname.padEnd(15)} FCP ${Math.round(v.fcp)} ms  LCP ${Math.round(v.lcp)} ms  TBT~ ${Math.round(v.tbt)} ms (longest ${Math.round(v.longest)})  CLS ${v.cls.toFixed(3)} el=[${v.el}]  JS+HTML ${Math.round(bytes / 1024)} KB  wall ${Date.now() - t0} ms`);
await browser.close();
