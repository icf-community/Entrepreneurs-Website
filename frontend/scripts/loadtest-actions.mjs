// ════════════════════════════════════════════════════════════════════
// Foundry · Server-action ids for the k6 write mix (E1b)
//
//   node scripts/loadtest-actions.mjs     # after `pnpm build`
//
// A server action is a POST carrying a `Next-Action` id that is minted per
// build, so k6 can't hard-code it. This reads the build's own manifest and
// writes `scripts/.loadtest-actions.json` ({ "file#export": id }). Re-run
// after every build; loadtest.js refuses to start without it when writes
// are on. Local only: the ids are no secret, but the file is build output.
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "../.next/server/server-reference-manifest.json"), "utf8"));

const ids = {};
for (const [id, entry] of Object.entries(manifest.node)) {
  ids[`${entry.filename.replace(/^src\//, "")}#${entry.exportedName}`] = id;
}
writeFileSync(resolve(here, ".loadtest-actions.json"), `${JSON.stringify(ids, null, 2)}\n`);
console.log(`wrote ${Object.keys(ids).length} action ids to scripts/.loadtest-actions.json`);
