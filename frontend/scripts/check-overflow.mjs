// Horizontal-overflow sweep across the app's routes at a given viewport width.
//
// Usage (from frontend/, against a running `pnpm dev` / `pnpm start`):
//   node scripts/check-overflow.mjs
//   W=768 node scripts/check-overflow.mjs
//
// Needs e2e/.auth/{student,admin}.json storageState files, which `pnpm e2e`
// produces via global-setup. Run the E2E suite at least once first if those
// are missing.
import { chromium } from "@playwright/test";

// 127.0.0.1, NOT localhost: the storageState cookies are written against
// Playwright's baseURL (127.0.0.1) and cookies are keyed by host, so browsing
// localhost sends nothing and every gated route silently measures /login.
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const WIDTH = Number(process.env.W ?? 390);

const ROUTES = {
  student: ["/", "/login", "/contact", "/privacy", "/terms", "/cookies",
            "/home", "/members", "/events", "/opportunities", "/vcs",
            "/community", "/profile", "/settings", "/my-submissions",
            "/my-bookmarks", "/my-activity", "/committee"],
  admin: ["/admin"],
};

const browser = await chromium.launch();
let bad = 0;

for (const [role, routes] of Object.entries(ROUTES)) {
  const ctx = await browser.newContext({
    storageState: `e2e/.auth/${role}.json`,
    viewport: { width: WIDTH, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  for (const route of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45_000 });
    } catch {
      // Turbopack compiles on first hit; networkidle can time out on a cold route.
      await page.waitForTimeout(1500);
    }
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const over = de.scrollWidth - de.clientWidth;
      if (over <= 0) return { over: 0, url: location.pathname, culprits: [] };
      // Name what actually sticks out, not just that something does.
      const culprits = [...document.querySelectorAll("*")]
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { right: Math.round(b.right), w: Math.round(b.width), el };
        })
        .filter((c) => c.right > de.clientWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 4)
        .map((c) => `${c.el.tagName.toLowerCase()}${c.el.id ? "#" + c.el.id : ""}.${(c.el.className || "").toString().split(" ").slice(0, 3).join(".")} right=${c.right} w=${c.w}`);
      return { over, url: location.pathname, culprits };
    });
    if (r.over > 0) {
      bad++;
      console.log(`OVERFLOW ${r.over}px  ${route}  (landed ${r.url})`);
      for (const c of r.culprits) console.log(`    ${c}`);
    } else {
      console.log(`ok            ${route}  (landed ${r.url})`);
    }
  }
  await ctx.close();
}

console.log(bad === 0 ? `\nNo horizontal overflow at ${WIDTH}px.` : `\n${bad} route(s) overflow at ${WIDTH}px.`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
