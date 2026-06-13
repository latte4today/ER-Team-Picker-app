/**
 * discover_official_data_tables.mjs
 *
 * Probes official Eternal Return /v1/data/{table}, /v2/data/{table}, and l10n
 * endpoints. This helps decide which official metadata can support objective
 * character/skill profiling before adding manual tags.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";

const DEFAULT_OUT_DIR = path.join(ROOT, "data", "official-data-discovery");
const DEFAULT_DELAY_MS = 1200;

const DEFAULT_TABLES = [
  "Character",
  "Skill",
  "SkillData",
  "SkillInfo",
  "CharacterSkill",
  "CharacterSkillData",
  "CharacterState",
  "CharacterLevelUpStat",
  "CharacterMastery",
  "CharacterModeModifier",
  "CharacterAttributes",
  "WeaponTypeInfo",
  "ItemWeapon",
  "ItemArmor",
  "ItemConsumable",
  "ItemSpecial",
  "ItemSkill",
  "ItemSkillData",
  "TacticalSkill",
  "TacticalSkillSet",
  "TacticalSkillGroup",
  "Trait",
  "TraitData",
  "TraitCombat",
  "TraitSupport",
  "MasteryExp",
  "Monster",
  "SummonObject",
  "State",
  "StatusEffect",
  "Effect",
];

const DEFAULT_DATA_VERSIONS = ["v1", "v2"];

const DEFAULT_L10N_LANGUAGES = [
  "Korean",
  "ko",
  "ko-KR",
  "English",
  "en",
  "en-US",
];

function parseArgs() {
  const args = {
    outDir: DEFAULT_OUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
    tables: [...DEFAULT_TABLES],
    dataVersions: [...DEFAULT_DATA_VERSIONS],
    l10nLanguages: [...DEFAULT_L10N_LANGUAGES],
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--out-dir") args.outDir = path.resolve(ROOT, value);
    if (key === "--delay-ms") args.delayMs = Number(value);
    if (key === "--data-versions") {
      args.dataVersions = String(value)
        .split(",")
        .map((item) => item.trim().replace(/^\/+/, ""))
        .filter(Boolean);
    }
    if (key === "--l10n-languages") {
      args.l10nLanguages = String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (key === "--tables") {
      args.tables = String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function findArrays(value, pathParts = [], output = []) {
  if (Array.isArray(value)) {
    output.push({ path: pathParts.join(".") || "$", rows: value });
    for (const item of value.slice(0, 3)) findArrays(item, pathParts.concat("[]"), output);
    return output;
  }
  if (!isObject(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    findArrays(child, pathParts.concat(key), output);
  }
  return output;
}

function compactValue(value, depth = 0) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => compactValue(item, depth + 1));

  const limit = depth > 1 ? 8 : 16;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, limit)
      .map(([key, child]) => [key, compactValue(child, depth + 1)]),
  );
}

function summarizePayload(payload) {
  const arrays = findArrays(payload)
    .filter((entry) => entry.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length);
  const primary = arrays[0];
  const sample = primary?.rows?.[0];
  const keys = isObject(sample) ? Object.keys(sample).sort() : [];

  return {
    payloadKeys: isObject(payload) ? Object.keys(payload).sort() : [],
    primaryArrayPath: primary?.path ?? null,
    rowCount: primary?.rows?.length ?? 0,
    sampleKeys: keys,
    sample: compactValue(sample ?? payload),
  };
}

async function fetchEndpoint(endpoint, apiKey) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { "x-api-key": apiKey },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 1000) };
  }
  return { endpoint, status: response.status, ok: response.ok, payload };
}

async function fetchDataTable(version, table, apiKey) {
  const endpoint = `/${version}/data/${encodeURIComponent(table)}`;
  const result = await fetchEndpoint(endpoint, apiKey);
  return { kind: "data", version, table, ...result };
}

async function fetchL10n(language, apiKey) {
  const endpoint = `/v1/l10n/${encodeURIComponent(language)}`;
  const result = await fetchEndpoint(endpoint, apiKey);
  return { kind: "l10n", language, ...result };
}

async function main() {
  const args = parseArgs();
  const apiKey = requireEnv("ER_API_KEY");
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

  await fs.mkdir(args.outDir, { recursive: true });

  const results = [];
  const dataJobs = args.dataVersions.flatMap((version) =>
    args.tables.map((table) => ({ kind: "data", version, table })),
  );
  const l10nJobs = args.l10nLanguages.map((language) => ({ kind: "l10n", language }));
  const jobs = [...dataJobs, ...l10nJobs];

  for (const [index, job] of jobs.entries()) {
    const result = job.kind === "data"
      ? await fetchDataTable(job.version, job.table, apiKey)
      : await fetchL10n(job.language, apiKey);
    const summary = result.ok
      ? summarizePayload(result.payload)
      : { errorPreview: compactValue(result.payload) };
    const entry = {
      kind: result.kind,
      version: result.version,
      table: result.table,
      language: result.language,
      endpoint: result.endpoint,
      status: result.status,
      ok: result.ok,
      ...summary,
    };
    results.push(entry);

    const status = result.ok ? "OK" : "FAILED";
    const rows = result.ok ? ` rows=${summary.rowCount}` : "";
    const label = result.kind === "data"
      ? `${result.version} ${result.table}`
      : `l10n ${result.language}`;
    console.log(`${index + 1}/${jobs.length} ${label}: ${result.status} ${status}${rows}`);

    if (index < jobs.length - 1) await sleep(args.delayMs);
  }

  const report = {
    generatedAt,
    baseUrl: BASE_URL,
    dataVersions: args.dataVersions,
    l10nLanguages: args.l10nLanguages,
    tables: results,
  };
  const outPath = path.join(args.outDir, `official-data-discovery-${stamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  const successfulData = results.filter((item) => item.ok && item.kind === "data");
  const successfulL10n = results.filter((item) => item.ok && item.kind === "l10n");
  console.log(`\nSuccessful data tables: ${successfulData.map((item) => `${item.version}/${item.table}`).join(", ") || "none"}`);
  console.log(`Successful l10n: ${successfulL10n.map((item) => item.language).join(", ") || "none"}`);
  console.log(`Saved: ${path.relative(ROOT, outPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
