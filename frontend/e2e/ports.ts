// Shared by playwright.config.ts and global-setup.ts so both agree on the
// same ports without duplicating the arithmetic.
export const PORT = Number(process.env.E2E_PORT ?? 3000);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

// gap 27: WebKit-engine projects (webkit, iphone — Playwright's iPhone
// preset runs on WebKit too) talk to the real server through
// hstsStripProxy.ts on this port instead of PORT directly. See that file
// for why it's https (and why the matching projects set
// ignoreHTTPSErrors: true in playwright.config.ts).
export const WEBKIT_PROXY_PORT = PORT + 1;
export const WEBKIT_PROXY_BASE_URL = `https://127.0.0.1:${WEBKIT_PROXY_PORT}`;
