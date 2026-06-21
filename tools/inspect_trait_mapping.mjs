import { requireEnv } from "./env.mjs";

const BASE_URL = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";

async function main() {
  const apiKey = requireEnv("ER_API_KEY");
  const res = await fetch(`${BASE_URL}/v2/data/Trait`, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`Trait fetch failed: ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  const rows = payload.data ?? [];
  const cores = rows
    .filter((row) => row.active !== false && String(row.traitType).toLowerCase() === "core")
    .sort((a, b) => {
      const group = String(a.traitGroup ?? "").localeCompare(String(b.traitGroup ?? ""));
      if (group) return group;
      return Number(a.traitSortOrder ?? 0) - Number(b.traitSortOrder ?? 0);
    });

  console.log("Active core traits from /v2/data/Trait");
  for (const row of cores) {
    console.log(JSON.stringify({
      code: row.code,
      traitGroup: row.traitGroup,
      traitType: row.traitType,
      traitSortOrder: row.traitSortOrder,
      active: row.active,
    }));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
