/**
 * backtest_recommender.mjs
 * 추천기 검증 하니스 — "이긴 팀의 실제 멤버가 추천 상위에 오는가"를 실제 매치로 측정.
 *
 * 방식: hold-one-out
 *   실제 3인 팀 [A,B,C] 에서 한 명(C)을 가리고 recommend([A,B]) 실행 →
 *   추천 리스트에서 실제 C 의 순위를 기록. (3개 포지션 모두 번갈아 hold-out)
 *   좋은 추천기라면 "이긴 팀"의 가려진 멤버가 상위에 와야 한다.
 *
 * 지표: MRR(평균 역순위), hit@3, hit@12, found%  —  승/패(isWin)·티어별 분리.
 * 비교: 같은 시행에 대해 세 설정을 paired 로 돌린다.
 *   - legacy : enableCharacterVector=off, diversity=off
 *   - vector : enableCharacterVector=on,  diversity=off
 *   - shipped: enableCharacterVector=on,  diversity=on   (현재 0.3.3)
 *
 * 핵심 읽기: 승률/등수는 메타·실력에 오염 → 절대값이 아니라 (a) win vs loss 격차,
 *           (b) 같은 시행에서 config 간 상대 비교로 본다.
 *
 * Usage:
 *   node tools/backtest_recommender.mjs --data "<matches.jsonl 경로>" --sample 500
 *   node tools/backtest_recommender.mjs --data ... --sample 800 --scan 60000 --tier all --seed 7
 *   옵션:
 *     --data   matches-*.jsonl 경로 (필수)  예: collected-official-data/data/ml-training/matches-current-*.jsonl
 *     --sample 분석할 팀 수 (기본 500)
 *     --scan   jsonl에서 스캔할 최대 라인 수 (기본 80000; 클수록 대표성↑·시간↑)
 *     --tier   recommend에 넘길 tier ("all" 기본) / "team"이면 팀의 tierBucket 사용
 *     --configs  쉼표구분 (기본 "legacy,vector,shipped")
 *     --seed   샘플링 RNG 시드 (기본 1)
 *
 * 주의: 로컬에서만 실행. 샌드박스 마운트 사본은 잘려 신뢰 불가.
 *       이 스크립트는 추천 점수/데이터를 수정하지 않는다(읽기 전용 측정).
 */

const _store = {};
globalThis.localStorage = { getItem:(k)=>_store[k]??null, setItem:(k,v)=>{_store[k]=String(v);}, removeItem:(k)=>{delete _store[k];} };
globalThis.document = { documentElement: { lang: "ko" } };

import fs from "node:fs";
import readline from "node:readline";
import { recommend, evaluateCandidate, VECTOR_SCORING_FLAGS, DIVERSITY_CONFIG } from "../src/recommender.js";

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DATA = opt("--data", null);
const SAMPLE = Number(opt("--sample", 500));
const SCAN = Number(opt("--scan", 80000));
const TIER = opt("--tier", "all");
const SEED = Number(opt("--seed", 1));
const METRIC = opt("--metric", "teamscore"); // teamscore | retrieval | both | concordance. 0.3.4 주 지표는 concordance(로비통제).
const CONFIGS = opt("--configs", "legacy,vector,empirical,shipped,lean").split(",").map((s) => s.trim());
const GAMES = Number(opt("--games", 800));       // concordance: 샘플할 게임(로비) 수
const MIN_TEAMS = Number(opt("--min-teams", 4)); // concordance: 게임당 최소 팀 수
const CONTROL = !argv.includes("--no-control");  // concordance: 양성대조(solo top3합) 포함
const TEAM_TIER = opt("--team-tier", null); // 팀 tierBucket 필터 (쉼표구분). 예: demigod_eternity 또는 meteor_mithril,demigod_eternity
const TEAM_TIER_SET = TEAM_TIER ? new Set(TEAM_TIER.split(",").map((s) => s.trim())) : null;
const TIER_ORDER = ["iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"]; // 저→고

if (!DATA || !fs.existsSync(DATA)) {
  console.error("`--data <matches.jsonl 경로>` 가 필요합니다 (존재하는 파일).");
  console.error("예: node tools/backtest_recommender.mjs --data \"C:/Users/WIN11/Desktop/ER/collected-official-data/data/ml-training/matches-current-20260617T051948Z.jsonl\" --sample 500");
  process.exit(1);
}

// ---------- seeded RNG (mulberry32) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// ---------- config toggling ----------
// 세 축을 명시적으로 제어: enableCharacterVector / useEmpiricalVectorBlend / diversity.
//   legacy    : vector off                      (순수 legacy)
//   vector    : vector on,  empirical off        (수동 ROLE_SEED만)
//   empirical : vector on,  empirical on(0.70)   (데이터 실측 벡터 블렌딩)
//   shipped   : vector on,  empirical on, +다양성 (현재 0.3.3 라이브)
// 주의: 다양성은 recommend 후처리라 teamscore(evaluateCandidate)엔 영향 없음 → teamscore에선 shipped≡empirical.
function applyConfig(name) {
  const F = VECTOR_SCORING_FLAGS, D = DIVERSITY_CONFIG;
  switch (name) {
    case "legacy":    F.enableCharacterVector = false; F.useEmpiricalVectorBlend = false; F.usePairSynergyLift = false; F.useLeanScoring = false; D.enabled = false; break;
    case "vector":    F.enableCharacterVector = true;  F.useEmpiricalVectorBlend = false; F.usePairSynergyLift = false; F.useLeanScoring = false; D.enabled = false; break;
    case "empirical": F.enableCharacterVector = true;  F.useEmpiricalVectorBlend = true;  F.usePairSynergyLift = false; F.useLeanScoring = false; D.enabled = false; break;
    case "shipped":   F.enableCharacterVector = true;  F.useEmpiricalVectorBlend = true;  F.usePairSynergyLift = true;  F.useLeanScoring = false; D.enabled = true;  break;
    case "lean":      F.enableCharacterVector = true;  F.useEmpiricalVectorBlend = true;  F.usePairSynergyLift = true;  F.useLeanScoring = true;  D.enabled = true;  break;
    default: throw new Error("unknown config: " + name);
  }
}

// ---------- reservoir sample teams (3인, 유효) ----------
async function sampleTeams() {
  const rl = readline.createInterface({ input: fs.createReadStream(DATA), crlfDelay: Infinity });
  const res = [];
  let scanned = 0, seen = 0;
  for await (const line of rl) {
    if (++scanned > SCAN) break;
    if (!line) continue;
    let t;
    try { t = JSON.parse(line); } catch { continue; }
    const members = t.members;
    if (!Array.isArray(members) || members.length !== 3) continue;
    if (!members.every((m) => m && m.variantId)) continue;
    // distinct characterIds (recommend는 같은 characterId 중복 후보를 거름)
    const cids = new Set(members.map((m) => m.characterId));
    if (cids.size !== 3) continue;
    if (TEAM_TIER_SET && !TEAM_TIER_SET.has(t.tierBucket)) continue; // 팀 티어 필터
    seen++;
    // reservoir
    if (res.length < SAMPLE) res.push(t);
    else { const j = Math.floor(rng() * seen); if (j < SAMPLE) res[j] = t; }
  }
  rl.close();
  return { teams: res, scanned: Math.min(scanned, SCAN), eligible: seen };
}

// ---------- metric accumulator ----------
function newAcc() { return { n: 0, found: 0, rr: 0, h3: 0, h12: 0 }; }
function record(acc, rank, found) {
  acc.n++;
  if (found) { acc.found++; acc.rr += 1 / rank; if (rank <= 3) acc.h3++; if (rank <= 12) acc.h12++; }
}
function summarize(acc) {
  const n = acc.n || 1;
  return { n: acc.n, mrr: acc.rr / n, hit3: acc.h3 / n, hit12: acc.h12 / n, found: acc.found / n };
}

// ---------- teamscore metric (실제 3인 팀 전체를 점수화) ----------
// teamScore = mean( evaluateCandidate(A|B+C), evaluateCandidate(B|A+C), evaluateCandidate(C|A+B) )
function computeTeamScore(ids, tier) {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const sel = ids.filter((_, k) => k !== i);
    const r = evaluateCandidate(sel, ids[i], tier, {}, [], {});
    s += r?.total ?? 0;
  }
  return s / 3;
}

// --- 통계 ---
function mean(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
function std(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / ((a.length - 1) || 1)); }
function cohensD(a, b) {
  const na = a.length, nb = b.length, sa = std(a), sb = std(b);
  const sp = Math.sqrt(((na - 1) * sa * sa + (nb - 1) * sb * sb) / ((na + nb - 2) || 1));
  return sp > 0 ? (mean(a) - mean(b)) / sp : 0;
}
function rankify(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const rr = (i + j + 2) / 2; for (let k = i; k <= j; k++) r[idx[k][1]] = rr; i = j + 1; }
  return r;
}
// AUC = P(score_win > score_loss) via Mann–Whitney rank-sum (pairwise accuracy)
function aucScore(pos, neg) {
  const all = pos.map((v) => [v, 1]).concat(neg.map((v) => [v, 0]));
  all.sort((x, y) => x[0] - y[0]);
  const ranks = new Array(all.length);
  let i = 0;
  while (i < all.length) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const rr = (i + j + 2) / 2; for (let k = i; k <= j; k++) ranks[k] = rr; i = j + 1; }
  let sumPos = 0; for (let k = 0; k < all.length; k++) if (all[k][1] === 1) sumPos += ranks[k];
  const np = pos.length, nn = neg.length;
  return np && nn ? (sumPos - np * (np + 1) / 2) / (np * nn) : 0.5;
}
function spearman(x, y) {
  const pairs = []; for (let i = 0; i < x.length; i++) if (y[i] != null) pairs.push([x[i], y[i]]);
  if (pairs.length < 3) return 0;
  const rx = rankify(pairs.map((p) => p[0])), ry = rankify(pairs.map((p) => p[1]));
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return (dx > 0 && dy > 0) ? num / Math.sqrt(dx * dy) : 0;
}

function runTeamscore(teams) {
  const data = {};
  for (const c of CONFIGS) data[c] = { scores: [], wins: [], plc: [], tier: {} };
  let done = 0;
  for (const t of teams) {
    const ids = t.members.map((m) => m.variantId);
    const isWin = !!t.result?.isWin;
    const plc = t.result?.placement ?? null;
    const bucket = t.tierBucket ?? "unknown";
    const tier = TIER === "team" ? (t.tierBucket ?? "all") : TIER;
    for (const c of CONFIGS) {
      applyConfig(c);
      const sc = computeTeamScore(ids, tier);
      const D = data[c];
      D.scores.push(sc); D.wins.push(isWin); D.plc.push(plc);
      const tb = D.tier[bucket] ?? (D.tier[bucket] = { scores: [], wins: [], plc: [] });
      tb.scores.push(sc); tb.wins.push(isWin); tb.plc.push(plc);
    }
    if (++done % 200 === 0) process.stderr.write(`  teamscore ...${done}/${teams.length}\r`);
  }
  process.stderr.write("\n");

  const line = (label, scores, wins, plc) => {
    const win = scores.filter((_, i) => wins[i]);
    const loss = scores.filter((_, i) => !wins[i]);
    if (win.length < 5 || loss.length < 5) { console.log(`   ${label.padEnd(17)} (표본부족 win=${win.length} loss=${loss.length})`); return; }
    const mw = mean(win), ml = mean(loss), d = cohensD(win, loss), auc = aucScore(win, loss);
    const rho = spearman(scores, plc.map((p) => (p == null ? null : -p))); // placement 작을수록 좋음 → 부호반전(양수=좋음)
    console.log(`   ${label.padEnd(17)} meanW=${mw.toFixed(2)} meanL=${ml.toFixed(2)} Δ=${(mw - ml).toFixed(2).padStart(6)}  d=${d.toFixed(3).padStart(6)}  AUC=${auc.toFixed(3)}  ρ(plc)=${rho.toFixed(3).padStart(6)}  (win=${win.length} loss=${loss.length})`);
  };

  console.log("=== TEAMSCORE: 이긴 조합이 진 조합보다 높게 점수되는가 ===");
  console.log("   Δ=win−loss평균,  d=Cohen's d(효과크기),  AUC=win>loss 판별(0.5=무신호),  ρ(plc)=등수와 Spearman(양수=좋음)\n");
  for (const c of CONFIGS) {
    console.log(`■ config=${c}`);
    line("overall", data[c].scores, data[c].wins, data[c].plc);
    const tiers = Object.keys(data[c].tier).sort((a, b) => (TIER_ORDER.indexOf(a) + 1 || 99) - (TIER_ORDER.indexOf(b) + 1 || 99));
    for (const tb of tiers) line(tb, data[c].tier[tb].scores, data[c].tier[tb].wins, data[c].tier[tb].plc);
    console.log("");
  }
  console.log("읽기: config 간 '델타'로 조합 로직 기여를 봄(절대 AUC는 승률항 때문에 부풀려짐).");
  console.log("핵심: 고티어 demigod_eternity 에서 AUC/d 가 legacy→vector→empirical 로 오르면 = 데이터 방향이 실제로 기여.");
  console.log("(teamscore에선 diversity 무관 → shipped ≡ empirical)\n");
}

// ---------- lobby concordance (게임 단위, 매치업 통제) ----------
// 같은 gameId(로비)의 모든 팀을 묶어, 더 높은 등수의 팀을 더 높게 점수했는지 쌍 비교.
// 로비 강약·매치업·서클 RNG가 쌍 안에서 상쇄됨 → isWin 절대 라벨보다 훨씬 민감.
async function sampleGames() {
  const rl = readline.createInterface({ input: fs.createReadStream(DATA), crlfDelay: Infinity });
  const byGame = new Map();   // gameId -> { tier, teams:[{ids, plc, win}] }
  const vstat = new Map();    // variant -> { g, top3 }  (양성대조용 캐릭터 강함)
  let scanned = 0;
  for await (const line of rl) {
    if (++scanned > SCAN) break;
    if (!line) continue;
    let t; try { t = JSON.parse(line); } catch { continue; }
    const m = t.members;
    if (!Array.isArray(m) || m.length !== 3 || !m.every((x) => x && x.variantId)) continue;
    if (new Set(m.map((x) => x.characterId)).size !== 3) continue;
    const plc = t.result?.placement;
    if (plc == null) continue;
    const ids = m.map((x) => x.variantId);
    const isTop3 = !!t.result?.isTop3;
    for (const id of ids) { const v = vstat.get(id) || { g: 0, top3: 0 }; v.g++; if (isTop3) v.top3++; vstat.set(id, v); }
    const gid = String(t.gameId);
    let g = byGame.get(gid);
    if (!g) { g = { tier: t.tierBucket ?? "unknown", teams: [] }; byGame.set(gid, g); }
    g.teams.push({ ids, plc, win: !!t.result?.isWin });
  }
  rl.close();
  const pool = [];
  for (const g of byGame.values()) {
    if (g.teams.length < MIN_TEAMS) continue;
    if (TEAM_TIER_SET && !TEAM_TIER_SET.has(g.tier)) continue;
    pool.push(g);
  }
  const res = []; let seen = 0;
  for (const g of pool) { seen++; if (res.length < GAMES) res.push(g); else { const j = Math.floor(rng() * seen); if (j < GAMES) res[j] = g; } }
  const vtop3 = new Map();
  for (const [id, v] of vstat) vtop3.set(id, v.g > 0 ? v.top3 / v.g : 0);
  return { games: res, vtop3, scanned: Math.min(scanned, SCAN), eligibleGames: pool.length, totalGames: byGame.size };
}

function runConcordance({ games, vtop3, scanned, eligibleGames, totalGames }) {
  console.log(`# backtest  metric=concordance  data=${DATA.split(/[\\/]/).pop()}`);
  console.log(`# scanned=${scanned} totalGames=${totalGames} eligibleGames(>=${MIN_TEAMS}팀)=${eligibleGames} sampledGames=${games.length} teamTier=${TEAM_TIER ?? "all"} seed=${SEED}`);
  const dist = {}; for (const g of games) dist[g.tier] = (dist[g.tier] ?? 0) + 1;
  console.log(`# 샘플 게임 티어 분포: ${Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  console.log(`# configs=${CONFIGS.join(", ")}${CONTROL ? " (+ control=멤버 solo top3율 합)" : ""}\n`);

  const names = [...CONFIGS, ...(CONTROL ? ["control"] : [])];
  const acc = {}; for (const n of names) acc[n] = { all: { c: 0, p: 0 }, tier: {} };
  const addPair = (node, sBetter, sWorse) => { node.p++; if (sBetter > sWorse) node.c += 1; else if (sBetter === sWorse) node.c += 0.5; };

  let done = 0;
  for (const g of games) {
    const tier = TIER === "team" ? g.tier : TIER;
    for (const n of names) {
      if (n !== "control") applyConfig(n);
      const scores = g.teams.map((tm) => n === "control"
        ? tm.ids.reduce((s, id) => s + (vtop3.get(id) ?? 0), 0) / 3
        : computeTeamScore(tm.ids, tier));
      const A = acc[n];
      const T = A.tier[g.tier] ?? (A.tier[g.tier] = { c: 0, p: 0 });
      for (let i = 0; i < g.teams.length; i++) for (let j = i + 1; j < g.teams.length; j++) {
        const pi = g.teams[i].plc, pj = g.teams[j].plc;
        if (pi === pj) continue;
        const sBetter = pi < pj ? scores[i] : scores[j];
        const sWorse = pi < pj ? scores[j] : scores[i];
        addPair(A.all, sBetter, sWorse); addPair(T, sBetter, sWorse);
      }
    }
    if (++done % 100 === 0) process.stderr.write(`  concordance ...${done}/${games.length}\r`);
  }
  process.stderr.write("\n");

  const f3 = (x) => x.toFixed(3);
  console.log("=== LOBBY CONCORDANCE: 같은 게임 내 더 높은 등수 팀을 더 높게 점수하나 (0.5=무신호) ===");
  console.log("   매치업·로비강약·서클RNG가 쌍비교에서 상쇄됨. config 간 델타로 조합로직 기여를 봄.\n");
  for (const n of names) {
    const A = acc[n];
    console.log(`■ ${n}`);
    console.log(`   overall          conc=${f3(A.all.p ? A.all.c / A.all.p : 0.5)}  pairs=${A.all.p}`);
    const tiers = Object.keys(A.tier).sort((a, b) => (TIER_ORDER.indexOf(a) + 1 || 99) - (TIER_ORDER.indexOf(b) + 1 || 99));
    for (const tb of tiers) { const T = A.tier[tb]; console.log(`   ${tb.padEnd(16)} conc=${f3(T.p ? T.c / T.p : 0.5)}  pairs=${T.p}`); }
    console.log("");
  }
  console.log("읽기: control(캐릭터 강함)이 0.5보다 뚜렷이 높으면 = 하니스/데이터가 신호를 잡는다는 양성대조(통과).");
  console.log("핵심: legacy→vector→empirical 가 오르면 조합로직 기여. 모두 ~0.50이고 control보다 낮으면, 조합은 로비순위도 거의 예측 못함.");
}

// ---------- run ----------
if (METRIC === "concordance") {
  runConcordance(await sampleGames());
  process.exit(0);
}
const { teams, scanned, eligible } = await sampleTeams();
console.log(`# backtest  metric=${METRIC}  data=${DATA.split(/[\\/]/).pop()}`);
console.log(`# scanned=${scanned} eligible3man=${eligible} sampled=${teams.length} tier=${TIER} teamTier=${TEAM_TIER ?? "all"} seed=${SEED}`);
{
  const dist = {};
  for (const t of teams) dist[t.tierBucket ?? "unknown"] = (dist[t.tierBucket ?? "unknown"] ?? 0) + 1;
  console.log(`# 샘플 티어 분포: ${Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ")}`);
}
console.log(`# configs=${CONFIGS.join(", ")}\n`);

// ===== 0.3.4 주 지표: teamscore =====
if (METRIC === "teamscore" || METRIC === "both") runTeamscore(teams);

// ===== 보조 지표: retrieval (hold-one-out) =====
if (METRIC === "retrieval" || METRIC === "both") {
// acc[config] = { all, win, loss, top3, nontop3 }
const acc = {};
for (const c of CONFIGS) acc[c] = { all: newAcc(), win: newAcc(), loss: newAcc(), top3: newAcc(), nontop3: newAcc(), tier: {} };

let done = 0;
for (const t of teams) {
  const ids = t.members.map((m) => m.variantId);
  const cids = t.members.map((m) => m.characterId);
  const isWin = !!t.result?.isWin;
  const isTop3 = !!t.result?.isTop3;
  const bucket = t.tierBucket ?? "unknown";
  const tier = TIER === "team" ? (t.tierBucket ?? "all") : TIER;

  for (let i = 0; i < 3; i++) {
    const selected = ids.filter((_, k) => k !== i);
    const targetVid = ids[i];
    const targetCid = cids[i];

    for (const c of CONFIGS) {
      applyConfig(c);
      const recs = recommend(selected, tier, {});
      // rank: variantId 우선, 없으면 characterId 매칭
      let rank = recs.findIndex((r) => r.character.variantId === targetVid);
      if (rank < 0) rank = recs.findIndex((r) => r.character.characterId === targetCid);
      const found = rank >= 0;
      const rk = found ? rank + 1 : Infinity;
      record(acc[c].all, rk, found);
      record(acc[c][isWin ? "win" : "loss"], rk, found);
      record(acc[c][isTop3 ? "top3" : "nontop3"], rk, found);
      const tb = acc[c].tier[bucket] ?? (acc[c].tier[bucket] = { win: newAcc(), loss: newAcc() });
      record(tb[isWin ? "win" : "loss"], rk, found);
    }
  }
  if (++done % 100 === 0) process.stderr.write(`  ...${done}/${teams.length}\r`);
}
process.stderr.write("\n");

// ---------- report ----------
const pct = (x) => (100 * x).toFixed(1) + "%";
const f3 = (x) => x.toFixed(3);
function row(label, s) {
  return `${label.padEnd(10)} n=${String(s.n).padStart(5)}  MRR=${f3(s.mrr)}  hit@3=${pct(s.hit3).padStart(6)}  hit@12=${pct(s.hit12).padStart(6)}  found=${pct(s.found).padStart(6)}`;
}

for (const c of CONFIGS) {
  console.log(`■ config=${c}`);
  console.log("   " + row("all", summarize(acc[c].all)));
  console.log("   " + row("win", summarize(acc[c].win)));
  console.log("   " + row("loss", summarize(acc[c].loss)));
  const w = summarize(acc[c].win), l = summarize(acc[c].loss);
  console.log(`   → win−loss 격차: ΔMRR=${f3(w.mrr - l.mrr)}  Δhit@3=${pct(w.hit3 - l.hit3)}  (클수록 추천이 '좋은 픽'을 잘 식별)`);
  console.log("");
}

// config 간 비교 헤드라인
if (CONFIGS.includes("legacy") && CONFIGS.includes("vector")) {
  const lw = summarize(acc.legacy.win), vw = summarize(acc.vector.win);
  console.log("=== 헤드라인: vector vs legacy (이긴 팀 멤버 식별력) ===");
  console.log(`  win MRR    : legacy ${f3(lw.mrr)}  →  vector ${f3(vw.mrr)}   (${vw.mrr >= lw.mrr ? "개선" : "악화"} ${f3(vw.mrr - lw.mrr)})`);
  console.log(`  win hit@3  : legacy ${pct(lw.hit3)}  →  vector ${pct(vw.hit3)}`);
  const lg = summarize(acc.legacy.win).mrr - summarize(acc.legacy.loss).mrr;
  const vg = summarize(acc.vector.win).mrr - summarize(acc.vector.loss).mrr;
  console.log(`  win−loss ΔMRR: legacy ${f3(lg)}  →  vector ${f3(vg)}   (${vg >= lg ? "격차 확대=개선" : "격차 축소"})`);
  if (CONFIGS.includes("shipped")) {
    const sw = summarize(acc.shipped.win);
    console.log(`  shipped(+diversity) win MRR: ${f3(sw.mrr)}  (다양성 재배열이 식별력에 주는 영향: vector 대비 ${f3(sw.mrr - vw.mrr)})`);
  }
}

// 티어별 win−loss ΔMRR — 조합이 더 중요한(고티어) 곳일수록 격차가 커야 함
const tiersPresent = Array.from(new Set(CONFIGS.flatMap((c) => Object.keys(acc[c].tier))));
tiersPresent.sort((a, b) => (TIER_ORDER.indexOf(a) + 1 || 99) - (TIER_ORDER.indexOf(b) + 1 || 99));
if (tiersPresent.length) {
  console.log("=== 티어별 win−loss ΔMRR (저→고; 조합 중요한 고티어일수록 격차↑ 기대) ===");
  for (const tb of tiersPresent) {
    const parts = CONFIGS.map((c) => {
      const node = acc[c].tier[tb] ?? { win: newAcc(), loss: newAcc() };
      const w = summarize(node.win), l = summarize(node.loss);
      return `${c}=${f3(w.mrr - l.mrr)}`;
    });
    const wn = (acc[CONFIGS[0]].tier[tb]?.win.n ?? 0), ln = (acc[CONFIGS[0]].tier[tb]?.loss.n ?? 0);
    console.log(`  ${tb.padEnd(17)} winN=${String(wn).padStart(4)} lossN=${String(ln).padStart(5)}  ΔMRR: ${parts.join("  ")}`);
  }
  console.log("");
}

console.log("\n해석 가이드: MRR/hit는 높을수록, win−loss ΔMRR은 클수록 추천이 실제로 좋은 픽을 식별한다는 뜻.");
console.log("절대값보다 config 간/승패 간 '상대 비교'로 읽으세요(메타·실력 오염 통제).");
} // end retrieval block
