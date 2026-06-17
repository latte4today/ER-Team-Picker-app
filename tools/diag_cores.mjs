/**
 * diag_cores.mjs — print each core CODE with the characters that use it most,
 * from the CURRENT local src/officialMatchStats.json (authoritative on your PC).
 *
 * Use it to verify code -> trait name: look at the top character for each code,
 * check what that character actually runs, and tell which trait the code is.
 *
 *   node tools/diag_cores.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const j = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "officialMatchStats.json"), "utf8"));
const all = j.officialTraitBuildStatsByTier?.all || {};

const byCode = {};
for (const [variant, rows] of Object.entries(all)) {
  for (const r of rows) {
    if (r.core == null) continue;
    (byCode[r.core] ??= { name: r.name, users: [] }).users.push([variant, r.games || 0]);
  }
}

const lines = [];
for (const [code, d] of Object.entries(byCode)) {
  const tot = d.users.reduce((s, [, g]) => s + g, 0);
  const top = d.users.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, g]) => `${v}(${g})`).join(", ");
  lines.push([tot, `${code} | build이름='${d.name}' | 총${tot}g | 최다: ${top}`]);
}
lines.sort((a, b) => b[0] - a[0]);

console.log("generatedAt:", j.source?.generatedAt, "| teams:", j.source?.totalTeams, "| codes:", lines.length);
console.log("=".repeat(70));
console.log(lines.map((l) => l[1]).join("\n"));
