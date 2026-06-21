/**
 * fetch_trait_table.mjs — pull the AUTHORITATIVE trait code -> name table from the
 * official ER API (uses ER_API_KEY from .env), so we can verify what each core code
 * really is. Saves data/trait-table.txt and prints the codes we care about.
 *
 *   node tools/fetch_trait_table.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = requireEnv("ER_API_KEY");
const BASE = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";

const endpoints = [
  "/v2/data/Trait", "/v1/data/Trait",
  "/v1/data/TraitCombat", "/v1/data/TraitSupport",
];

function* walk(o) {
  if (o && typeof o === "object") {
    if (Array.isArray(o)) { for (const x of o) yield* walk(x); }
    else { yield o; for (const v of Object.values(o)) yield* walk(v); }
  }
}

const pairs = new Map();
for (const ep of endpoints) {
  try {
    const res = await fetch(BASE + ep, { headers: { "x-api-key": KEY } });
    if (!res.ok) { console.log(ep, "->", res.status); continue; }
    const data = await res.json();
    let n = 0;
    for (const row of walk(data)) {
      const code = row.code ?? row.traitCode ?? row.id;
      const name = row.name ?? row.nameKr ?? row.nameKo ?? row.korName;
      if (code != null && name) { pairs.set(String(code), name); n++; }
    }
    console.log(ep, "-> ok,", n, "rows");
  } catch (e) { console.log(ep, "-> err", e.message); }
}

const lines = [...pairs.entries()].sort();
fs.writeFileSync(path.join(ROOT, "data", "trait-table.txt"), lines.map(([c, n]) => `${c}=${n}`).join("\n"));
console.log("\nTotal traits:", pairs.size, "(saved to data/trait-table.txt)");
console.log("=".repeat(50));
for (const c of ["7100501", "7300301", "7000501", "7000401", "7200301", "7200501", "7100101", "7000201"]) {
  console.log(c, "=", pairs.get(c) ?? "(NOT FOUND)");
}
