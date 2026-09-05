/**
 * tournament_collector.mjs
 *
 * Collects esports tournament composition data from the dak.gg API.
 *
 * Usage:
 *   node tools/tournament_collector.mjs --ids 6960,6961,6963
 *   node tools/tournament_collector.mjs --range 6950-6980
 *   node tools/tournament_collector.mjs --ids 6960,6961,6963 --out data/tournament.json
 *
 * Output: JSON file with array of game records, each containing team compositions
 * and placements. Suitable for manual review or feeding into metaData.js.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const idsArg = getArg('--ids');
const rangeArg = getArg('--range');
const autoMode = args.includes('--auto');
const outArg = getArg('--out') ?? 'data/tournament_compositions.json';
const delayMs = parseInt(getArg('--delay') ?? '800', 10);
// How many consecutive 404s end an --auto scan. Tournament ids are not perfectly
// dense - the season-41 set skips 7691, 7694, 7696-7697 and so on - so stopping at
// the first miss would truncate the scan almost immediately.
const gapTolerance = parseInt(getArg('--gap') ?? '25', 10);

const outPathResolved = path.resolve(ROOT, outArg);
let existing = [];
if (fs.existsSync(outPathResolved)) {
  try { existing = JSON.parse(fs.readFileSync(outPathResolved, 'utf8')); } catch { existing = []; }
  if (!Array.isArray(existing)) existing = [];
}
const knownIds = new Set(existing.map(r => r.gameId));

let gameIds = [];
let autoStart = null;

if (idsArg) {
  gameIds = idsArg.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
} else if (rangeArg) {
  const [start, end] = rangeArg.split('-').map(Number);
  for (let i = start; i <= end; i++) gameIds.push(i);
} else if (autoMode) {
  // Resume from one past the highest id already collected and walk forward until
  // the ids run out. Nobody has to know or remember the current range.
  autoStart = (knownIds.size ? Math.max(...knownIds) : parseInt(getArg('--from') ?? '7690', 10) - 1) + 1;
} else {
  console.error('Usage: node tools/tournament_collector.mjs --auto | --ids 6960,6961 | --range 6950-6980');
  process.exit(1);
}

if (autoMode) {
  console.log(`Auto scan from ${autoStart} (have ${knownIds.size} games, ${existing.length} team rows), stopping after ${gapTolerance} consecutive misses`);
} else {
  console.log(`Fetching ${gameIds.length} game(s): ${gameIds.join(', ')}`);
}

// ── Fetch ────────────────────────────────────────────────────────────────────
async function fetchGame(id) {
  const url = `https://er.dakgg.io/api/v1/tournament/games?id=${id}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status} for game ${id}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Extract compositions from a game response ────────────────────────────────
function extractCompositions(data) {
  if (!data?.games?.length) return null;

  // Group players by teamNumber
  const teams = {};
  for (const p of data.games) {
    if (!teams[p.teamNumber]) {
      teams[p.teamNumber] = {
        teamNumber: p.teamNumber,
        players: [],
        gameRank: p.gameRank,
        gameId: p.gameId,
        matchingMode: p.matchingMode,
        // Without this the rows carry no season and nothing downstream can tell a
        // season-39 game from a season-41 one - which is how tournamentMeta.js came
        // to mix them silently.
        seasonId: p.seasonId,
        startDtm: p.startDtm ?? null,
      };
    }
    teams[p.teamNumber].players.push({
      userNum: p.userNum,
      nickname: p.nickname,
      characterNum: p.characterNum,
      playerKill: p.playerKill,
      playerAssistant: p.playerAssistant,
      gameRank: p.gameRank,
      tournamentRankScore: p.tournamentRankScore ?? 0,
      milliTournamentKillScore: p.milliTournamentKillScore ?? 0,
    });
  }

  // Build score lookup
  const scoreMap = {};
  for (const s of (data.scoreInfos ?? [])) {
    scoreMap[s.teamNumber] = s;
  }

  // Build composition records
  const compositions = [];
  for (const [, team] of Object.entries(teams)) {
    const chars = team.players
      .map(p => p.characterNum)
      .sort((a, b) => a - b); // normalize order

    const scoreInfo = scoreMap[team.teamNumber] ?? {};

    compositions.push({
      gameId: team.gameId,
      seasonId: team.seasonId,
      matchingMode: team.matchingMode,
      startDtm: team.startDtm,
      teamNumber: team.teamNumber,
      placement: team.gameRank,           // 1 = winner, 8 = last
      win: team.gameRank === 1 ? 1 : 0,
      top3: team.gameRank <= 3 ? 1 : 0,
      characterNums: chars,               // sorted array of 3 characterNums
      rankScore: scoreInfo.rankScore ?? 0,
      killScore: scoreInfo.killScore ?? 0,
      players: team.players.map(p => ({
        nickname: p.nickname,
        characterNum: p.characterNum,
        kills: p.playerKill,
        assists: p.playerAssistant,
      })),
    });
  }

  // Sort by placement
  compositions.sort((a, b) => a.placement - b.placement);
  return compositions;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const allResults = [];
  let fetched = 0;
  let skipped = 0;
  let errors = 0;

  // In --auto mode the list is not known up front: walk forward until the misses
  // pile up past the gap tolerance.
  let cursor = autoStart;
  let consecutiveMisses = 0;
  const idQueue = autoMode ? null : gameIds;

  for (let index = 0; ; index += 1) {
    let id;
    if (idQueue) {
      if (index >= idQueue.length) break;
      id = idQueue[index];
    } else {
      if (consecutiveMisses >= gapTolerance) break;
      id = cursor;
      cursor += 1;
    }
    process.stdout.write(`  Game ${id} ... `);
    try {
      const data = await fetchGame(id);
      if (!data) {
        console.log('not found (skipped)');
        skipped++;
        consecutiveMisses += 1;
      } else {
        consecutiveMisses = 0;
        const comps = extractCompositions(data);
        if (!comps) {
          console.log('no game data (skipped)');
          skipped++;
        } else {
          console.log(`OK — ${comps.length} teams`);
          allResults.push(...comps);
          fetched++;
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      errors++;
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(`\nSummary: ${fetched} games fetched, ${skipped} skipped, ${errors} errors`);
  console.log(`Total team records: ${allResults.length}`);

  // Print preview table
  if (allResults.length > 0) {
    console.log('\n── Composition preview ──────────────────────');
    console.log('GameID   Place  Win  Chars');
    for (const r of allResults.slice(0, 24)) {
      const chars = r.characterNums.join(', ');
      console.log(`${r.gameId}  #${r.placement}     ${r.win}    [${chars}]  (${r.players.map(p=>p.nickname).join(', ')})`);
    }
    if (allResults.length > 24) console.log(`  ... and ${allResults.length - 24} more`);
  }

  // Save output. --auto appends to what is already there; a full re-scan every
  // run would be pointless traffic and would lose games the API has since dropped.
  const outPath = outPathResolved;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const merged = autoMode ? [...existing, ...allResults.filter(r => !knownIds.has(r.gameId))] : allResults;
  merged.sort((a, b) => (a.gameId - b.gameId) || (a.placement - b.placement));
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf8");
  const gamesSaved = new Set(merged.map(r => r.gameId)).size;
  console.log("");
  console.log(`Saved to ${outPath}`);
  console.log(`  ${gamesSaved} games, ${merged.length} team rows` + (autoMode ? ` (was ${knownIds.size} games)` : ""));

  // Print aggregated win rates per composition (if multiple games)
  if (fetched > 1 && allResults.length > 0) {
    printAggregated(allResults);
  }
}

function printAggregated(records) {
  const compMap = {};
  for (const r of records) {
    const key = r.characterNums.join('-');
    if (!compMap[key]) compMap[key] = { chars: r.characterNums, games: 0, wins: 0, top3: 0, placements: [] };
    compMap[key].games++;
    compMap[key].wins += r.win;
    compMap[key].top3 += r.top3;
    compMap[key].placements.push(r.placement);
  }

  const comps = Object.values(compMap)
    .filter(c => c.games >= 2)
    .map(c => ({
      ...c,
      winRate: c.wins / c.games,
      top3Rate: c.top3 / c.games,
      avgPlacement: c.placements.reduce((s, p) => s + p, 0) / c.games,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);

  if (comps.length === 0) return;

  console.log('\n── Repeated compositions ────────────────────');
  console.log('Chars                  Games  Wins  WR%   Top3%  AvgPlace');
  for (const c of comps.slice(0, 20)) {
    console.log(
      `[${c.chars.join(',')}]`.padEnd(24) +
      `${c.games}      ${c.wins}     ${(c.winRate*100).toFixed(0)}%   ` +
      `${(c.top3Rate*100).toFixed(0)}%    ${c.avgPlacement.toFixed(1)}`
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
