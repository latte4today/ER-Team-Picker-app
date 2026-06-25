/**
 * Sync the durable data repo, materialize the latest archive corpus, then run
 * the recommender backtest against that corpus.
 *
 * Local default:
 *   node tools/backtest_latest_archive.mjs
 *
 * CI/default checkout mode:
 *   node tools/backtest_latest_archive.mjs --no-sync --archive-dir data-repo/official-archive
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = {
    sync: true,
    dataRepo: process.env.DATA_REPO || "latte4today/ER-Team-Picker-data",
    repoDir: path.join(ROOT, "data", "external", "ER-Team-Picker-data"),
    archiveDir: null,
    out: path.join(ROOT, "reports", "generated", "latest-official-archive.jsonl"),
    configs: "lean,lean_deficit,lean_deficit_hi_022,lean_deficit_hi_028,lean_deficit_hi_034",
    metric: "concordance",
    games: "1500",
    scan: "250000",
    teamTier: "meteor_mithril,demigod_eternity",
    seed: "1",
    bootstrap: "500",
    ciBaseline: "lean",
    ceiling: false,           // true면 백테스트 대신 학습형 천장(learned_ceiling.py) 실행
    python: process.env.PYTHON || "python",
    passthrough: [],
  };

  const dash = process.argv.indexOf("--");
  const mainArgs = dash >= 0 ? process.argv.slice(2, dash) : process.argv.slice(2);
  args.passthrough = dash >= 0 ? process.argv.slice(dash + 1) : [];

  for (let index = 0; index < mainArgs.length; index += 1) {
    const key = mainArgs[index];
    if (key === "--no-sync") {
      args.sync = false;
      continue;
    }
    if (key === "--ceiling") {
      args.ceiling = true;
      continue;
    }
    const value = mainArgs[index + 1];
    if (!key.startsWith("--")) continue;
    index += 1;
    if (key === "--data-repo") args.dataRepo = value;
    else if (key === "--repo-dir") args.repoDir = path.resolve(ROOT, value);
    else if (key === "--archive-dir") args.archiveDir = path.resolve(ROOT, value);
    else if (key === "--out") args.out = path.resolve(ROOT, value);
    else if (key === "--configs") args.configs = value;
    else if (key === "--metric") args.metric = value;
    else if (key === "--games") args.games = value;
    else if (key === "--scan") args.scan = value;
    else if (key === "--team-tier") args.teamTier = value;
    else if (key === "--seed") args.seed = value;
    else if (key === "--bootstrap") args.bootstrap = value;
    else if (key === "--ci-baseline") args.ciBaseline = value;
    else if (key === "--python") args.python = value;
  }

  args.archiveDir ||= path.join(args.repoDir, "official-archive");
  return args;
}

function repoUrl(repo) {
  if (/^https?:\/\//i.test(repo) || /^git@/i.test(repo)) return repo;
  return `https://github.com/${repo}.git`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      ...options,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function gitSafeDirectoryArgs(repoDir) {
  return ["-c", `safe.directory=${repoDir.replace(/\\/g, "/")}`];
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function syncDataRepo(args) {
  await fsp.mkdir(path.dirname(args.repoDir), { recursive: true });
  if (await exists(path.join(args.repoDir, ".git"))) {
    console.log(`Updating data repo: ${path.relative(ROOT, args.repoDir)}`);
    await run("git", [...gitSafeDirectoryArgs(args.repoDir), "-C", args.repoDir, "pull", "--ff-only"]);
    return;
  }
  if (await exists(args.repoDir)) {
    throw new Error(`${path.relative(ROOT, args.repoDir)} exists but is not a git repository.`);
  }
  console.log(`Cloning data repo: ${args.dataRepo}`);
  await run("git", ["clone", "--depth", "1", repoUrl(args.dataRepo), args.repoDir]);
}

async function main() {
  const args = parseArgs();
  if (args.sync) await syncDataRepo(args);

  await run(process.execPath, [
    "tools/materialize_archive_corpus.mjs",
    "--archive-dir", path.relative(ROOT, args.archiveDir),
    "--out", path.relative(ROOT, args.out),
  ]);

  // 아카이브는 raw 수집기 스키마(players/숫자코드, result 없음)라 백테스트가 못 읽는다.
  // export로 정식 스키마(members/variantId/result)로 정규화한 뒤 그 파일로 백테스트한다.
  const normalizedOut = args.out.replace(/\.jsonl$/i, ".normalized.jsonl");
  await run(process.execPath, [
    "tools/export_ml_training_data.mjs",
    "--in", path.relative(ROOT, args.out),
    "--out", path.relative(ROOT, normalizedOut),
  ]);

  if (args.ceiling) {
    // 학습형 천장: 조합이 캐릭터 강함을 넘는 예측력이 있는지 (Python/sklearn).
    await run(args.python, [
      "tools/learned_ceiling.py",
      "--data", path.relative(ROOT, normalizedOut),
      "--tiers", args.teamTier,
      "--bootstrap", args.bootstrap,
      ...args.passthrough,
    ]);
    return;
  }

  const backtestArgs = [
    "tools/backtest_recommender.mjs",
    "--data", path.relative(ROOT, normalizedOut),
    "--configs", args.configs,
    "--metric", args.metric,
    "--games", args.games,
    "--scan", args.scan,
    "--team-tier", args.teamTier,
    "--seed", args.seed,
    "--bootstrap", args.bootstrap,
    "--ci-baseline", args.ciBaseline,
    ...args.passthrough,
  ];
  await run(process.execPath, backtestArgs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
