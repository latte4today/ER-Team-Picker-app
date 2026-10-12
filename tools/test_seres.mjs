import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.document = { documentElement: { lang: "ko", dataset: {} } };

const { characters, characterVariants } = await import("../src/data.js");
const { characterMetric } = await import("../src/characterMetrics.js");
const { combatStyle } = await import("../src/combatProfiles.js");
const { matchesKoreanSearch } = await import("../src/koreanSearch.js");
const { t, setLanguage } = await import("../src/i18n/index.js");
const { recommend, evaluateCandidate, debugCoreRoleProfile, characterVector } = await import("../src/recommender.js");
const { characterIdForCode } = await import("./character_code_map.mjs");

const id = "seres:two_handed_sword";
const seres = characterVariants.find((v) => v.variantId === id);
assert.ok(seres, "Seres must be selectable with her supported weapon");
assert.equal(characters.filter((c) => c.id === "seres").length, 1);
assert.equal(characterVariants.filter((c) => c.characterId === "seres").length, 1);
assert.equal(seres.role, "frontline", "factory must not downgrade the tank to bruiser");
assert.equal(seres.damage, "skill");
assert.equal(combatStyle(seres), "guardSometimesEngage");
assert.equal(seres.ccProfile.targeted, 0, "ally E is not targeted enemy CC");
assert.equal(seres.ccProfile.nonTarget, 2, "Q2 and W; do not double-count W's slow");
for (const tag of ["peel", "shield", "utility", "cc", "durable", "mobility", "initiate"]) assert.ok(seres.tags.includes(tag), tag);
assert.ok(!seres.tags.includes("healing"), "E heals Seres, not her ally");
assert.ok(!seres.tags.includes("speedBoost"), "E's speed boost is self-only");
assert.equal(seres.roleProfile.initiate, 2);
assert.equal(characterMetric(seres).utility, 5);
assert.equal(characterMetric(seres).damage, 2);
for (const q of ["세레스", "세레", "ㅅㄹㅅ"]) assert.ok(matchesKoreanSearch(seres.name, q));
assert.equal(characterIdForCode(91), "seres");
assert.equal(characterIdForCode("91"), "seres");
assert.equal(characterIdForCode(99999), null, "unknown codes must stay unknown");
const png = await fs.readFile(path.join(root, seres.image));
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);

const names = { ko: "세레스", en: "Seres", ja: "セレス", zhHans: "塞莉丝", zhHant: "塞莉絲" };
const tiers = ["all", "iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"];
for (const [lang, name] of Object.entries(names)) {
  setLanguage(lang);
  assert.equal(t("char.seres"), name);
  assert.notEqual(t("union.plan.shieldGuardBackline"), "union.plan.shieldGuardBackline");
  assert.equal(t("weapon.two_handed_sword").includes("weapon."), false);
  for (const tier of tiers) {
    const picks = ["lucia:sniper_rifle", "rio:bow"];
    const rows = recommend(picks, tier, {}, [id]);
    assert.ok(rows.length > 0, `${lang}/${tier}: eligible Seres disappears from playable pool`);
    assert.ok(rows.every((row) => row.character.variantId === id && Number.isFinite(row.total)));
    assert.ok(rows[0].reasons.every((s) => !s.includes("recommender.")), "untranslated explanations");
    const byCharacter = recommend(picks, tier, {}, ["seres"]);
    assert.ok(byCharacter.some((row) => row.character.variantId === id));
    assert.equal(recommend([id], tier, {}, [id]).length, 0, "no duplicate teammate");
    const withCore = evaluateCandidate(picks, id, tier, {}, [], { [id]: "7100101" });
    assert.ok(Number.isFinite(withCore.total), "explicit core on data-sparse character must score");
    const defaultProfile = debugCoreRoleProfile([id], {}, tier).characters[0];
    assert.equal(defaultProfile.role, "frontline");
    const vec = characterVector(seres, null, tier);
    assert.ok(vec.peel > 0.4 && vec.support > 0.4, "protection must contribute to scores");
  }
}
setLanguage("ko");

// Exercise the actual union worker message boundary, not a copied scoring formula.
let response;
globalThis.self = { postMessage: (value) => { response = value; } };
await import("../src/unionWorker.js");
self.onmessage({ data: {
  requestId: "seres-regression", contextKey: "seres-regression", tier: "all",
  rosters: [[id], ["lucia:sniper_rifle"], ["rio:bow", id]],
} });
assert.ok(!response.error, response.error);
assert.equal(response.combos.length, 1, "union must exclude duplicate Seres");
assert.deepEqual(response.combos[0].comboIds, [id, "lucia:sniper_rifle", "rio:bow"]);
assert.ok(Number.isFinite(response.combos[0].score));
delete globalThis.self;

// Synthetic teams validate mapping without fabricating live match statistics.
const scratch = await fs.mkdtemp(path.join(root, "../../seres-regression-"));
const run = (script, args) => {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
};
try {
  const input = path.join(scratch, "input.json");
  const teams = [1, 2].map((n) => ({
    gameId: n, teamKey: `fixture-${n}`, matchingMode: 3, seasonId: 41, rank: n,
    tierBucket: "iron_gold", players: [
      { character: 91, weapon: 9001 },
      { character: 90, weapon: 9002 },
      { character: 31, weapon: 9003 },
    ],
  }));
  await fs.writeFile(input, JSON.stringify({ teams }));
  const jsonOut = path.join(scratch, "stats.json");
  run("tools/build_official_stats.mjs", ["--in", input, "--out", path.join(scratch, "stats.js"), "--json-out", jsonOut, "--no-fetch-character-data", "--min-games", "1"]);
  const stats = JSON.parse(await fs.readFile(jsonOut, "utf8"));
  assert.equal(stats.source.dropReasons.unknownChar, 0);
  assert.equal(stats.source.validTeams, 2);
  assert.ok(!stats.source.unmappedCharacterCodes.includes("91"));
  assert.ok(JSON.stringify(stats).includes(id), "builder must materialize Seres weapon variant");
  const exportOut = path.join(scratch, "teams.jsonl");
  run("tools/export_ml_training_data.mjs", ["--in", input, "--out", exportOut]);
  const rows = (await fs.readFile(exportOut, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.members.some((m) => m.variantId === id)));
  const manifest = JSON.parse(await fs.readFile(exportOut.replace(".jsonl", ".manifest.json"), "utf8"));
  assert.equal(manifest.skippedTeams.unknownCharacter, 0);
} finally {
  assert.ok(scratch.startsWith(path.resolve(root, "../..") + path.sep));
  await fs.rm(scratch, { recursive: true, force: true });
}
console.log("Seres regression passed: 5 locales x 5 tiers, tank/CC/protection, core fallback, PNG, union, official builder and ML export (code 91 drops=0).");
