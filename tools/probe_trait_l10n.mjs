/**
 * probe_trait_l10n.mjs — figure out how trait names are stored in the ER API.
 *
 * /v1/data/Trait gives codes (no names). Names live in the localization (l10n) file.
 * This prints the data/Trait row shape and finds how known trait names/codes are
 * keyed in the Korean l10n file, so we can build a real code -> name map.
 *
 *   node tools/probe_trait_l10n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = requireEnv("ER_API_KEY");
const BASE = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";

async function api(ep) {
  const r = await fetch(BASE + ep, { headers: { "x-api-key": KEY } });
  return { status: r.status, text: await r.text() };
}

// 1) Structure of data/Trait
const d = await api("/v1/data/Trait");
console.log("data/Trait status:", d.status);
try {
  const j = JSON.parse(d.text);
  const rows = j.data || j.Trait || [];
  console.log("data/Trait rows:", rows.length);
  if (rows[0]) {
    console.log("first row keys:", Object.keys(rows[0]).join(", "));
    console.log("first row:", JSON.stringify(rows[0]).slice(0, 300));
  }
} catch (e) { console.log("data/Trait parse err:", e.message, "| body:", d.text.slice(0, 150)); }

// 2) Korean l10n file
console.log("\n--- l10n ---");
const l = await api("/v1/l10n/Korean");
console.log("l10n status:", l.status);
let url;
try {
  const parsed = JSON.parse(l.text);
  // ER API envelope: { code, message, data: { l10Path: "https://..." } }
  const inner = parsed?.data ?? parsed;
  url = inner?.l10Path ?? inner?.url ?? (typeof inner === "string" ? inner : undefined);
  console.log("l10n file url:", url);
} catch (e) { console.log("l10n parse err:", e.message, "| body:", l.text.slice(0, 150)); }

if (url) {
  const txt = await (await fetch(url)).text();
  fs.writeFileSync(path.join(ROOT, "data", "l10n-ko.txt"), txt);
  console.log("l10n saved (", txt.length, "chars) -> data/l10n-ko.txt");
  const lineList = txt.split(/\r?\n/);
  for (const needle of ["와류", "7300301", "흡혈마", "7100501", "치유 드론", "7200301"]) {
    const hits = lineList.filter((ln) => ln.includes(needle)).slice(0, 3);
    console.log(`\n[contains "${needle}"]`);
    console.log(hits.length ? hits.join("\n") : "  (none)");
  }
}
