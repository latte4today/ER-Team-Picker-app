import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INPUT_PATH = path.join(ROOT, "data", "wiki-metrics.csv");
const OUTPUT_PATH = path.join(ROOT, "src", "wikiMetrics.js");
const METRIC_FIELDS = ["difficulty", "damage", "defense", "crowdControl", "mobility", "utility"];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => item.trim().length > 0));
}

function toNumber(value, field, id) {
  const number = Number(String(value ?? "").trim());
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new Error(`${id}의 ${field} 값은 1~5 정수여야 합니다. 현재 값: ${value || "(빈 값)"}`);
  }
  return number;
}

function formatMetric(id, metric) {
  const entries = METRIC_FIELDS.map((field) => `${field}: ${metric[field]}`).join(", ");
  return `  ${id}: { ${entries} },`;
}

const csv = await fs.readFile(INPUT_PATH, "utf8");
const [header, ...body] = parseCsv(csv);
if (header?.[0]) {
  header[0] = header[0].replace(/^\ufeff/, "");
}
const headerIndex = new Map(header.map((name, index) => [name.trim(), index]));

for (const required of ["id", "name", ...METRIC_FIELDS]) {
  if (!headerIndex.has(required)) {
    throw new Error(`CSV에 ${required} 컬럼이 없습니다.`);
  }
}

const metrics = {};
const skipped = [];

for (const row of body) {
  const id = row[headerIndex.get("id")]?.trim();
  const name = row[headerIndex.get("name")]?.trim() || id;
  if (!id) continue;

  const hasAnyMetric = METRIC_FIELDS.some((field) => String(row[headerIndex.get(field)] ?? "").trim().length > 0);
  if (!hasAnyMetric) {
    skipped.push(`${name}(${id})`);
    continue;
  }

  metrics[id] = Object.fromEntries(
    METRIC_FIELDS.map((field) => [field, toNumber(row[headerIndex.get(field)], field, name)]),
  );
}

const ids = Object.keys(metrics).sort((a, b) => a.localeCompare(b));
const content = `export const WIKI_METRICS_SOURCE = {
  name: "NamuWiki Eternal Return character overview",
  note: "Values are 1-5 overview metrics: difficulty, damage, defense, crowdControl, mobility, utility.",
};

export const wikiMetrics = {
${ids.map((id) => formatMetric(id, metrics[id])).join("\n")}
};
`;

await fs.writeFile(OUTPUT_PATH, content, "utf8");
console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)} (${ids.length} characters)`);
if (skipped.length > 0) {
  console.log(`skipped blank rows: ${skipped.length}`);
}
