import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Product analytics must carry no personal data (the privacy policy says so).
// Every property key passed to track() is on an allow-list of enums, counts,
// booleans and opaque ids. Adding a key fails this test on purpose: decide
// whether it can identify a person or carry free text, then add it here with
// a reason. Free text (notes, queries, names, emails, reasons) never belongs.
const ALLOWED: Record<string, string> = {
  mode: "AI search mode enum",
  kind: "listing / refusal kind enum",
  stage: "AI refusal stage enum",
  status: "AI turn status enum",
  results: "none | few | many bucket",
  id: "opaque listing uuid",
  userId: "opaque member uuid (admin approve / reject)",
  severity: "banner severity enum",
  role: "student | alum",
  consent: "boolean",
  with_note: "boolean: whether a note existed, never its text",
  imageCount: "integer",
};

const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("track() properties", () => {
  const calls: { file: string; event: string; keys: string[] }[] = [];
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\btrack\(\s*(["'`])([^"'`]+)\1\s*,\s*\{([^}]*)\}/g)) {
      const keys = m[3]!
        .split(",")
        .map((s) => s.trim().split(/\s*:/)[0]!.trim())
        .filter(Boolean);
      calls.push({ file: file.replace(SRC, "src"), event: m[2]!, keys });
    }
  }

  it("finds the call sites (positive control: a broken scanner would pass vacuously)", () => {
    expect(calls.length).toBeGreaterThan(15);
  });

  it("only sends allow-listed, non-identifying property keys", () => {
    const bad = calls.flatMap((c) => c.keys.filter((k) => !(k in ALLOWED)).map((k) => `${c.file}: ${c.event}.${k}`));
    expect(bad, `new analytics property needs a PII review:\n${bad.join("\n")}`).toEqual([]);
  });
});
