/**
 * sync_character_roster.mjs — detect and register newly released characters.
 *
 * Adding a character used to be a hand edit across nine files (see 3b40b3a,
 * "feat: add Lucia to team picker"). Miss one and the failure is silent: Craver
 * sat at zero tier data for two weeks, and build_official_stats quietly dropped
 * 2546 teams as unknownChar because code 90 was not in the map.
 *
 * dak.gg's /api/v1/data/characters tracks the live roster. The official
 * /v1/data/Character table cannot be used for this - it is frozen at 64 rows
 * while the roster is at 90. The dak payload carries the code, the English key,
 * localized names for every locale we ship, the weapon masteries and the
 * portrait: everything mechanical.
 *
 * What it cannot give us is judgement. Tags, ccProfile, difficulty and the
 * damage split are hand-authored, and the archetype and mastery hints below are
 * only ~91% and ~66% accurate against our existing roster. So this writes a
 * working, reviewable draft and prints exactly what a human still has to check.
 * A new character is playable in the picker the day it ships instead of being
 * invisible until someone notices.
 *
 * Usage:
 *   node tools/sync_character_roster.mjs --check    # CI guard, exit 1 if new
 *   node tools/sync_character_roster.mjs            # write the draft
 *   node tools/sync_character_roster.mjs --dry-run  # show, do not write
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { characters, weaponTypes } from "../src/data.js";
import { FALLBACK_CHARACTER_CODE_TO_ID } from "./character_code_map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API = "https://er.dakgg.io/api/v1/data/characters";

// Our five shipped locales -> the hl value dak.gg answers them with. "zh-Hans"
// and "zh-Hant" are NOT accepted: they return 200 with the Korean name still in
// place, which would have written 루치아 into both Chinese files.
const LOCALES = [
  { key: "ko", file: "ko.js", hl: "ko" },
  { key: "en", file: "en.js", hl: "en" },
  { key: "ja", file: "ja.js", hl: "ja" },
  { key: "zhHans", file: "zhHans.js", hl: "zh-CN" },
  { key: "zhHant", file: "zhHant.js", hl: "zh-TW" },
];

// dak.gg weapon key -> our weaponTypes id. Verified against all 90 characters.
const WEAPON_KEYS = {
  Arcana: "arcana",
  AssaultRifle: "assault_rifle",
  Axe: "axe",
  Bat: "bat",
  Bow: "bow",
  Camera: "camera",
  CrossBow: "crossbow",
  DirectFire: "shuriken",
  DualSword: "dual_swords",
  Glove: "glove",
  Guitar: "guitar",
  Hammer: "hammer",
  HighAngleFire: "throw",
  Nunchaku: "nunchaku",
  OneHandSword: "dagger",
  Pistol: "pistol",
  Rapier: "rapier",
  SniperRifle: "sniper_rifle",
  Spear: "spear",
  Tonfa: "tonfa",
  TwoHandSword: "two_handed_sword",
  VFArm: "vf_prosthetic",
  Whip: "whip",
};

// charArcheTypes[0] -> our role. Agrees with our hand-assigned role on 82 of
// the 90 existing characters; the eight it misses (Aya, Silvia, Nicky, Karla,
// Vanya, Arda, Darko, Mirka) are real judgement calls, not bugs. A starting
// point, not an answer.
const ARCHETYPE_ROLES = {
  Tanker: "frontline",
  Warrior: "bruiser",
  Marksman: "ranged",
  Assasin: "assassin", // dak.gg's spelling
  Assassin: "assassin",
  Mage: "mage",
  Supporter: "support",
};

// Enough for the character to behave coherently in the UI on day one; the real
// tags come from review.
const ROLE_SEED_TAGS = {
  frontline: ["initiate", "cc", "durable"],
  bruiser: ["dive", "duel"],
  ranged: ["sustained", "range"],
  assassin: ["burst", "dive", "focus"],
  mage: ["poke", "burst"],
  support: ["peel", "utility"],
};

function parseArgs(argv) {
  const args = { check: false, dryRun: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--check") args.check = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown argument: ${raw}`);
  }
  return args;
}

function slugFor(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

async function fetchRoster(hl) {
  const response = await fetch(`${API}?hl=${encodeURIComponent(hl)}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for hl=${hl}`);
  const payload = await response.json();
  const rows = payload?.characters;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`empty roster for hl=${hl}`);
  return rows;
}

// A SkillAmp-only mastery means a skill dealer 44 times out of 52, but a
// basic-attack mastery splits 12 basic / 10 hybrid / 9 skill. So this is a
// guess outside the skill case, and is always flagged for review.
function guessDamage(row) {
  const options = new Set(
    (row.masteryStats ?? []).flatMap((mastery) => (mastery.options ?? []).map((option) => option.key)),
  );
  const skill = options.has("SkillAmpRatio");
  const basic = options.has("IncreaseBasicAttackDamageRatio");
  if (skill && basic) return "hybrid";
  if (skill) return "skill";
  if (basic) return "basic";
  return "hybrid";
}

function describe(entry) {
  return `${entry.code} ${entry.names.ko} (${entry.key} -> ${entry.id})`;
}

/**
 * Insert one line into a `key: value` block, keeping the block's existing sort
 * order. `sortKeyOf` returns the sort key for a line or null when the line is
 * not an entry (blank lines, comments). Appends at the end of the block when
 * the new key sorts last.
 */
function insertSorted(source, blockStart, sortKeyOf, newSortKey, line) {
  const lines = source.split("\n");
  const openIndex = lines.findIndex((text) => text.startsWith(blockStart));
  if (openIndex === -1) throw new Error(`block not found: ${blockStart}`);

  let insertAt = -1;
  let blockEnd = -1;
  for (let i = openIndex + 1; i < lines.length; i += 1) {
    if (lines[i] === "};" || lines[i] === "];") {
      blockEnd = i;
      break;
    }
    const key = sortKeyOf(lines[i]);
    if (key === null) continue;
    if (insertAt === -1 && key.localeCompare(newSortKey) > 0) insertAt = i;
  }
  if (blockEnd === -1) throw new Error(`unterminated block: ${blockStart}`);
  if (insertAt === -1) insertAt = blockEnd;

  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);

  const rosters = new Map();
  for (const locale of LOCALES) {
    rosters.set(locale.key, await fetchRoster(locale.hl));
  }
  const base = rosters.get("ko");

  const knownCodes = new Set(Object.keys(FALLBACK_CHARACTER_CODE_TO_ID).map(Number));
  const knownIds = new Set(characters.map((character) => character.id));

  const additions = [];
  for (const row of base) {
    if (knownCodes.has(row.id)) continue;

    const names = {};
    for (const locale of LOCALES) {
      names[locale.key] = rosters.get(locale.key).find((r) => r.id === row.id)?.name ?? row.name;
    }

    const weaponRows = row.weaponTypes ?? [];
    const role = ARCHETYPE_ROLES[row.charArcheTypes?.[0]] ?? "bruiser";
    const id = slugFor(row.key);

    additions.push({
      code: row.id,
      key: row.key,
      id,
      names,
      idCollision: knownIds.has(id),
      role,
      archetypes: row.charArcheTypes ?? [],
      damage: guessDamage(row),
      weapons: weaponRows.map((w) => WEAPON_KEYS[w.key]).filter(Boolean),
      unmappedWeapons: weaponRows.filter((w) => !WEAPON_KEYS[w.key]).map((w) => w.key),
      tags: ROLE_SEED_TAGS[role] ?? ["duel"],
      imageUrl: row.imageUrl ? new URL(row.imageUrl, "https://cdn.dak.gg").href : null,
    });
  }

  // The reverse direction matters too: a code we know that dak.gg has dropped
  // means our map describes a roster that no longer exists.
  const liveCodes = new Set(base.map((row) => row.id));
  const stale = [...knownCodes].filter((code) => !liveCodes.has(code));

  console.log(`dak.gg roster: ${base.length} characters; local map: ${knownCodes.size}`);
  if (stale.length) {
    console.warn(`::warning title=Codes not on the live roster::${stale.join(", ")}`);
  }

  if (!additions.length) {
    console.log("roster is up to date; nothing to add");
    return;
  }

  console.log(`\n${additions.length} new character(s):`);
  for (const entry of additions) console.log(`  ${describe(entry)}`);

  if (args.check) {
    console.error(`::error title=New characters on the live roster::${additions.map(describe).join("; ")}`);
    console.error("Run `node tools/sync_character_roster.mjs` to draft them in.");
    process.exit(1);
  }

  for (const entry of additions) {
    if (entry.idCollision) {
      throw new Error(`id "${entry.id}" (code ${entry.code}) already exists locally; resolve by hand`);
    }
    if (entry.unmappedWeapons.length) {
      console.warn(`  ! ${entry.id}: unknown weapon key(s) ${entry.unmappedWeapons.join(", ")} - add to WEAPON_KEYS`);
    }
    for (const weapon of entry.weapons) {
      if (!weaponTypes[weapon]) console.warn(`  ! ${entry.id}: weapon "${weapon}" is not in weaponTypes`);
    }
  }

  const writes = [];

  // 1. The character code map. Missing entries here silently drop match rows.
  {
    const file = path.join(ROOT, "tools", "character_code_map.mjs");
    const text = await fs.readFile(file, "utf8");
    const block = additions.map((entry) => `  ${entry.code}: "${entry.id}",`).join("\n");
    if (!text.includes("\n};\n")) throw new Error("character_code_map.mjs: no closing brace found");
    writes.push([file, text.replace("\n};\n", `\n${block}\n};\n`)]);
  }

  // 2. data.js: the roster entry and the weapon masteries.
  {
    const file = path.join(ROOT, "src", "data.js");
    let text = await fs.readFile(file, "utf8");
    for (const entry of additions) {
      const tags = entry.tags.map((tag) => `"${tag}"`).join(", ");
      text = insertSorted(
        text,
        "export const characters = [",
        (line) => line.match(/^\s*c\("[^"]+", "([^"]+)"/)?.[1] ?? null,
        entry.names.ko,
        `  c("${entry.id}", "${entry.names.ko}", "${entry.role}", [${tags}], "${entry.damage}", 3),`,
      );
      if (entry.weapons.length) {
        text = insertSorted(
          text,
          "export const characterWeapons = {",
          (line) => line.match(/^\s*([a-z0-9_]+):/)?.[1] ?? null,
          entry.id,
          `  ${entry.id}: [${entry.weapons.map((w) => `"${w}"`).join(", ")}],`,
        );
      }
    }
    writes.push([file, text]);
  }

  // 3. Localized display names.
  for (const locale of LOCALES) {
    const file = path.join(ROOT, "src", "i18n", locale.file);
    let text = await fs.readFile(file, "utf8");
    for (const entry of additions) {
      const lines = text.split("\n");
      const charLines = lines
        .map((line, index) => [line.match(/^\s*"char\.([a-z0-9_]+)":/)?.[1] ?? null, index])
        .filter(([key]) => key !== null);
      if (!charLines.length) throw new Error(`no char.* block in ${locale.file}`);
      const after = charLines.find(([key]) => key.localeCompare(entry.id) > 0);
      const at = after ? after[1] : charLines[charLines.length - 1][1] + 1;
      lines.splice(at, 0, `  "char.${entry.id}": "${entry.names[locale.key]}",`);
      text = lines.join("\n");
    }
    writes.push([file, text]);
  }

  if (args.dryRun) {
    console.log("\n--dry-run: no files written");
  } else {
    for (const [file, text] of writes) {
      await fs.writeFile(file, text);
      console.log(`  wrote ${path.relative(ROOT, file)}`);
    }
    for (const entry of additions) {
      if (!entry.imageUrl) continue;
      const dest = path.join(ROOT, "assets", "characters", "mini", `${entry.id}.png`);
      try {
        const response = await fetch(entry.imageUrl);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        await fs.writeFile(dest, Buffer.from(await response.arrayBuffer()));
        console.log(`  wrote ${path.relative(ROOT, dest)}`);
      } catch (error) {
        console.warn(`  ! portrait for ${entry.id} failed: ${error.message}`);
      }
    }
  }

  console.log("\nStill needs a human - these cannot be derived:");
  for (const entry of additions) {
    console.log(`\n  ${entry.id} (${entry.names.ko})`);
    console.log(`    role       : "${entry.role}"  <- dak archetype ${entry.archetypes.join("+")}, ~91% accurate`);
    console.log(`    damage     : "${entry.damage}"  <- mastery stats, ~66% accurate`);
    console.log(`    tags       : ${JSON.stringify(entry.tags)}  <- role placeholder, almost certainly wrong`);
    console.log(`    difficulty : 3  <- placeholder`);
    console.log(`    ccProfile  : absent, so it scores as no CC. Add to ccProfiles in src/data.js`);
    console.log(`    combatProfiles.js / wikiMetrics.js: no entry, both fall back`);
  }
  console.log("\nTier data arrives on the next collect-dak-meta run; match stats take a few days.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
