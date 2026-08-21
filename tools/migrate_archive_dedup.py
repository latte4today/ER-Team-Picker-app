#!/usr/bin/env python3
"""Rewrite an official-match archive into validated, deduplicated gzip shards."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHARD_PATTERN = re.compile(r"^matches-\d{4}-\d{2}-\d{2}(?:-[A-Za-z0-9._-]+)?\.jsonl(?:\.gz)?$")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-archive", default="data/external/ER-Team-Picker-data/official-archive")
    parser.add_argument("--out-dir", default="data/external/ER-Team-Picker-data/official-archive-dedup-staging")
    parser.add_argument("--rows-per-shard", type=int, default=75_000)
    parser.add_argument("--migration-date", default=datetime.now(timezone.utc).date().isoformat())
    return parser.parse_args()


def resolve_from_root(value: str) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (ROOT / path).resolve()


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("rt", encoding="utf-8")


def clean_bucket(value):
    text = str(value or "unknown").strip()
    return text if text else "unknown"


def immutable_signature(team: dict) -> str:
    players = sorted(
        (int(player.get("character") or 0), int(player.get("weapon") or 0))
        for player in (team.get("players") or [])
    )
    value = [int(team.get("rank") or 0), players]
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def quality_score(team: dict) -> int:
    score = 0
    team_mmr = team.get("teamMmr")
    try:
        if float(team_mmr) > 0:
            score += 1_000
    except (TypeError, ValueError):
        pass
    if team.get("tierSource") == "game-team-mmr":
        score += 500
    if clean_bucket(team.get("fineBucket")) != "unknown":
        score += 100
    if clean_bucket(team.get("tierBucket")) != "unknown":
        score += 50
    if team.get("versionSeason") is not None:
        score += 20
    if team.get("versionMajor") is not None:
        score += 20
    if team.get("startedAt"):
        score += 10
    players = team.get("players") or []
    score += min(len(players), 8) * 5
    score += sum(1 for player in players if (player.get("traits") or {}).get("core") is not None)
    return score


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def create_database(path: Path):
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA temp_store=FILE")
    connection.execute("PRAGMA cache_size=-262144")
    connection.execute(
        """
        CREATE TABLE teams (
          key TEXT PRIMARY KEY,
          game_id INTEGER NOT NULL,
          team_key TEXT NOT NULL,
          score INTEGER NOT NULL,
          tier TEXT NOT NULL,
          signature TEXT NOT NULL,
          payload TEXT NOT NULL
        )
        """
    )
    return connection


def import_archive(connection, shards):
    stats = {
        "rawTeams": 0,
        "invalidRows": 0,
        "duplicateTeams": 0,
        "canonicalReplacements": 0,
        "immutableConflicts": 0,
        "tierConflicts": 0,
    }
    cursor = connection.cursor()
    for shard_index, shard in enumerate(shards, 1):
        shard_raw = 0
        with open_text(shard) as handle:
            for line in handle:
                if not line.strip():
                    continue
                stats["rawTeams"] += 1
                shard_raw += 1
                try:
                    team = json.loads(line)
                    game_id = int(team["gameId"])
                    team_key = str(team["teamKey"])
                    key = f"{game_id}:{team_key}"
                except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                    stats["invalidRows"] += 1
                    continue

                payload = json.dumps(team, ensure_ascii=False, separators=(",", ":"))
                signature = immutable_signature(team)
                tier = clean_bucket(team.get("tierBucket"))
                score = quality_score(team)
                cursor.execute(
                    "INSERT OR IGNORE INTO teams VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (key, game_id, team_key, score, tier, signature, payload),
                )
                if cursor.rowcount == 0:
                    stats["duplicateTeams"] += 1
                    existing = cursor.execute(
                        "SELECT score, tier, signature FROM teams WHERE key = ?", (key,)
                    ).fetchone()
                    if existing[1] != tier:
                        stats["tierConflicts"] += 1
                    if existing[2] != signature:
                        stats["immutableConflicts"] += 1
                    if score > existing[0]:
                        cursor.execute(
                            "UPDATE teams SET score=?, tier=?, signature=?, payload=? WHERE key=?",
                            (score, tier, signature, payload, key),
                        )
                        stats["canonicalReplacements"] += 1

                if stats["rawTeams"] % 50_000 == 0:
                    connection.commit()
                    print(f"  imported {stats['rawTeams']:,} rows", flush=True)
        connection.commit()
        print(f"  shard {shard_index}/{len(shards)}: {shard.name} ({shard_raw:,} rows)", flush=True)
    stats["uniqueTeams"] = connection.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
    stats["uniqueGames"] = connection.execute("SELECT COUNT(DISTINCT game_id) FROM teams").fetchone()[0]
    return stats


def open_gzip_writer(path: Path):
    raw = path.open("wb")
    gzip_handle = gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0)
    text = io.TextIOWrapper(gzip_handle, encoding="utf-8", newline="\n")
    return raw, gzip_handle, text


def export_shards(connection, out_dir: Path, migration_date: str, rows_per_shard: int):
    shard_reports = []
    shard_number = 0
    rows_in_shard = 0
    raw = gzip_handle = text = path = None

    def close_current():
        nonlocal raw, gzip_handle, text, path, rows_in_shard
        if text is None:
            return
        text.flush()
        text.close()
        # GzipFile deliberately leaves a caller-owned file object open. Close
        # it before stat/hash so the gzip trailer and buffered bytes are final.
        raw.close()
        report = {
            "name": path.name,
            "teams": rows_in_shard,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        shard_reports.append(report)
        print(f"  wrote {path.name}: {rows_in_shard:,} teams, {report['bytes']:,} bytes", flush=True)
        raw = gzip_handle = text = path = None
        rows_in_shard = 0

    for (payload,) in connection.execute("SELECT payload FROM teams ORDER BY rowid"):
        if text is None or rows_in_shard >= rows_per_shard:
            close_current()
            shard_number += 1
            path = out_dir / f"matches-{migration_date}-dedup-{shard_number:03d}.jsonl.gz"
            raw, gzip_handle, text = open_gzip_writer(path)
        text.write(payload)
        text.write("\n")
        rows_in_shard += 1
    close_current()
    return shard_reports


def write_metadata(connection, out_dir: Path, source_shards, shard_reports, stats):
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    game_ids = connection.execute("SELECT DISTINCT game_id FROM teams ORDER BY game_id")
    with (out_dir / "seen-game-ids.txt").open("w", encoding="utf-8", newline="\n") as handle:
        for (game_id,) in game_ids:
            handle.write(f"{game_id}\n")

    migration = {
        "version": 1,
        "generatedAt": generated_at,
        "sourceShards": [path.name for path in source_shards],
        **stats,
        "outputShards": shard_reports,
    }
    (out_dir / "migration-report.json").write_text(
        json.dumps(migration, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    manifest = {
        "version": 2,
        "updatedAt": generated_at,
        "archiveDir": "data-repo/official-archive",
        "shards": {
            shard["name"]: {
                "runs": 1,
                "teams": shard["teams"],
                "lastRunAt": generated_at,
                "patch": "mixed-migrated",
                "bytes": shard["bytes"],
                "sha256": shard["sha256"],
            }
            for shard in shard_reports
        },
        "runs": [{
            "at": generated_at,
            "source": "dedup-migration",
            "patch": "mixed-migrated",
            "inputTeams": stats["rawTeams"],
            "archivedTeams": stats["uniqueTeams"],
            "duplicatesRemoved": stats["duplicateTeams"],
        }],
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main():
    args = parse_args()
    source = resolve_from_root(args.source_archive)
    out_dir = resolve_from_root(args.out_dir)
    if source == out_dir:
        raise SystemExit("source archive and output directory must differ")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise SystemExit(f"output directory is not empty: {out_dir}")
    if args.rows_per_shard < 1:
        raise SystemExit("rows-per-shard must be positive")
    shards = sorted(path for path in source.iterdir() if path.is_file() and SHARD_PATTERN.match(path.name))
    if not shards:
        raise SystemExit(f"archive shard not found: {source}")

    out_dir.mkdir(parents=True, exist_ok=True)
    database = out_dir.parent / f".{out_dir.name}.sqlite3"
    if database.exists():
        raise SystemExit(f"temporary database already exists: {database}")

    print(f"Deduplicating {len(shards)} shards from {source}", flush=True)
    connection = create_database(database)
    try:
        stats = import_archive(connection, shards)
        if stats["immutableConflicts"]:
            raise RuntimeError(f"immutable team conflicts detected: {stats['immutableConflicts']:,}")
        shard_reports = export_shards(connection, out_dir, args.migration_date, args.rows_per_shard)
        write_metadata(connection, out_dir, shards, shard_reports, stats)
    finally:
        connection.close()
        for extra in (database, Path(f"{database}-wal"), Path(f"{database}-shm")):
            extra.unlink(missing_ok=True)

    print(json.dumps({**stats, "outputShards": len(shard_reports)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
