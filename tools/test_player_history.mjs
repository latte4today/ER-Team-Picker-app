import assert from "node:assert/strict";
import playerHistoryApi from "../api/player-history.js";
import { addSquadResult, personalPickEvidence, playerComparisonSeason, recentSquadGames, summarizePlayerMatches } from "../src/playerHistory.js";
import { officialGameCursor, officialGameRows, officialUserId } from "../src/officialApiResponse.js";

assert.equal(officialUserId({ user: { uid: "documented" } }), "documented");
assert.equal(officialUserId({ user: { userNum: 12 } }), undefined);
assert.deepEqual(officialGameRows({ data: { userGames: [] } }), []);
assert.equal(officialGameCursor({ data: { next: 1234 } }), "1234");
assert.equal(officialGameCursor({ next: 0 }), null);

globalThis.localStorage = { getItem: () => null };
globalThis.document = { documentElement: { lang: "ko", dataset: {} } };
const { recommend } = await import("../src/recommender.js");

const now = Date.now();
const match = (gameId, overrides = {}) => ({
  gameId, matchingMode: 3, matchingTeamMode: 3, seasonId: 42,
  characterNum: 41, bestWeapon: 24, gameRank: 2, startDtm: new Date(now).toISOString(),
  ...overrides,
});
const matches = [
  ...Array.from({ length: 20 }, (_, i) => match(i + 1, { teamNumber: i < 3 ? 1 : undefined })),
  match(21, { matchingMode: 2, characterNum: 2, bestWeapon: 9 }),
  match(22, { characterNum: 2, bestWeapon: 11 }),
  match(23, { matchingMode: 6 }),
  match(24, { bestWeapon: 25 }),
  match(25, { startDtm: new Date(now - 91 * 86_400_000).toISOString() }),
  match(26, { characterNum: 27, bestWeapon: 15 }),
  ...Array.from({ length: 20 }, (_, i) => match(31 + i, { characterNum: 69, bestWeapon: 9, gameRank: 7 })),
  match(1),
];
const profile = summarizePlayerMatches(matches, now);
assert.equal(profile.rankedGames, 42);
assert.equal(profile.normalGames, 1);
assert.deepEqual(profile.variants.map(({ variantId }) => variantId), [
  "johann:arcana", "aya:pistol", "aya:sniper_rifle", "alex:flex", "leni:pistol",
]);

const teammates = ["alonso:glove", "nia:pistol"];
const source = { seasonId: 42, matchingMode: 3 };
const currentSeason = playerComparisonSeason({ phase: "ranked", seasonId: 42 }, source);
const previousSeason = playerComparisonSeason({ phase: "preseason", seasonId: 43 }, source);
assert.equal(playerComparisonSeason({ phase: "ranked", seasonId: 43 }, source), null);
assert.equal(playerComparisonSeason({ phase: "ranked", seasonId: 42 }, { ...source, priorSeasonWeight: 0.25 }), null);
const average = { games: 500, top3Rate: 0.4, winRate: 0.13, avgPlacement: 4.5 };
const baselines = { "johann:arcana": average, "leni:pistol": average, "aya:sniper_rifle": average, "adina:arcana": average };
const current = personalPickEvidence(profile, currentSeason, baselines);
const previous = personalPickEvidence(profile, previousSeason, baselines);
assert.ok(current.get("johann:arcana").bonus > previous.get("johann:arcana").bonus);
assert.ok(current.get("leni:pistol").bonus < 0);
assert.equal(current.get("aya:sniper_rifle").bonus, 0);
assert.equal(current.has("adina:arcana"), false);
assert.equal(personalPickEvidence(profile, currentSeason, {}).get("leni:pistol").bonus, 0);

const squadRows = (gameId) => [
  match(gameId, { teamNumber: 1, nickname: "hidden-a" }),
  match(gameId, { teamNumber: 1, characterNum: 68, bestWeapon: 1, nickname: "hidden-b" }),
  match(gameId, { teamNumber: 1, characterNum: 81, bestWeapon: 9, nickname: "hidden-c" }),
  match(gameId, { teamNumber: 2 }),
];
const records = new Map();
const sample = recentSquadGames(matches, 42, 8, now);
assert.deepEqual(sample.map(({ gameId }) => gameId), [3, 2, 1]);
assert.equal(addSquadResult(records, sample[0], squadRows(3).slice(1)), false);
for (const game of sample) assert.equal(addSquadResult(records, game, squadRows(game.gameId)), true);
const withSquads = { ...profile, squads: { seasonId: 42, entries: [...records.values()] } };
const teamBaselines = [{ ...average, candidate: teammates[1], teammates: ["johann:arcana", teammates[0]] }];
const matching = personalPickEvidence(withSquads, currentSeason, baselines, teamBaselines, [...teammates].reverse());
assert.equal(matching.get("johann:arcana").squad.games, 3);
assert.ok(matching.get("johann:arcana").bonus > current.get("johann:arcana").bonus);
const missingTeam = personalPickEvidence(withSquads, currentSeason, baselines, teamBaselines, ["alonso:glove", "aya:pistol"]);
assert.equal(missingTeam.get("johann:arcana").squad, null);
const weakTeam = { ...withSquads, squads: { seasonId: 42, entries: withSquads.squads.entries.map((row) => ({ ...row, top3: 0, placement: 24 })) } };
assert.ok(personalPickEvidence(weakTeam, currentSeason, {}, teamBaselines, teammates).get("johann:arcana").bonus < 0);

const recommendations = (evidence, pool) => recommend(teammates, "all", {}, pool, [], {}, {
  playerEvidence: evidence, limit: 8, includeAlternates: false, includeReasons: false,
});
const before = recommendations();
const after = recommendations(previous);
const rankOf = (rows, id) => rows.findIndex(({ character }) => character.variantId === id);
assert.ok(rankOf(after, "johann:arcana") < rankOf(before, "johann:arcana"));
assert.ok(rankOf(after, "leni:pistol") > rankOf(before, "leni:pistol") || rankOf(after, "leni:pistol") < 0);
const byVariant = new Map(before.map((row) => [row.character.variantId, row]));
for (const row of after) {
  if (byVariant.has(row.character.variantId)) assert.equal(row.total, byVariant.get(row.character.variantId).total);
}
assert.ok(recommendations(previous, ["leni:pistol"]).every(({ character }) => character.variantId === "leni:pistol"));

const apiUrl = "http://localhost/api/player-history";
const request = (nickname, origin, comparisonSeason) => new Request(apiUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
  body: JSON.stringify({ nickname, comparisonSeason }),
});
const providedKey = process.env.ER_API_KEY;
const originalFetch = globalThis.fetch;
try {
  delete process.env.ER_API_KEY;
  assert.deepEqual(await (await playerHistoryApi.fetch(new Request(apiUrl))).json(), { enabled: false });
  assert.equal((await playerHistoryApi.fetch(request("프로필"))).status, 503);
  process.env.ER_API_KEY = "fixture-only";
  assert.deepEqual(await (await playerHistoryApi.fetch(new Request(apiUrl))).json(), { enabled: true });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(options.headers["x-api-key"], "fixture-only");
    const path = new URL(url);
    if (path.pathname === "/v1/user/nickname") {
      if (path.searchParams.get("query") === "unknown") return Response.json({ code: 404 }, { status: 404 });
      if (path.searchParams.get("query") === "no-id") return Response.json({ code: 200, user: {} });
      assert.equal(path.searchParams.get("query"), "프로필+1");
      return Response.json({ code: 200, user: { userId: "fixture-uid" } });
    }
    if (path.pathname === "/v1/user/games/uid/fixture-uid") {
      if (!path.searchParams.has("next")) return Response.json({ code: 200, data: { games: matches.slice(0, 10), next: 31 } });
      assert.equal(path.searchParams.get("next"), "31");
      return Response.json({ code: 200, userGames: matches.slice(10), next: 31 });
    }
    const gameId = Number(path.pathname.split("/").at(-1));
    assert.equal(path.pathname, `/v1/games/${gameId}`);
    return Response.json({ code: 200, userGames: squadRows(gameId) });
  };
  assert.equal((await playerHistoryApi.fetch(request(" "))).status, 400);
  assert.equal((await playerHistoryApi.fetch(request("프로필", "https://other.example"))).status, 403);
  const response = await playerHistoryApi.fetch(request("프로필+1", "http://127.0.0.1:34579", 42));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:34579");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const summary = await response.json();
  assert.equal(summary.rankedGames, profile.rankedGames);
  assert.equal(Object.hasOwn(summary, "uid"), false);
  assert.equal(summary.squads.inspected, 3);
  assert.equal(summary.squads.entries[0].games, 3);
  assert.doesNotMatch(JSON.stringify(summary), /hidden-|fixture-uid/);
  assert.equal(calls, 6);
  assert.equal((await playerHistoryApi.fetch(request("unknown"))).status, 404);
  assert.equal((await playerHistoryApi.fetch(request("no-id"))).status, 502);
} finally {
  globalThis.fetch = originalFetch;
  if (providedKey === undefined) delete process.env.ER_API_KEY;
  else process.env.ER_API_KEY = providedKey;
}

console.log("Player history filtering, season weighting, draft reranking, and API error handling passed.");
