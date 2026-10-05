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
  // D2: every member action establishes who is calling before it does
  // anything. Most do it through a file-local guard (community's
  // guardMember, say) rather than inline, so a helper counts when its own
  // body reaches one of the auth calls — worked out to a fixpoint. RLS and
  // the RPCs' auth.uid() checks still stand behind this; the point is that
  // no action hands an anonymous caller's request to the database at all.
  it("checks the session in every member action", () => {
    const AUTH = /\b(getActionAuth|currentUser|requireAdmin|requireApprovedUser)\(/;
    const decls = (text: string) => {
      const out = new Map<string, string>();
      for (const part of text.split(/\n(?=(?:export )?(?:async )?function \w|(?:export )?const \w+ = )/)) {
        const name = /^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+) = /.exec(part);
        if (name) out.set(name[1] ?? name[2], part);
      }
      return out;
    };
    const reaching = (text: string) => {
      const all = decls(text);
      const ok = new Set<string>();
      for (let changed = true; changed; ) {
        changed = false;
        for (const [name, body] of all) {
          if (ok.has(name)) continue;
          if (AUTH.test(body) || [...ok].some((h) => new RegExp(`\\b${h}\\(`).test(body))) {
            ok.add(name);
            changed = true;
          }
        }
      }
      return ok;
    };
    const unchecked: string[] = [];
    for (const [key, policy] of Object.entries(ACTION_POLICIES)) {
      if (policy.kind === "admin" || policy.kind === "public") continue;
      const [file, name] = key.split("#");
      const ok = reaching(readFileSync(join(SRC, file), "utf8"));
      const viaOk = policy.via && AUTH.test(readFileSync(join(SRC, policy.via), "utf8"));
      if (!ok.has(name) && !viaOk) unchecked.push(key);
    }
    expect(unchecked).toEqual([]);
  });
});
