import { stopHstsStripProxyIfRunning } from "./hstsStripProxy";

// gap 27: stops the webkit/iphone HTTPS proxy global-setup.ts starts when
// E2E_ALL_BROWSERS=1 — otherwise it leaks as an orphaned process on every
// local run, since nothing else ever calls its stop closure.
export default function globalTeardown(): void {
  stopHstsStripProxyIfRunning();
}
