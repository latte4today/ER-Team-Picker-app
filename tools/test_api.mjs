import { requireEnv } from "./env.mjs";

const apiKey = requireEnv("ER_API_KEY");
const BASE_URL = process.env.ER_API_BASE_URL?.trim() || "https://open-api.bser.io";
const headers = { "x-api-key": apiKey };
const REQUEST_DELAY_MS = Number(process.env.ER_REQUEST_INTERVAL_MS ?? 1300);
const RETRY_429_MS = Number(process.env.ER_RETRY_429_MS ?? 15000);

function maskSecret(value) {
  const text = String(value ?? "");
  if (text.length <= 12) return text ? "[redacted]" : "none";
  return `${text.slice(0, 6)}...${text.slice(-6)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_429_MS;
    console.log(`Rate limited on ${path}. Waiting ${Math.round(waitMs / 1000)}s before retry...`);
    await sleep(waitMs);
    const retryResponse = await fetch(`${BASE_URL}${path}`, { headers });
    const retryText = await retryResponse.text();
    let retryPayload;
    try {
      retryPayload = retryText ? JSON.parse(retryText) : {};
    } catch {
      retryPayload = { raw: retryText.slice(0, 500) };
    }
    await sleep(REQUEST_DELAY_MS);
    return { ok: retryResponse.ok, status: retryResponse.status, path, payload: retryPayload };
  }

  await sleep(REQUEST_DELAY_MS);
  return { ok: response.ok, status: response.status, path, payload };
}

function printSummary(label, result) {
  console.log(`${label}: ${result.status} ${result.ok ? "OK" : "FAILED"} ${result.path}`);
}

function getRankRows(payload) {
  return (
    payload?.topRanks ??
    payload?.userRankList ??
    payload?.ranks ??
    payload?.rankers ??
    payload?.data?.topRanks ??
    payload?.data?.userRankList ??
    payload?.data?.ranks ??
    []
  );
}

function getUserId(row) {
  return (
    row?.userId ??
    row?.user_id ??
    row?.uid ??
    row?.user?.userId ??
    row?.user?.user_id ??
    row?.userInfo?.userId ??
    row?.userInfo?.user_id ??
    row?.userInfo?.user?.userId ??
    row?.userInfo?.user?.user_id ??
    row?.matchingUser?.userId ??
    row?.matchingUser?.user_id
  );
}

function getNickname(row) {
  return (
    row?.nickname ??
    row?.nickName ??
    row?.user?.nickname ??
    row?.userInfo?.nickname ??
    row?.userInfo?.user?.nickname ??
    row?.matchingUser?.nickname
  );
}

function firstObjectWithUserId(value) {
  if (!value || typeof value !== "object") return undefined;
  if (getUserId(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstObjectWithUserId(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const item of Object.values(value)) {
    const found = firstObjectWithUserId(item);
    if (found) return found;
  }
  return undefined;
}

async function lookupUserByNickname(nickname) {
  const encoded = encodeURIComponent(nickname);
  const candidates = [
    `/v1/user/nickname?query=${encoded}`,
    `/v1/user/nickname/${encoded}`,
    `/v1/user?nickname=${encoded}`,
  ];

  for (const path of candidates) {
    const result = await getJson(path);
    printSummary(`Nickname lookup`, result);
    if (!result.ok) continue;

    const userObject = firstObjectWithUserId(result.payload);
    const userId = getUserId(userObject);
    console.log(`Nickname payload keys: ${Object.keys(result.payload ?? {}).join(", ") || "none"}`);
    console.log(`Nickname user preview: ${JSON.stringify(compactPreview(userObject))}`);
    if (userId) return { userId, result, userObject };
  }
  return undefined;
}

function compactPreview(value, depth = 0) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => compactPreview(item, depth + 1));
  const entries = Object.entries(value).slice(0, depth > 1 ? 8 : 16);
  return Object.fromEntries(entries.map(([key, item]) => [key, compactPreview(item, depth + 1)]));
}

function pickFields(row, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => row && Object.prototype.hasOwnProperty.call(row, key))
      .map((key) => [key, row[key]]),
  );
}

async function findRankEndpoint() {
  for (let season = 40; season >= 1; season -= 1) {
    const v2 = await getJson(`/v2/rank/top/${season}/SEOUL/3`);
    if (v2.ok && getRankRows(v2.payload).length > 0) {
      return { season, teamMode: 3, server: "SEOUL", endpoint: "v2", result: v2 };
    }

    const v1 = await getJson(`/v1/rank/top/${season}/3`);
    if (v1.ok && getRankRows(v1.payload).length > 0) {
      return { season, teamMode: 3, endpoint: "v1", result: v1 };
    }
  }
  return undefined;
}

const dataResult = await getJson("/v1/data/Character");
printSummary("Character data", dataResult);

const rankInfo = await findRankEndpoint();
if (!rankInfo) {
  throw new Error("Could not find a working rank endpoint for recent seasons.");
}

printSummary(`Rank top season ${rankInfo.season}`, rankInfo.result);
const rankRows = getRankRows(rankInfo.result.payload);
const firstRanker = rankRows[0];
let firstUserId = getUserId(firstRanker);
const firstNickname = getNickname(firstRanker);
console.log(`Rank payload keys: ${Object.keys(rankInfo.result.payload ?? {}).join(", ") || "none"}`);
console.log(`Rank rows returned: ${rankRows.length}`);
console.log(`First ranker preview: ${JSON.stringify(compactPreview(firstRanker))}`);
console.log(`First ranker nickname: ${firstNickname ?? "none"}`);

if (!firstUserId && firstNickname) {
  const lookup = await lookupUserByNickname(firstNickname);
  firstUserId = lookup?.userId;
}

console.log(`First ranker userId: ${firstUserId ? maskSecret(firstUserId) : "none"}`);

if (firstUserId) {
  const gamesResult = await getJson(`/v1/user/games/uid/${encodeURIComponent(firstUserId)}`);
  printSummary("User games", gamesResult);
  const games = gamesResult.payload?.userGames ?? gamesResult.payload?.games ?? [];
  console.log(`Recent games returned: ${games.length}`);
  if (games[0]) {
    const preview = {
      gameId: games[0].gameId ?? games[0].game_id,
      seasonId: games[0].seasonId ?? games[0].season_id,
      matchingTeamMode: games[0].matchingTeamMode ?? games[0].matching_team_mode,
      characterNum: games[0].characterNum ?? games[0].character_num,
      gameRank: games[0].gameRank ?? games[0].game_rank,
    };
    console.log(`First game preview: ${JSON.stringify(preview)}`);

    if (preview.gameId) {
      const gameResult = await getJson(`/v1/games/${preview.gameId}`);
      printSummary("Game detail", gameResult);
      console.log(`Game detail keys: ${Object.keys(gameResult.payload ?? {}).join(", ") || "none"}`);
      const gameRows =
        gameResult.payload?.userGames ??
        gameResult.payload?.games ??
        gameResult.payload?.gameDetails ??
        gameResult.payload?.data ??
        [];
      const firstGameRow = Array.isArray(gameRows) ? gameRows[0] : gameRows;
      console.log(`Game detail first row keys: ${Object.keys(firstGameRow ?? {}).join(", ") || "none"}`);
      console.log(
        `Game detail relevant fields: ${JSON.stringify(
          pickFields(firstGameRow, [
            "matchingMode",
            "matchingTeamMode",
            "teamNumber",
            "teamId",
            "gameRank",
            "characterNum",
            "bestWeapon",
            "damageToPlayer",
            "damageFromPlayer",
            "ccCount",
            "ccTime",
            "crowdControlCount",
            "crowdControlTime",
            "traitFirstCore",
            "traitFirstSub",
            "traitSecondSub",
            "tacticalSkillGroup",
            "tacticalSkill",
            "skillOrderInfo",
          ]),
        )}`,
      );
      console.log(`Game detail first row preview: ${JSON.stringify(compactPreview(firstGameRow))}`);
    }
  }
}
