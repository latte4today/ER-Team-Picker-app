/**
 * build_realtime_stats.mjs — regenerate src/dakggRealtimeStats.js from the dak.gg API.
 *
 * That file feeds the recommender's dakRealtime score. It was transcribed by hand from
 * screenshots (see dakgg_realtime_stats_from_images.ts), so nothing refreshed it: it sat
 * at its 2026-06-07 values and had no row at all for characters added since, which
 * scores them a flat 0 on the whole component.
 *
 * Every field the file carries is derivable from /api/v1/character-stats, so this
 * replaces the manual step:
 *
 *   rpGain      mmrGain / count          winRate     win / count
 *   pickRate    count / total picks      top3Rate    top3 / count
 *   pickCount   count                    averageRank place / count
 *   damage      damageToPlayer / count   averageTK   teamKill / count
 *   playerKill  playerKill / count       vision      viewContribution / count
 *   tier        as reported              rank        by tierScore, descending
 *
 * Usage:
 *   node tools/build_realtime_stats.mjs
 *   node tools/build_realtime_stats.mjs --tier mithril_plus --days 7
 *   node tools/build_realtime_stats.mjs --dry-run
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "dakggRealtimeStats.js");
const API_BASE = "https://er.dakgg.io";

// dak.gg weapon keys, in the order the game's WeaponType enum declares them.
// Verified by cross-referencing every single-weapon character against src/data.js.
const WEAPON_BY_KEY = {
  1: "glove", 2: "tonfa", 3: "bat", 4: "whip", 5: "throw", 6: "shuriken", 7: "bow",
  8: "crossbow", 9: "pistol", 10: "assault_rifle", 11: "sniper_rifle", 13: "hammer",
  14: "axe", 15: "dagger", 16: "two_handed_sword", 18: "dual_swords", 19: "spear",
  20: "nunchaku", 21: "rapier", 22: "guitar", 23: "camera", 24: "arcana", 25: "vf_prosthetic",
};

function parseArgs() {
  const args = { tier: "diamond_plus", days: 7, teamMode: "SQUAD", matchingMode: "RANK", dryRun: false };
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (key === "--dry-run") { args.dryRun = true; continue; }
    if (!key.startsWith("--")) continue;
    const value = process.argv[i + 1];
    i += 1;
    if (key === "--tier") args.tier = value;
    if (key === "--days") args.days = Number(value);
    if (key === "--team-mode") args.teamMode = value;
    if (key === "--matching-mode") args.matchingMode = value;
  }
  return args;
}

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

async function main() {
  const args = parseArgs();
  const { characterVariants } = await import(`file://${path.join(ROOT, "src", "data.js").replace(/\\/g, "/")}`);

  const url = `${API_BASE}/api/v1/character-stats?dt=${args.days}&teamMode=${args.teamMode}&matchingMode=${args.matchingMode}&tier=${args.tier}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 ER-Team-Picker" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const payload = await response.json();
  const snapshot = payload.characterStatSnapshot;
  const stats = snapshot?.characterStats ?? [];
  if (!stats.length) throw new Error("character-stats returned no rows");

  // dak.gg keys characters by the official code; map to local ids through data.js.
  const localByCode = new Map();
  for (const variant of characterVariants) localByCode.set(variant.characterId, variant.characterId);
  // The stats endpoint keys by character code but carries no names; the leaderboard
  // payload does, and it needs the live season key.
  const season = await fetch(`${API_BASE}/api/v0/current-season?hl=ko`, {
    headers: { "User-Agent": "Mozilla/5.0 ER-Team-Picker" },
  }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const seasonKey = season?.type ?? season?.currentSeason?.key ?? "";
  const leaderboard = await fetch(
    `${API_BASE}/api/v0/leaderboard?page=1&seasonKey=${encodeURIComponent(seasonKey)}&serverName=seoul&teamMode=SQUAD&hl=ko`,
    { headers: { "User-Agent": "Mozilla/5.0 ER-Team-Picker" } },
  ).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (!Object.keys(leaderboard.characterById ?? {}).length) {
    throw new Error(`could not resolve character names (seasonKey=${seasonKey || "unset"})`);
  }
  const nameByCode = new Map(
    Object.entries(leaderboard.characterById ?? {}).map(([code, c]) => [Number(code), c.name]),
  );
  const normalize = (name) => String(name ?? "").replace(/\s+/g, "").toLowerCase();
  const idByName = new Map(characterVariants.map((v) => [normalize(v.name), v.characterId]));

  const rows = [];
  const unmapped = [];
  let totalPicks = 0;
  for (const stat of stats) {
    for (const weapon of stat.weaponStats ?? []) totalPicks += weapon.count ?? 0;
  }

  for (const stat of stats) {
    const code = Number(stat.key);
    const localId = idByName.get(normalize(nameByCode.get(code))) ?? localByCode.get(code);
    if (!localId) { unmapped.push(`${code}:${nameByCode.get(code) ?? "?"}`); continue; }
    for (const weapon of stat.weaponStats ?? []) {
      const weaponId = WEAPON_BY_KEY[Number(weapon.key)];
      const games = weapon.count ?? 0;
      if (!weaponId || games <= 0) continue;
      const variantId = `${localId}:${weaponId}`;
      rows.push({
        variantId,
        tier: weapon.tier ?? "?",
        tierScore: weapon.tierScore ?? 0,
        rpGain: round((weapon.mmrGain ?? 0) / games, 1),
        pickRate: round((games / totalPicks) * 100, 2),
        pickCount: games,
        winRate: round(((weapon.win ?? 0) / games) * 100, 2),
        top3Rate: round(((weapon.top3 ?? 0) / games) * 100, 2),
        averageRank: round((weapon.place ?? 0) / games, 1),
        damage: Math.round((weapon.damageToPlayer ?? 0) / games),
        averageTK: round((weapon.teamKill ?? 0) / games, 2),
        playerKill: round((weapon.playerKill ?? 0) / games, 2),
        vision: round((weapon.viewContribution ?? 0) / games, 1),
      });
    }
  }

  // Only variants the app actually offers; a dak.gg row for a build we do not model
  // would never be read and only inflates the averages.
  const known = new Set(characterVariants.map((v) => v.variantId));
  const kept = rows.filter((row) => known.has(row.variantId));

  // A "flex" character (Alex) is one variant here but many weapon rows on dak.gg, so
  // none of them match and the character would score 0. Fold the weapon rows into the
  // flex variant, weighting each field by that build's game count.
  const flexIds = new Set(
    characterVariants.filter((v) => v.weapon === "flex").map((v) => v.characterId),
  );
  const folded = [];
  for (const characterId of flexIds) {
    const parts = rows.filter((row) => row.variantId.startsWith(`${characterId}:`) && !known.has(row.variantId));
    const games = parts.reduce((sum, row) => sum + row.pickCount, 0);
    if (!games) continue;
    const wmean = (field, digits) => round(parts.reduce((sum, row) => sum + row[field] * row.pickCount, 0) / games, digits);
    const best = parts.reduce((a, b) => (b.pickCount > a.pickCount ? b : a));
    folded.push({
      variantId: `${characterId}:flex`,
      tier: best.tier,
      tierScore: wmean("tierScore", 4),
      rpGain: wmean("rpGain", 1),
      pickRate: round(parts.reduce((sum, row) => sum + row.pickRate, 0), 2),
      pickCount: games,
      winRate: wmean("winRate", 2),
      top3Rate: wmean("top3Rate", 2),
      averageRank: wmean("averageRank", 1),
      damage: Math.round(wmean("damage", 0)),
      averageTK: wmean("averageTK", 2),
      playerKill: wmean("playerKill", 2),
      vision: wmean("vision", 1),
    });
  }
  kept.push(...folded);
  if (folded.length) console.log(`  folded flex builds: ${folded.map((f) => `${f.variantId} (${f.pickCount} games)`).join(", ")}`);

  const foldedIds = new Set(folded.map((f) => f.variantId.split(":")[0]));
  const skipped = rows
    .filter((row) => !known.has(row.variantId) && !foldedIds.has(row.variantId.split(":")[0]))
    .map((r) => r.variantId);

  kept.sort((a, b) => b.tierScore - a.tierScore);
  kept.forEach((row, index) => { row.rank = index + 1; });

  const mean = (field) => round(kept.reduce((sum, row) => sum + row[field], 0) / kept.length, 2);
  const averages = {
    rpGain: mean("rpGain"), pickRate: mean("pickRate"), pickCount: mean("pickCount"),
    winRate: mean("winRate"), top3Rate: mean("top3Rate"), averageRank: mean("averageRank"),
    damage: mean("damage"), averageTK: mean("averageTK"), playerKill: mean("playerKill"),
    vision: mean("vision"),
  };

  const missing = characterVariants.filter((v) => !kept.some((row) => row.variantId === v.variantId));
  console.log(`tier=${args.tier} days=${args.days} | variants: ${kept.length}/${characterVariants.length}`);
  if (unmapped.length) console.log(`  unmapped dak characters: ${unmapped.join(", ")}`);
  if (skipped.length) console.log(`  dak variants not modelled locally: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? ` (+${skipped.length - 8})` : ""}`);
  if (missing.length) console.log(`  no dak row (too few games): ${missing.map((v) => v.variantId).slice(0, 8).join(", ")}${missing.length > 8 ? ` (+${missing.length - 8})` : ""}`);

  if (args.dryRun) {
    for (const id of ["lucia:sniper_rifle", "craver:pistol"]) {
      console.log(`  ${id}: ${JSON.stringify(kept.find((r) => r.variantId === id) ?? null)}`);
    }
    return;
  }

  const body = [
    "// Generated by tools/build_realtime_stats.mjs. Do not edit by hand.",
    `// source: dak.gg character-stats, tier=${args.tier}, dt=${args.days}, ${args.matchingMode}/${args.teamMode}`,
    `// generatedAt: ${new Date().toISOString()}`,
    "",
    `export const realtimeStatAverages = ${JSON.stringify(averages, null, 2)};`,
    "",
    "export const dakggRealtimeStatsByVariant = Object.fromEntries([",
    ...kept.map((r) => `  [${JSON.stringify(r.variantId)}, ${r.rank}, ${JSON.stringify(r.tier)}, ${r.rpGain}, ${r.pickRate}, ${r.pickCount}, ${r.winRate}, ${r.top3Rate}, ${r.averageRank}, ${r.damage}, ${r.averageTK}, ${r.playerKill}, ${r.vision}],`),
    "].map(([variantId, rank, tier, rpGain, pickRate, pickCount, winRate, top3Rate, averageRank, damage, averageTK, playerKill, vision]) => [",
    "  variantId,",
    "  { rank, tier, rpGain, pickRate, pickCount, winRate, top3Rate, averageRank, damage, averageTK, playerKill, vision },",
    "]));",
    "",
  ].join("\n");

  await fs.writeFile(OUT, body, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)} (${kept.length} variants)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
