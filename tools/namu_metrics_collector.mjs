import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "src", "data.js");
const OUTPUT_PATH = path.join(ROOT, "src", "wikiMetrics.js");
const DEBUG_PATH = path.join(ROOT, "data", "namu-debug.html");
const OUTPUT_URL = new URL(`file:///${OUTPUT_PATH.replace(/\\/g, "/")}`);
let wroteDebug = false;

function readLocalCharacters(source) {
  const regex = /c\("([^"]+)",\s*"([^"]+)"/g;
  const rows = [];
  let match;
  while ((match = regex.exec(source))) rows.push({ id: match[1], name: match[2] });
  return rows;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&equals;/g, "=")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"");
}

function stripTags(text) {
  return decodeHtml(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function metricRegex(labels) {
  const joined = labels.map(escapeRegex).join("|");
  return new RegExp(`(?:${joined})\\s*(?:=|:|：)?\\s*([1-5])`);
}

function parseMetrics(text) {
  const labels = [
    ["difficulty", ["난이도"]],
    ["damage", ["피해"]],
    ["defense", ["방어"]],
    ["crowdControl", ["군중제어", "군중 제어"]],
    ["mobility", ["이동"]],
    ["utility", ["보조"]],
  ];
  const result = {};
  const decoded = decodeHtml(text);
  const plain = stripTags(text);
  for (const [key, label] of labels) {
    const value = decoded.match(metricRegex(label))?.[1] ?? plain.match(metricRegex(label))?.[1];
    if (!value) return undefined;
    result[key] = Number(value);
  }
  return result;
}

async function loadExistingMetrics() {
  try {
    const module = await import(`${OUTPUT_URL.href}?t=${Date.now()}`);
    return {
      metrics: module.wikiMetrics ?? {},
      sources: module.wikiMetricSources ?? {},
    };
  } catch {
    return { metrics: {}, sources: {} };
  }
}

function pageTitles(name) {
  return [...new Set([
    `${name}/이터널 리턴`,
    `${name}(이터널 리턴)`,
    name,
  ])];
}

async function fetchPage(name) {
  const domains = ["https://namu.wiki", "https://namu.moe", "https://www.namu.moe", "https://dark.namu.moe", "https://d.namu.moe"];
  const candidates = domains.flatMap((domain) =>
    pageTitles(name).map((title) => `${domain}/w/${encodeURIComponent(title)}`),
  );
  const attempts = [];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 ER-Team-Picker/0.1",
        },
      });
      attempts.push(`${response.status} ${url}`);
      if (!response.ok) continue;
      const text = await response.text();
      const metrics = parseMetrics(text);
      if (metrics) return { metrics, url };
      if (!wroteDebug) {
        await fs.mkdir(path.dirname(DEBUG_PATH), { recursive: true });
        await fs.writeFile(DEBUG_PATH, text, "utf8");
        wroteDebug = true;
        console.log(`debug saved: ${path.relative(ROOT, DEBUG_PATH)} (${url})`);
      }
    } catch {
      attempts.push(`fetch failed ${url}`);
    }
  }
  if (!wroteDebug) console.log(`attempts for ${name}: ${attempts.slice(0, 8).join(" | ")}`);
  return undefined;
}

function formatObject(value) {
  return JSON.stringify(value, null, 2).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:");
}

async function main() {
  const characters = readLocalCharacters(await fs.readFile(DATA_PATH, "utf8"));
  const existing = await loadExistingMetrics();
  const metrics = { ...existing.metrics };
  const sources = { ...existing.sources };
  let collected = 0;
  let preserved = 0;

  for (const [index, character] of characters.entries()) {
    const row = await fetchPage(character.name);
    if (row) {
      metrics[character.id] = row.metrics;
      sources[character.id] = row.url;
      collected += 1;
    } else if (metrics[character.id]) {
      preserved += 1;
    }
    console.log(`[${index + 1}/${characters.length}] ${character.name} ${row ? "ok" : metrics[character.id] ? "preserved" : "missing"}`);
    await new Promise((resolve) => setTimeout(resolve, 240));
  }

  const content = `export const WIKI_METRICS_SOURCE = {
  name: "NamuWiki Eternal Return character overview",
  note: "Values are 1-5 overview metrics: difficulty, damage, defense, crowdControl, mobility, utility.",
  generatedAt: "${new Date().toISOString()}",
};

export const wikiMetrics = ${formatObject(metrics)};

export const wikiMetricSources = ${formatObject(sources)};
`;

  await fs.writeFile(OUTPUT_PATH, content, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`collected: ${collected}, preserved: ${preserved}, total saved: ${Object.keys(metrics).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
