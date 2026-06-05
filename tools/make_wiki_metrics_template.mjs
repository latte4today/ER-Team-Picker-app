import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters } from "../src/data.js";
import { wikiMetrics } from "../src/wikiMetrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "wiki-metrics.csv");

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const header = ["id", "name", "difficulty", "damage", "defense", "crowdControl", "mobility", "utility"];
const rows = characters.map((character) => {
  const metric = wikiMetrics[character.id] ?? {};
  return [
    character.id,
    character.name,
    metric.difficulty ?? "",
    metric.damage ?? "",
    metric.defense ?? "",
    metric.crowdControl ?? "",
    metric.mobility ?? "",
    metric.utility ?? "",
  ].map(csvEscape).join(",");
});

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, `\ufeff${header.join(",")}\n${rows.join("\n")}\n`, "utf8");
console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
