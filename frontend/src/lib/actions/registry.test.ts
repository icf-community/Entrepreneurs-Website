import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ACTION_POLICIES } from "./registry";

// B23: every exported server action is classified in registry.ts, and the
// classification is checked against the code rather than trusted.

const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** `path#name` → that function's source, for every "use server" export. */
function exportedActions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of files(SRC)) {
    const text = readFileSync(path, "utf8");
    if (!text.trimStart().startsWith('"use server"')) continue;
    const rel = relative(SRC, path);
    const parts = text.split(/\n(?=export (?:async )?function )/);
    for (const part of parts.slice(1)) {
      const name = /export (?:async )?function (\w+)/.exec(part)?.[1];
      if (name) out.set(`${rel}#${name}`, part);
    }
  }
  return out;
}

describe("server-action policy registry", () => {
  const actions = exportedActions();

  it("classifies every exported server action", () => {
    const missing = [...actions.keys()].filter((k) => !(k in ACTION_POLICIES));
    expect(missing).toEqual([]);
  });

  it("has no entries for actions that no longer exist", () => {
    const stale = Object.keys(ACTION_POLICIES).filter((k) => !actions.has(k));
    expect(stale).toEqual([]);
  });

  it("only names a bucket the code actually calls", () => {
    const wrong: string[] = [];
    for (const [key, policy] of Object.entries(ACTION_POLICIES)) {
      if (!policy.bucket) continue;
      const source = policy.via ? readFileSync(join(SRC, policy.via), "utf8") : actions.get(key) ?? "";
      if (!source.includes(`"${policy.bucket}"`)) wrong.push(`${key} → ${policy.bucket}`);
    }
    expect(wrong).toEqual([]);
  });

  it("gives every costly write and every bucketed public action a bucket", () => {
    const unguarded = Object.entries(ACTION_POLICIES)
      .filter(([, p]) => p.kind === "write-costly" && !p.bucket)
      .map(([k]) => k);
    expect(unguarded).toEqual([]);
  });

  it("puts admin actions behind requireAdmin", () => {
    const open: string[] = [];
    for (const [key, policy] of Object.entries(ACTION_POLICIES)) {
      if (policy.kind !== "admin") continue;
      // The check lives in the action, or in the shared helper it
      // delegates to (`via`).
      const source = policy.via ? readFileSync(join(SRC, policy.via), "utf8") : actions.get(key) ?? "";
      if (!/requireAdmin\(|if \(!isAdmin\) return err/.test(source)) open.push(key);
    }
    expect(open).toEqual([]);
  });
});
