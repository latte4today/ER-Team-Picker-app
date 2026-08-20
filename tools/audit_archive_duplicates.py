#!/usr/bin/env python3
"""공식 gzip 아카이브의 실행 간 중복과 충돌을 스트리밍으로 감사한다."""
from __future__ import annotations

import argparse
import gzip
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-dir", default="data/external/ER-Team-Picker-data/official-archive")
    parser.add_argument("--out", default="reports/generated/archive-duplicate-audit.json")
    return parser.parse_args()


def shard_date(path: Path):
    match = re.search(r"matches-(\d{4})-(\d{2})-(\d{2})", path.name)
    if not match:
        raise ValueError(path.name)
    return date(*map(int, match.groups())).toordinal()


def packed_key(team):
    return (int(team["gameId"]) << 4) | (int(team["teamKey"]) & 0xF)


def immutable_signature(team):
    players = tuple(sorted(
        (int(player.get("character") or 0), int(player.get("weapon") or 0))
        for player in team.get("players") or []
    ))
    return hash((int(team.get("rank") or 0), players))


def main():
    args = parse_args()
    archive_dir = (ROOT / args.archive_dir).resolve()
    shards = sorted(archive_dir.glob("matches-*.jsonl.gz"))
    if not shards:
        raise SystemExit(f"archive shard가 없습니다: {archive_dir}")

    first_seen = {}
    signatures = {}
    tiers = {}
    unique_games = set()
    repeat_gap_days = Counter()
    totals = Counter()
    per_shard = []

    for shard in shards:
        ordinal = shard_date(shard)
        local = set()
        shard_stats = Counter()
        with gzip.open(shard, "rt", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                shard_stats["rawTeams"] += 1
                totals["rawTeams"] += 1
                try:
                    team = json.loads(line)
                    key = packed_key(team)
                    game_id = int(team["gameId"])
                except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                    shard_stats["invalid"] += 1
                    totals["invalid"] += 1
                    continue
                unique_games.add(game_id)
                signature = immutable_signature(team)
                tier = str(team.get("tierBucket") or "unknown")
                if key in local:
                    shard_stats["duplicateWithinShard"] += 1
                    totals["duplicateWithinShard"] += 1
                elif key in first_seen:
                    shard_stats["duplicateFromEarlierShard"] += 1
                    totals["duplicateFromEarlierShard"] += 1
                    repeat_gap_days[ordinal - first_seen[key]] += 1
                else:
                    shard_stats["newUniqueTeams"] += 1
                    totals["newUniqueTeams"] += 1
                    first_seen[key] = ordinal
                    signatures[key] = signature
                    tiers[key] = tier
                if key in signatures:
                    if signatures[key] != signature:
                        shard_stats["immutableConflict"] += 1
                        totals["immutableConflict"] += 1
                    if tiers[key] != tier:
                        shard_stats["tierConflict"] += 1
                        totals["tierConflict"] += 1
                local.add(key)
        per_shard.append({"shard": shard.name, **shard_stats})

    duplicates = totals["duplicateWithinShard"] + totals["duplicateFromEarlierShard"]
    report = {
        "archiveDir": str(archive_dir.relative_to(ROOT)).replace("\\", "/"),
        "shards": len(shards),
        "rawTeams": totals["rawTeams"],
        "uniqueTeams": totals["newUniqueTeams"],
        "duplicateTeams": duplicates,
        "duplicateRate": duplicates / max(1, totals["rawTeams"]),
        "duplicateWithinShard": totals["duplicateWithinShard"],
        "duplicateFromEarlierShard": totals["duplicateFromEarlierShard"],
        "uniqueGames": len(unique_games),
        "immutableConflicts": totals["immutableConflict"],
        "tierConflicts": totals["tierConflict"],
        "repeatGapDays": {str(key): value for key, value in sorted(repeat_gap_days.items())},
        "perShard": per_shard,
    }
    out = (ROOT / args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Archive duplicate audit: {out.relative_to(ROOT)}")
    print(f"  raw={report['rawTeams']:,} unique={report['uniqueTeams']:,} duplicate={duplicates:,} ({report['duplicateRate']:.1%})")
    print(f"  withinShard={report['duplicateWithinShard']:,} crossShard={report['duplicateFromEarlierShard']:,} uniqueGames={report['uniqueGames']:,}")
    print(f"  immutableConflicts={report['immutableConflicts']:,} tierConflicts={report['tierConflicts']:,}")


if __name__ == "__main__":
    main()
