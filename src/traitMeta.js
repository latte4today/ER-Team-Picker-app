const CORE_ICON_SLUG_BY_NAME = {
  "취약": "frailty-infliction",
  "흡혈마": "vampiric-bloodline",
  "벽력": "red-sprite",
  "아드레날린": "adrenaline",
  "액셀러레이터": "accelerator",
  "스텔라 차지": "stellar-charge",
  "도깨비불": "ghost-light",
  "와류": "siphon-maelstrom",
  "금강": "diamond-shard",
  "불괴": "ironclad",
  "빛의 수호": "heavy-kneepads",
  "응징": "bitter-retribution",
  "초재생": "healing-factor",
  "증폭 드론": "amplification-drone",
  "치유 드론": "healing-drone",
  "헌신": "sentinel",
};

export const CURRENT_CORE_TRAIT_NAMES = new Set(Object.keys(CORE_ICON_SLUG_BY_NAME));

export const CURRENT_CORE_NAME_BY_CODE = {
  7000201: "취약",
  7000401: "흡혈마",
  7000501: "벽력",
  7000601: "아드레날린",
  7000701: "액셀러레이터",
  7100101: "금강",
  7100201: "불괴",
  7100401: "빛의 수호",
  7100501: "응징",
  7200101: "초재생",
  7200201: "증폭 드론",
  7200301: "치유 드론",
  7200501: "헌신",
  7300101: "스텔라 차지",
  7300201: "도깨비불",
  7300301: "와류",
};

// Manual guardrails for variants where noisy long-tail rows should not be shown
// as practical core choices. The raw rows are still used for scoring elsewhere.
export const VARIANT_CORE_OVERRIDES = {
  "nia:pistol": [
    { core: "7000401", name: "흡혈마" },
  ],
  "sho:spear": [
    { core: "7200301", name: "치유 드론" },
    { core: "7200201", name: "증폭 드론" },
  ],
  "sho:dagger": [
    { core: "7200201", name: "증폭 드론" },
    { core: "7200301", name: "치유 드론" },
  ],
  "bihyung:bat": [
    { core: "7100501", name: "응징" },
    { core: "7300301", name: "와류" },
  ],
  "shirin:rapier": [
    { core: "7000401", name: "흡혈마" },
  ],
  "fenrir:glove": [
    { core: "7100501", name: "응징" },
    { core: "7000201", name: "취약" },
  ],
  "luke:bat": [
    { core: "7200301", name: "치유 드론" },
    { core: "7300301", name: "와류" },
    { core: "7100501", name: "응징" },
  ],
  "ian:dagger": [
    { core: "7100501", name: "응징" },
    { core: "7000401", name: "흡혈마" },
  ],
};

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeCoreName(rowOrCode) {
  if (typeof rowOrCode === "object" && rowOrCode?.nameOverride) return rowOrCode.nameOverride;
  if (typeof rowOrCode === "string" && CURRENT_CORE_TRAIT_NAMES.has(rowOrCode)) return rowOrCode;

  const code = typeof rowOrCode === "object" ? rowOrCode?.core : rowOrCode;
  const mapped = CURRENT_CORE_NAME_BY_CODE[String(code)];
  if (mapped) return mapped;

  const name = typeof rowOrCode === "object" ? rowOrCode?.name : undefined;
  return CURRENT_CORE_TRAIT_NAMES.has(name) ? name : null;
}

export function coreIconPath(nameOrRow) {
  const name = typeof nameOrRow === "object" ? normalizeCoreName(nameOrRow) : nameOrRow;
  const slug = CORE_ICON_SLUG_BY_NAME[name];
  return slug ? `assets/traits/${slug}.png` : null;
}

function rowMatchesAllowedCore(row, allowed) {
  const name = normalizeCoreName(row);
  return allowed.has(String(row.core)) || (name && allowed.has(name));
}

export function allowedCoreSetForVariant(variantId) {
  const values = VARIANT_CORE_OVERRIDES[variantId];
  return values ? new Set(values.map((value) => String(typeof value === "object" ? value.core ?? value.name : value))) : null;
}

function variantOverrideRows(variantId, rows = []) {
  const overrides = VARIANT_CORE_OVERRIDES[variantId];
  if (!overrides) return null;

  return overrides
    .map((entry) => {
      const core = String(typeof entry === "object" ? entry.core : entry);
      const name = typeof entry === "object" ? entry.name : String(entry);
      const source = rows.find((row) => String(row.core) === core);
      return {
        ...(source ?? {}),
        core,
        name,
        nameOverride: name,
        games: numberOr(source?.games),
      };
    })
    .filter((row) => row.name);
}

export function normalizeTraitBuildRows(variantId, rows = []) {
  const overrideRows = variantOverrideRows(variantId, rows);
  if (overrideRows) return overrideRows;

  const allowed = allowedCoreSetForVariant(variantId);
  const merged = new Map();

  for (const row of rows) {
    const name = normalizeCoreName(row);
    if (!name || !CURRENT_CORE_TRAIT_NAMES.has(name)) continue;
    if (allowed && !rowMatchesAllowedCore(row, allowed)) continue;

    const games = numberOr(row.games);
    if (games <= 0) continue;

    const key = name;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...row, name, games });
      continue;
    }

    const totalGames = previous.games + games;
    const weighted = (field) => {
      const a = numberOr(previous[field], 0);
      const b = numberOr(row[field], 0);
      return totalGames > 0 ? (a * previous.games + b * games) / totalGames : 0;
    };

    merged.set(key, {
      ...previous,
      core: previous.games >= games ? previous.core : row.core,
      name,
      games: totalGames,
      avgPlacement: weighted("avgPlacement"),
      winRate: weighted("winRate"),
      top3Rate: weighted("top3Rate"),
      avgDamageToPlayer: weighted("avgDamageToPlayer"),
      avgDamageToPlayerBasic: weighted("avgDamageToPlayerBasic"),
      avgDamageToPlayerSkill: weighted("avgDamageToPlayerSkill"),
      avgDamageToPlayerItemSkill: weighted("avgDamageToPlayerItemSkill"),
      avgDamageToPlayerDirect: weighted("avgDamageToPlayerDirect"),
      avgDamageToPlayerUniqueSkill: weighted("avgDamageToPlayerUniqueSkill"),
      basicDamageShare: weighted("basicDamageShare"),
      skillDamageShare: weighted("skillDamageShare"),
      uniqueSkillDamageShare: weighted("uniqueSkillDamageShare"),
      avgDamageFromPlayer: weighted("avgDamageFromPlayer"),
      avgDamageFromPlayerBasic: weighted("avgDamageFromPlayerBasic"),
      avgDamageFromPlayerSkill: weighted("avgDamageFromPlayerSkill"),
      avgCcTime: weighted("avgCcTime"),
      avgCcCount: weighted("avgCcCount"),
    });
  }

  return [...merged.values()].sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
}

export function topCoreRowsForVariant(variantId, rows = [], { limit = 3, minGames = 30 } = {}) {
  const normalized = normalizeTraitBuildRows(variantId, rows);
  if (!normalized.length) return [];

  const forced = allowedCoreSetForVariant(variantId);
  if (forced) return normalized.slice(0, limit);

  const topGames = normalized[0]?.games ?? 0;
  const threshold = Math.max(minGames, topGames * 0.12);
  return normalized
    .filter((row, index) => index === 0 || (row.games ?? 0) >= threshold)
    .slice(0, limit);
}

export function coreRowForVariant(variantId, rows = [], core = null) {
  const normalized = normalizeTraitBuildRows(variantId, rows);
  if (!normalized.length) return null;
  if (!core) return normalized[0];

  const wanted = String(core);
  return normalized.find((row) => String(row.core) === wanted || row.name === wanted) ?? normalized[0];
}
