import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// B10/B24: pins the log lines fixed in the launch programme. Server logs
// (Vercel) sit outside our privacy controls, so a console line must never
// carry a blob key, a GitHub profile body or a raw error from a path that
// handles member content. Anything flagged here should log errorSummary(e)
// or named fields instead.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const SRC = join(__dirname, "..");
const LOG = /console\.(error|warn|log|info)\(([^;]*)\);/g;

describe("log hygiene", () => {
  const all = files(SRC).map((p) => [p, readFileSync(p, "utf8")] as const);

  it("never logs a blob key or a raw GitHub profile body", () => {
    const hits: string[] = [];
    for (const [p, text] of all) {
      for (const m of text.matchAll(LOG)) {
        const args = m[2];
        if (/\bblobKey\b|\bblob_key\b|\bcvPath\b|\bavatarPath\b|\bbody:\s*ghUser\b/.test(args)) {
          hits.push(`${p}: ${m[0].slice(0, 120)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("logs only a summary of errors on paths that handle member content", () => {
    const guarded = ["lib/storage/blobRead.ts", "lib/cv/extractText.ts", "app/contact/actions.ts"];
    const hits: string[] = [];
    for (const [p, text] of all) {
      if (!guarded.some((g) => p.endsWith(g))) continue;
      for (const m of text.matchAll(LOG)) {
        // A trailing bare `e` / `err` / `error` argument is a raw error object.
        if (/,\s*(e|err|error)\s*$/.test(m[2].trim())) hits.push(`${p}: ${m[0].slice(0, 120)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
