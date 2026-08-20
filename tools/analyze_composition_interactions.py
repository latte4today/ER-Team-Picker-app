#!/usr/bin/env python3
"""
시간 분리 검증으로 단독 성능과 조합 상호작용을 단계별 비교한다.

원본 durable archive를 직접 읽고 gameId:teamKey로 전체 기간 중복을 제거한다.
같은 날짜의 경기는 한 split에만 들어가며, 최신 날짜를 test로 남겨 과거 조합을
암기한 결과가 아니라 이후 경기에도 재현되는 신호인지 확인한다.

단계:
  context                티어/세부 티어/모드
  +solo                  실험체 및 실험체+무기 단독 효과
  +structure             역할/사거리/피해 유형/태그 구성
  +pair                  2인 실험체 및 variant 상호작용
  +pair_role             특정 2인 + 세 번째 역할/사거리
  +triple                정확한 3인 실험체/variant 고유 효과

top3, 우승, 하위권 위험을 별도로 평가하고, 주 지표(top3)는 로비 내 등수 일치도와
게임 단위 bootstrap CI를 함께 보고한다. 결과는 관찰 데이터의 예측 신호이며 인과
효과로 해석하지 않는다.
"""

from __future__ import annotations

import argparse
import gc
import gzip
import json
import math
import re
from array import array
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from itertools import combinations
from pathlib import Path
from typing import Iterable

import numpy as np
from scipy import sparse
from sklearn.feature_extraction import FeatureHasher
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score


ROOT = Path(__file__).resolve().parents[1]
TIER_NAMES = ["iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"]
STAGE_BLOCKS = {
    "context": ("context",),
    "+solo": ("context", "solo"),
    "+popularity": ("context", "solo", "popularity"),
    "+structure": ("context", "solo", "popularity", "structure"),
    "+pair": ("context", "solo", "popularity", "structure", "pair"),
    "+pair_role": ("context", "solo", "popularity", "structure", "pair", "pair_role"),
    "+triple": ("context", "solo", "popularity", "structure", "pair", "pair_role", "triple"),
}
HASH_DIMS = {
    "context": 128,
    "solo": 2_048,
    "structure": 32_768,
    "pair": 131_072,
    "pair_role": 262_144,
    "triple": 524_288,
}
TAG_COMPLEMENTS = {
    tuple(sorted(pair))
    for pair in (
        ("initiate", "burst"), ("initiate", "sustained"), ("initiate", "focus"),
        ("cc", "burst"), ("cc", "focus"), ("cc", "range"),
        ("peel", "range"), ("peel", "hyperCarry"), ("shield", "sustained"),
        ("healing", "sustained"), ("utility", "hyperCarry"),
        ("poke", "zone"), ("poke", "range"), ("zone", "objective"),
        ("dive", "burst"), ("dive", "mobility"), ("speedBoost", "dive"),
        ("pick", "burst"), ("durable", "sustained"),
    )
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--archive-dir",
        default="data/external/ER-Team-Picker-data/official-archive",
    )
    parser.add_argument("--out-json", default="reports/generated/composition-interactions.json")
    parser.add_argument("--out-md", default="reports/generated/composition-interactions.md")
    parser.add_argument("--targets", default="top3,win,bottom3")
    parser.add_argument("--alphas", default="0.000003,0.00001,0.00003")
    parser.add_argument("--bootstrap", type=int, default=100)
    parser.add_argument("--max-teams", type=int, default=0)
    parser.add_argument("--max-teams-per-shard", type=int, default=0)
    parser.add_argument("--min-rule-validation", type=int, default=30)
    parser.add_argument("--min-rule-test", type=int, default=30)
    parser.add_argument("--rule-fdr", type=float, default=0.05)
    parser.add_argument("--top-rules", type=int, default=15)
    parser.add_argument("--seed", type=int, default=17)
    return parser.parse_args()


@dataclass(frozen=True)
class CharacterMeta:
    code: int
    char_id: str
    name: str
    role: str
    tags: tuple[str, ...]
    damage: str
    difficulty: int
    weapons: tuple[str, ...]
    wiki_metrics: tuple[int, ...]
    cc_profile: tuple[int, ...]
    combat_style: str
    variant_styles: tuple[tuple[str, str], ...]


def parse_metadata():
    export_text = (ROOT / "tools/export_ml_training_data.mjs").read_text(encoding="utf-8")
    data_text = (ROOT / "src/data.js").read_text(encoding="utf-8")
    wiki_text = (ROOT / "src/wikiMetrics.js").read_text(encoding="utf-8")
    combat_text = (ROOT / "src/combatProfiles.js").read_text(encoding="utf-8")

    code_map = {
        int(code): char_id
        for code, char_id in re.findall(r'^\s*(\d+):\s*"([^"]+)",?$', export_text, re.M)
    }
    char_rows = {}
    char_pattern = re.compile(
        r'c\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*\[([^\]]*)\],\s*"([^"]+)",\s*(\d+)\)'
    )
    for match in char_pattern.finditer(data_text):
        char_id, name, role, tags_text, damage, difficulty = match.groups()
        tags = tuple(re.findall(r'"([^"]+)"', tags_text))
        char_rows[char_id] = (name, role, tags, damage, int(difficulty))

    weapon_block = data_text.split("export const characterWeapons = {", 1)[1].split("};", 1)[0]
    weapons_by_char = {}
    for char_id, values in re.findall(r'^\s*([a-z0-9_]+):\s*\[([^\]]*)\]', weapon_block, re.M):
        weapons_by_char[char_id] = tuple(re.findall(r'"([^"]+)"', values))

    weapon_type_block = data_text.split("export const weaponTypes = {", 1)[1].split("};", 1)[0]
    weapon_ranges = {
        weapon: range_name
        for weapon, range_name in re.findall(
            r'^\s*([a-z0-9_]+):\s*\{[^\n]*range:\s*"([^"]+)"',
            weapon_type_block,
            re.M,
        )
    }

    metric_names = ("difficulty", "damage", "defense", "crowdControl", "mobility", "utility")
    wiki_metrics = {}
    for char_id, body in re.findall(r"^\s*([a-z0-9_]+):\s*\{([^}]+)\}", wiki_text, re.M):
        values = {key: int(value) for key, value in re.findall(r"([A-Za-z]+):\s*(\d+)", body)}
        if all(name in values for name in metric_names):
            wiki_metrics[char_id] = tuple(values[name] for name in metric_names)

    cc_names = ("targeted", "nonTarget", "single", "veryNarrow", "narrow", "medium", "wide", "conditional")
    cc_profiles = {}
    cc_block = data_text.split("export const ccProfiles = {", 1)[1].split("};", 1)[0]
    for char_id, body in re.findall(r"^\s*([a-z0-9_]+):\s*cc\(\{([^}]*)\}\)", cc_block, re.M):
        values = {key: int(value) for key, value in re.findall(r"([A-Za-z]+):\s*(\d+)", body)}
        cc_profiles[char_id] = tuple(values.get(name, 0) for name in cc_names)

    combat_character_block = combat_text.split("const byCharacter = {", 1)[1].split("};", 1)[0]
    combat_by_character = dict(re.findall(r'^\s*([a-z0-9_]+):\s*"([^"]+)"', combat_character_block, re.M))
    combat_variant_block = combat_text.split("const byVariant = {", 1)[1].split("};", 1)[0]
    variant_styles = defaultdict(list)
    for char_id, weapon, style in re.findall(
        r'^\s*"([a-z0-9_]+):([a-z0-9_]+)":\s*"([^"]+)"', combat_variant_block, re.M
    ):
        variant_styles[char_id].append((weapon, style))

    by_code = {}
    for code, char_id in code_map.items():
        if char_id not in char_rows:
            continue
        name, role, tags, damage, difficulty = char_rows[char_id]
        by_code[code] = CharacterMeta(
            code=code,
            char_id=char_id,
            name=name,
            role=role,
            tags=tags,
            damage=damage,
            difficulty=difficulty,
            weapons=weapons_by_char.get(char_id, ()),
            wiki_metrics=wiki_metrics.get(char_id, (difficulty, 3, 3, 3, 3, 3)),
            cc_profile=cc_profiles.get(char_id, (0,) * len(cc_names)),
            combat_style=combat_by_character.get(char_id, "neutral"),
            variant_styles=tuple(variant_styles.get(char_id, ())),
        )
    return by_code, weapon_ranges


class EncodedDataset:
    pass


def _ordinal_from_name(path: Path):
    match = re.search(r"matches-(\d{4})-(\d{2})-(\d{2})", path.name)
    if not match:
        raise ValueError(f"날짜를 읽을 수 없는 shard: {path.name}")
    year, month, day = map(int, match.groups())
    return date(year, month, day).toordinal()


def load_archive(
    archive_dir: Path,
    metadata: dict[int, CharacterMeta],
    max_teams: int = 0,
    max_teams_per_shard: int = 0,
):
    shards = sorted(archive_dir.glob("matches-*.jsonl.gz"))
    if not shards:
        raise SystemExit(f"archive shard가 없습니다: {archive_dir}")

    buffers = {
        "date": array("I"),
        "gid": array("Q"),
        "rank": array("B"),
        "tier": array("B"),
        "fine": array("B"),
        "mode": array("H"),
        "season": array("H"),
        "version_season": array("H"),
        "version_major": array("H"),
        "version_minor": array("H"),
        "premade_size": array("B"),
        "premade_matching": array("B"),
        "main_weather": array("H"),
        "sub_weather": array("H"),
        "chars": array("H"),
        "weapons": array("H"),
    }
    tier_values, tier_index = [], {}
    fine_values, fine_index = [], {}
    seen = set()
    stats = Counter()
    weapon_votes = defaultdict(Counter)

    def encode(value, values, index):
        value = str(value if value is not None else "unknown")
        if value not in index:
            index[value] = len(values)
            values.append(value)
        return index[value]

    stop = False
    for shard in shards:
        shard_date = _ordinal_from_name(shard)
        shard_added = 0
        with gzip.open(shard, "rt", encoding="utf-8") as handle:
            for line in handle:
                stats["rawLines"] += 1
                try:
                    team = json.loads(line)
                except json.JSONDecodeError:
                    stats["invalidJson"] += 1
                    continue
                players = team.get("players") or []
                if len(players) != 3:
                    stats["invalidTeamSize"] += 1
                    continue
                try:
                    gid = int(team.get("gameId"))
                    team_key = int(team.get("teamKey"))
                except (TypeError, ValueError):
                    stats["invalidKey"] += 1
                    continue
                packed_key = (gid << 4) | (team_key & 0xF)
                if packed_key in seen:
                    stats["duplicates"] += 1
                    continue
                seen.add(packed_key)

                members = []
                valid = True
                for player in players:
                    try:
                        char_code = int(player.get("character"))
                        weapon_code = int(player.get("weapon") or 0)
                    except (TypeError, ValueError):
                        valid = False
                        break
                    if char_code not in metadata:
                        valid = False
                        break
                    members.append((char_code, weapon_code))
                if not valid or len({char for char, _ in members}) != 3:
                    stats["unknownOrDuplicateCharacter"] += 1
                    continue
                rank = int(team.get("rank") or 0)
                if not 1 <= rank <= 8:
                    stats["invalidPlacement"] += 1
                    continue

                members.sort()
                buffers["date"].append(shard_date)
                buffers["gid"].append(gid)
                buffers["rank"].append(rank)
                buffers["tier"].append(encode(team.get("tierBucket"), tier_values, tier_index))
                buffers["fine"].append(encode(team.get("fineBucket"), fine_values, fine_index))
                buffers["mode"].append(int(team.get("matchingMode") or 0))
                buffers["season"].append(int(team.get("seasonId") or 0))
                buffers["version_season"].append(int(team.get("versionSeason") or 0))
                buffers["version_major"].append(int(team.get("versionMajor") or 0))
                buffers["version_minor"].append(int(team.get("versionMinor") or 0))
                buffers["premade_size"].append(int(team.get("premadeSize") or 0))
                buffers["premade_matching"].append(int(team.get("premadeMatchingType") or 0))
                buffers["main_weather"].append(int(team.get("mainWeather") or 0))
                buffers["sub_weather"].append(int(team.get("subWeather") or 0))
                for char_code, weapon_code in members:
                    buffers["chars"].append(char_code)
                    buffers["weapons"].append(weapon_code)
                    known_weapons = metadata[char_code].weapons
                    if len(known_weapons) == 1:
                        weapon_votes[weapon_code][known_weapons[0]] += 1
                stats["uniqueValidTeams"] += 1
                shard_added += 1
                if max_teams and stats["uniqueValidTeams"] >= max_teams:
                    stop = True
                    break
                if max_teams_per_shard and shard_added >= max_teams_per_shard:
                    break
        if stop:
            break

    ds = EncodedDataset()
    ds._buffers = buffers
    ds.date = np.frombuffer(buffers["date"], dtype=np.uint32)
    ds.gid = np.frombuffer(buffers["gid"], dtype=np.uint64)
    ds.rank = np.frombuffer(buffers["rank"], dtype=np.uint8)
    ds.tier = np.frombuffer(buffers["tier"], dtype=np.uint8)
    ds.fine = np.frombuffer(buffers["fine"], dtype=np.uint8)
    ds.mode = np.frombuffer(buffers["mode"], dtype=np.uint16)
    ds.season = np.frombuffer(buffers["season"], dtype=np.uint16)
    ds.version_season = np.frombuffer(buffers["version_season"], dtype=np.uint16)
    ds.version_major = np.frombuffer(buffers["version_major"], dtype=np.uint16)
    ds.version_minor = np.frombuffer(buffers["version_minor"], dtype=np.uint16)
    ds.premade_size = np.frombuffer(buffers["premade_size"], dtype=np.uint8)
    ds.premade_matching = np.frombuffer(buffers["premade_matching"], dtype=np.uint8)
    ds.main_weather = np.frombuffer(buffers["main_weather"], dtype=np.uint16)
    ds.sub_weather = np.frombuffer(buffers["sub_weather"], dtype=np.uint16)
    ds.chars = np.frombuffer(buffers["chars"], dtype=np.uint16).reshape(-1, 3)
    ds.weapons = np.frombuffer(buffers["weapons"], dtype=np.uint16).reshape(-1, 3)
    ds.tier_values = tier_values
    ds.fine_values = fine_values
    ds.weapon_names = {
        code: votes.most_common(1)[0][0]
        for code, votes in weapon_votes.items()
        if votes
    }
    ds.stats = dict(stats)
    ds.shards = [path.name for path in shards]
    return ds


def temporal_split(ds: EncodedDataset):
    unique_dates, counts = np.unique(ds.date, return_counts=True)
    cumulative = np.cumsum(counts) / counts.sum()
    train_pos = min(len(unique_dates) - 3, int(np.searchsorted(cumulative, 0.70)))
    train_pos = max(0, train_pos)
    val_pos = min(len(unique_dates) - 2, int(np.searchsorted(cumulative, 0.85)))
    val_pos = max(train_pos + 1, val_pos)
    train_cut = unique_dates[train_pos]
    val_cut = unique_dates[val_pos]
    train = np.flatnonzero(ds.date <= train_cut)
    validation = np.flatnonzero((ds.date > train_cut) & (ds.date <= val_cut))
    test = np.flatnonzero(ds.date > val_cut)
    if min(len(train), len(validation), len(test)) < 200:
        raise SystemExit("시간 분리 후 표본이 부족합니다.")
    return train, validation, test, int(train_cut), int(val_cut)


def iso_date(ordinal: int):
    return date.fromordinal(int(ordinal)).isoformat()


def member_context(ds, row_index, metadata, weapon_ranges):
    chars = [int(value) for value in ds.chars[row_index]]
    weapons = [int(value) for value in ds.weapons[row_index]]
    metas = [metadata[code] for code in chars]
    weapon_names = [ds.weapon_names.get(code, f"code_{code}") for code in weapons]
    ranges = [weapon_ranges.get(name, "unknown") for name in weapon_names]
    return chars, weapons, metas, weapon_names, ranges


def block_features(ds, row_index: int, block: str, metadata, weapon_ranges):
    chars, weapons, metas, weapon_names, ranges = member_context(
        ds, row_index, metadata, weapon_ranges
    )
    roles = [meta.role for meta in metas]
    damages = [meta.damage for meta in metas]
    styles = [dict(meta.variant_styles).get(weapon, meta.combat_style) for meta, weapon in zip(metas, weapon_names)]

    if block == "context":
        return [
            f"tier={ds.tier_values[int(ds.tier[row_index])]}",
            f"fine={ds.fine_values[int(ds.fine[row_index])]}",
            f"mode={int(ds.mode[row_index])}",
            f"season={int(ds.season[row_index])}",
            f"version={int(ds.version_season[row_index])}.{int(ds.version_major[row_index])}.{int(ds.version_minor[row_index])}",
            f"premadeSize={int(ds.premade_size[row_index])}",
            f"premadeMatching={int(ds.premade_matching[row_index])}",
            f"weather={int(ds.main_weather[row_index])}:{int(ds.sub_weather[row_index])}",
        ]
    if block == "solo":
        values = []
        for char_code, weapon_code in zip(chars, weapons):
            values.append(f"char={char_code}")
            values.append(f"variant={char_code}:{weapon_code}")
        return values
    if block == "structure":
        values = [
            "roles=" + "|".join(sorted(roles)),
            "ranges=" + "|".join(sorted(ranges)),
            "damage=" + "|".join(sorted(damages)),
            "styles=" + "|".join(sorted(styles)),
            f"difficultySum={sum(meta.difficulty for meta in metas)}",
        ]
        for label, items in (
            ("roleCount", roles),
            ("rangeCount", ranges),
            ("damageCount", damages),
            ("styleCount", styles),
        ):
            for key, count in sorted(Counter(items).items()):
                values.append(f"{label}:{key}={count}")
        tag_counts = Counter(tag for meta in metas for tag in meta.tags)
        for tag, count in sorted(tag_counts.items()):
            values.append(f"tagCount:{tag}={min(count, 3)}")
        values.append(f"tagCoverage={len(tag_counts)}")

        # 같은 태그의 단순 합뿐 아니라 서로 다른 두 팀원이 만드는 보완 관계를 표현한다.
        tag_bridges = set()
        for i, j in combinations(range(3), 2):
            for left in metas[i].tags:
                for right in metas[j].tags:
                    bridge = tuple(sorted((left, right)))
                    if bridge in TAG_COMPLEMENTS:
                        tag_bridges.add("|".join(bridge))
            values.append("stylePair=" + "|".join(sorted((styles[i], styles[j]))))
            values.append("roleStyle=" + "|".join(sorted((f"{roles[i]}:{styles[i]}", f"{roles[j]}:{styles[j]}"))))
        values.extend(f"tagBridge={bridge}" for bridge in sorted(tag_bridges))

        metric_names = ("difficulty", "damage", "defense", "cc", "mobility", "utility")
        metric_columns = list(zip(*(meta.wiki_metrics for meta in metas)))
        for name, column in zip(metric_names, metric_columns):
            values.extend((
                f"metricSum:{name}={sum(column)}",
                f"metricMin:{name}={min(column)}",
                f"metricMax:{name}={max(column)}",
                f"metricSpread:{name}={max(column) - min(column)}",
            ))

        cc_names = ("targeted", "nonTarget", "single", "veryNarrow", "narrow", "medium", "wide", "conditional")
        cc_columns = list(zip(*(meta.cc_profile for meta in metas)))
        for name, column in zip(cc_names, cc_columns):
            values.append(f"ccTotal:{name}={sum(column)}")
        return values
    if block == "pair":
        values = []
        for i, j in combinations(range(3), 2):
            values.append(f"charPair={chars[i]}|{chars[j]}")
            variants = sorted((f"{chars[i]}:{weapons[i]}", f"{chars[j]}:{weapons[j]}"))
            values.append("variantPair=" + "|".join(variants))
        return values
    if block == "pair_role":
        values = []
        for i, j in combinations(range(3), 2):
            k = 3 - i - j
            values.append(f"pairRole={chars[i]}|{chars[j]}#{roles[k]}")
            values.append(f"pairRange={chars[i]}|{chars[j]}#{ranges[k]}")
        return values
    if block == "triple":
        variants = sorted(f"{char}:{weapon}" for char, weapon in zip(chars, weapons))
        return [
            "trioChar=" + "|".join(map(str, chars)),
            "trioVariant=" + "|".join(variants),
        ]
    raise ValueError(block)


def build_blocks(ds, metadata, weapon_ranges):
    blocks = {}
    row_range = range(len(ds.rank))
    for name, dimension in HASH_DIMS.items():
        print(f"  feature block {name:<10} hash={dimension:,}", flush=True)
        hasher = FeatureHasher(
            n_features=dimension,
            input_type="string",
            alternate_sign=True,
            dtype=np.float32,
        )
        blocks[name] = hasher.transform(
            block_features(ds, index, name, metadata, weapon_ranges)
            for index in row_range
        ).tocsr()
    return blocks


def build_popularity_block(ds, train):
    """학습 기간 픽률만 사용해 희귀도/메타 노출 차이를 별도 통제한다."""
    char_counts = Counter(int(code) for code in ds.chars[train].ravel())
    variant_counts = Counter(
        (int(char), int(weapon))
        for chars, weapons in zip(ds.chars[train], ds.weapons[train])
        for char, weapon in zip(chars, weapons)
    )
    char_total = max(1, sum(char_counts.values()))
    variant_total = max(1, sum(variant_counts.values()))
    char_vocab = max(1, len(char_counts))
    variant_vocab = max(1, len(variant_counts))
    features = np.empty((len(ds.rank), 8), dtype=np.float32)
    for index, (chars, weapons) in enumerate(zip(ds.chars, ds.weapons)):
        char_log = np.array([
            math.log((char_counts[int(char)] + 1) / (char_total + char_vocab))
            for char in chars
        ])
        variant_log = np.array([
            math.log((variant_counts[(int(char), int(weapon))] + 1) / (variant_total + variant_vocab))
            for char, weapon in zip(chars, weapons)
        ])
        features[index] = (
            char_log.mean(), char_log.min(), char_log.max(), char_log.std(),
            variant_log.mean(), variant_log.min(), variant_log.max(), variant_log.std(),
        )
    center = features[train].mean(axis=0)
    scale = features[train].std(axis=0)
    scale[scale < 1e-6] = 1.0
    features = np.clip((features - center) / scale, -6, 6)
    return sparse.csr_matrix(features, dtype=np.float32)


def target_values(ds, target):
    if target == "top3":
        return (ds.rank <= 3).astype(np.uint8)
    if target == "win":
        return (ds.rank == 1).astype(np.uint8)
    if target == "bottom3":
        return (ds.rank >= 6).astype(np.uint8)
    raise ValueError(target)


def metric_bundle(y, probability, gids, ranks, target="top3"):
    probability = np.clip(probability, 1e-6, 1 - 1e-6)
    ranking_probability = -probability if target == "bottom3" else probability
    return {
        "auc": float(roc_auc_score(y, probability)),
        "averagePrecision": float(average_precision_score(y, probability)),
        "logLoss": float(log_loss(y, probability)),
        "brier": float(brier_score_loss(y, probability)),
        "lobbyConcordance": float(lobby_concordance(ranking_probability, gids, ranks)),
    }


def lobby_concordance(probability, gids, ranks):
    order = np.argsort(gids, kind="stable")
    sorted_gids = gids[order]
    boundaries = np.r_[0, np.flatnonzero(np.diff(sorted_gids)) + 1, len(order)]
    correct = 0.0
    total = 0
    for start, end in zip(boundaries[:-1], boundaries[1:]):
        if end - start < 4:
            continue
        indices = order[start:end]
        for left, right in combinations(indices, 2):
            if ranks[left] == ranks[right]:
                continue
            expected = probability[left] > probability[right] if ranks[left] < ranks[right] else probability[right] > probability[left]
            tied = probability[left] == probability[right]
            correct += 0.5 if tied else float(expected)
            total += 1
    return correct / total if total else float("nan")


def new_model(alpha, seed):
    return SGDClassifier(
        loss="log_loss",
        penalty="l2",
        alpha=alpha,
        max_iter=50,
        tol=None,
        average=True,
        random_state=seed,
    )


def fit_with_alpha_search(X, y, train, validation, test, alphas, seed):
    X_train, X_validation, X_test = X[train], X[validation], X[test]
    best = None
    for alpha in alphas:
        model = new_model(alpha, seed)
        model.fit(X_train, y[train])
        validation_probability = model.predict_proba(X_validation)[:, 1]
        loss = log_loss(y[validation], np.clip(validation_probability, 1e-6, 1 - 1e-6))
        if best is None or loss < best[0]:
            best = (loss, alpha, model, validation_probability)
    _, alpha, model, validation_probability = best
    test_probability = model.predict_proba(X_test)[:, 1]
    return alpha, validation_probability, test_probability


def fit_fixed_alpha(X, y, train, validation, test, alpha, seed):
    model = new_model(alpha, seed)
    model.fit(X[train], y[train])
    return model.predict_proba(X[validation])[:, 1], model.predict_proba(X[test])[:, 1]


def bootstrap_delta(y, current, previous, gids, iterations, seed):
    observed = roc_auc_score(y, current) - roc_auc_score(y, previous)
    if iterations <= 0:
        return {"observed": float(observed), "ci95": [None, None]}
    _, inverse = np.unique(gids, return_inverse=True)
    group_count = int(inverse.max()) + 1
    rng = np.random.default_rng(seed)
    deltas = []
    for _ in range(iterations):
        sampled = rng.integers(0, group_count, size=group_count)
        group_weights = np.bincount(sampled, minlength=group_count)
        weights = group_weights[inverse]
        if np.count_nonzero(weights) == 0:
            continue
        deltas.append(
            roc_auc_score(y, current, sample_weight=weights)
            - roc_auc_score(y, previous, sample_weight=weights)
        )
    low, high = np.percentile(deltas, [2.5, 97.5]) if deltas else (math.nan, math.nan)
    return {"observed": float(observed), "ci95": [float(low), float(high)]}


def probability_logit(probability):
    probability = np.clip(probability, 1e-6, 1 - 1e-6)
    return np.log(probability / (1 - probability))


def probability_from_logit(logit):
    output = np.empty_like(logit, dtype=np.float64)
    positive = logit >= 0
    output[positive] = 1 / (1 + np.exp(-logit[positive]))
    exp_value = np.exp(logit[~positive])
    output[~positive] = exp_value / (1 + exp_value)
    return output


def incremental_sensitivity(y_validation, y_test, base, previous, current, scales):
    """추가 정보층을 0~100% 섞어 과대 가중 여부를 시간 분리로 진단한다."""
    base_val_logit = probability_logit(base["validation"])
    base_test_logit = probability_logit(base["test"])
    previous_val_logit = probability_logit(previous["validation"])
    current_val_logit = probability_logit(current["validation"])
    previous_test_logit = probability_logit(previous["test"])
    current_test_logit = probability_logit(current["test"])
    rows = []
    for scale in scales:
        val_probability = probability_from_logit(
            base_val_logit + scale * (current_val_logit - previous_val_logit)
        )
        test_probability = probability_from_logit(
            base_test_logit + scale * (current_test_logit - previous_test_logit)
        )
        rows.append({
            "scale": scale,
            "validationLogLoss": float(log_loss(y_validation, val_probability)),
            "validationAuc": float(roc_auc_score(y_validation, val_probability)),
            "testLogLoss": float(log_loss(y_test, test_probability)),
            "testAuc": float(roc_auc_score(y_test, test_probability)),
        })
    selected = min(rows, key=lambda row: (row["validationLogLoss"], -row["validationAuc"]))
    selected_scale = selected["scale"]
    selected_predictions = {
        "validation": probability_from_logit(
            base_val_logit + selected_scale * (current_val_logit - previous_val_logit)
        ),
        "test": probability_from_logit(
            base_test_logit + selected_scale * (current_test_logit - previous_test_logit)
        ),
    }
    return {"selectedScale": selected_scale, "path": rows}, selected_predictions


def role_composition(ds, index, metadata):
    return "|".join(sorted(metadata[int(code)].role for code in ds.chars[index]))


def range_composition(ds, index, weapon_ranges):
    ranges = [
        weapon_ranges.get(ds.weapon_names.get(int(code), ""), "unknown")
        for code in ds.weapons[index]
    ]
    return "|".join(sorted(ranges))


def rule_keys(ds, index, group, metadata, weapon_ranges):
    chars = [int(value) for value in ds.chars[index]]
    weapons = [int(value) for value in ds.weapons[index]]
    metas = [metadata[code] for code in chars]
    roles = [meta.role for meta in metas]
    if group == "structure":
        weapon_names = [ds.weapon_names.get(code, f"code_{code}") for code in weapons]
        styles = [dict(meta.variant_styles).get(weapon, meta.combat_style) for meta, weapon in zip(metas, weapon_names)]
        keys = [
            ("roles", role_composition(ds, index, metadata)),
            ("ranges", range_composition(ds, index, weapon_ranges)),
            ("styles", "|".join(sorted(styles))),
        ]
        for left, right in combinations(styles, 2):
            keys.append(("style_pair", *sorted((left, right))))
        tag_counts = Counter(tag for meta in metas for tag in meta.tags)
        keys.extend(("tag_count", tag, min(count, 3)) for tag, count in tag_counts.items())
        for i, j in combinations(range(3), 2):
            for left in metas[i].tags:
                for right in metas[j].tags:
                    bridge = tuple(sorted((left, right)))
                    if bridge in TAG_COMPLEMENTS:
                        keys.append(("tag_bridge", *bridge))
        metric_names = ("difficulty", "damage", "defense", "cc", "mobility", "utility")
        for name, column in zip(metric_names, zip(*(meta.wiki_metrics for meta in metas))):
            keys.append(("metric_sum", name, sum(column)))
        cc_columns = list(zip(*(meta.cc_profile for meta in metas)))
        keys.append(("cc_total", "targeted", sum(cc_columns[0])))
        keys.append(("cc_total", "area", sum(cc_columns[5]) + sum(cc_columns[6])))
        return list(dict.fromkeys(keys))
    if group == "pair":
        return [("pair", chars[i], chars[j]) for i, j in combinations(range(3), 2)]
    if group == "pair_role":
        return [
            ("pair_role", chars[i], chars[j], roles[3 - i - j])
            for i, j in combinations(range(3), 2)
        ]
    if group == "triple":
        return [("triple", *chars)]
    raise ValueError(group)


def aggregate_rules(ds, indices, residuals, group, metadata, weapon_ranges):
    aggregates = defaultdict(lambda: [0, 0.0, 0.0])
    for row_index, residual in zip(indices, residuals):
        for key in rule_keys(ds, int(row_index), group, metadata, weapon_ranges):
            aggregate = aggregates[key]
            aggregate[0] += 1
            aggregate[1] += float(residual)
            aggregate[2] += float(residual) ** 2
    return aggregates


def effect_stats(values):
    count, total, square_total = values
    mean = total / count
    variance = max(0.0, square_total / count - mean * mean)
    standard_error = math.sqrt(variance / count)
    return count, mean, standard_error


def normal_two_sided_p(effect, standard_error):
    if standard_error <= 0:
        return 0.0 if effect else 1.0
    return math.erfc(abs(effect / standard_error) / math.sqrt(2.0))


def add_bh_qvalues(rows, p_key, q_key):
    """Benjamini-Hochberg q-value를 계산해 후보군 전체의 우연한 적중을 억제한다."""
    if not rows:
        return
    order = sorted(range(len(rows)), key=lambda index: rows[index][p_key])
    count = len(order)
    running = 1.0
    for rank in range(count, 0, -1):
        index = order[rank - 1]
        running = min(running, rows[index][p_key] * count / rank)
        rows[index][q_key] = min(1.0, running)


def rule_label(key, metadata):
    kind = key[0]
    if kind == "roles":
        return f"역할 구성 {key[1]}"
    if kind == "ranges":
        return f"사거리 구성 {key[1]}"
    if kind == "styles":
        return f"교전 방식 구성 {key[1]}"
    if kind == "style_pair":
        return f"교전 방식 {key[1]} + {key[2]}"
    if kind == "tag_count":
        return f"태그 {key[1]} {key[2]}명"
    if kind == "tag_bridge":
        return f"태그 보완 {key[1]} + {key[2]}"
    if kind == "metric_sum":
        return f"{key[1]} 합계 {key[2]}"
    if kind == "cc_total":
        return f"CC {key[1]} 합계 {key[2]}"
    names = [metadata[int(code)].name for code in key[1:] if isinstance(code, int)]
    if kind == "pair":
        return " + ".join(names)
    if kind == "pair_role":
        return f"{names[0]} + {names[1]} + {key[3]} 역할"
    if kind == "triple":
        return " + ".join(names)
    return str(key)


def stable_rule_report(
    ds,
    validation,
    test,
    validation_residual,
    test_residual,
    group,
    metadata,
    weapon_ranges,
    min_validation,
    min_test,
    fdr,
    top,
):
    validation_rows = aggregate_rules(
        ds, validation, validation_residual, group, metadata, weapon_ranges
    )
    test_rows = aggregate_rules(ds, test, test_residual, group, metadata, weapon_ranges)
    output = []
    for key, validation_values in validation_rows.items():
        if key not in test_rows:
            continue
        val_n, val_effect, val_se = effect_stats(validation_values)
        test_n, test_effect, test_se = effect_stats(test_rows[key])
        if val_n < min_validation or test_n < min_test:
            continue
        same_sign = val_effect * test_effect > 0
        conservative = math.copysign(min(abs(val_effect), abs(test_effect)), val_effect) if same_sign else 0.0
        score = abs(conservative) * math.sqrt(min(val_n, test_n))
        output.append(
            {
                "key": list(key),
                "label": rule_label(key, metadata),
                "validationGames": val_n,
                "testGames": test_n,
                "validationLift": val_effect,
                "testLift": test_effect,
                "validationSe": val_se,
                "testSe": test_se,
                "validationP": normal_two_sided_p(val_effect, val_se),
                "testP": normal_two_sided_p(test_effect, test_se),
                "sameSign": same_sign,
                "score": score,
            }
        )
    add_bh_qvalues(output, "validationP", "validationQ")
    add_bh_qvalues(output, "testP", "testQ")
    for row in output:
        row["confirmed"] = (
            row["sameSign"]
            and row["validationQ"] <= fdr
            and row["testQ"] <= fdr
        )
    positives = sorted(
        (row for row in output if row["sameSign"] and row["testLift"] > 0),
        key=lambda row: (row["confirmed"], row["score"]),
        reverse=True,
    )[:top]
    negatives = sorted(
        (row for row in output if row["sameSign"] and row["testLift"] < 0),
        key=lambda row: (row["confirmed"], row["score"]),
        reverse=True,
    )[:top]
    return {"positive": positives, "negative": negatives, "eligible": len(output)}


def round_metrics(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: round_metrics(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_metrics(item) for item in value]
    return value


def render_markdown(report):
    lines = [
        "# 조합 상호작용 다층 분석",
        "",
        "> 관찰 데이터의 시간 분리 예측 검증이다. 승패의 인과 원인을 단정하지 않는다.",
        "",
        "## 데이터 품질",
        "",
        f"- 원본 행: {report['data']['rawLines']:,}",
        f"- 기간 전체 중복 제거: {report['data']['duplicatesRemoved']:,}",
        f"- 유효한 고유 3인 팀: {report['data']['uniqueValidTeams']:,}",
        f"- 학습: {report['split']['train']['count']:,} ({report['split']['train']['dates']})",
        f"- 검증: {report['split']['validation']['count']:,} ({report['split']['validation']['dates']})",
        f"- 최종 테스트: {report['split']['test']['count']:,} ({report['split']['test']['dates']})",
        "",
        "## 단계별 결과 — Top 3",
        "",
        "| 단계 | AUC | AP | Log loss | Brier | 로비 내 등수 일치 | 직전 단계 대비 AUC (95% CI) |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    top3 = report["targets"]["top3"]
    for stage, row in top3["stages"].items():
        delta = top3["deltas"].get(stage)
        delta_text = "–" if not delta else f"{delta['observed']:+.4f} [{delta['ci95'][0]:+.4f}, {delta['ci95'][1]:+.4f}]"
        metrics = row["test"]
        lines.append(
            f"| {stage} | {metrics['auc']:.4f} | {metrics['averagePrecision']:.4f} | {metrics['logLoss']:.4f} | "
            f"{metrics['brier']:.4f} | {metrics['lobbyConcordance']:.4f} | {delta_text} |"
        )

    lines += ["", "## 추가 정보층 가중치 민감도 — Top 3", "", "| 정보층 | 검증에서 선택된 반영 비율 | 선택 비율 테스트 AUC | 100% 반영 AUC |", "|---|---:|---:|---:|"]
    for stage, result in report["sensitivity"].items():
        selected = next(row for row in result["path"] if row["scale"] == result["selectedScale"])
        full = next(row for row in result["path"] if row["scale"] == 1.0)
        lines.append(f"| {stage} | {result['selectedScale']:.2f} | {selected['testAuc']:.4f} | {full['testAuc']:.4f} |")
    ensemble = report["sensitivityEnsemble"]
    lines += ["", f"- 순차 민감도 앙상블: AUC {ensemble['auc']:.4f}, Log loss {ensemble['logLoss']:.4f}, 로비 내 등수 일치 {ensemble['lobbyConcordance']:.4f}"]

    for target in ("win", "bottom3"):
        if target not in report["targets"]:
            continue
        title = "우승" if target == "win" else "하위 3팀 위험"
        lines += ["", f"## 단계별 결과 — {title}", "", "| 단계 | AUC | Log loss | Brier |", "|---|---:|---:|---:|"]
        for stage, row in report["targets"][target]["stages"].items():
            metrics = row["test"]
            lines.append(f"| {stage} | {metrics['auc']:.4f} | {metrics['logLoss']:.4f} | {metrics['brier']:.4f} |")

    lines += ["", "## 전체 모델에서 한 정보군을 뺐을 때 — Top 3", "", "| 제외한 정보 | AUC | 전체 대비 변화 |", "|---|---:|---:|"]
    full_auc = top3["stages"]["+triple"]["test"]["auc"]
    for block, row in report["ablations"].items():
        auc = row["auc"]
        lines.append(f"| {block} | {auc:.4f} | {auc - full_auc:+.4f} |")

    lines += ["", "## 시간 분리 후 재현된 규칙 후보", ""]
    group_titles = {
        "structure": "역할·사거리 구조",
        "pair": "2인 조합",
        "pair_role": "특정 2인 + 세 번째 역할",
        "triple": "정확한 3인 조합",
    }
    for group, title in group_titles.items():
        lines += [f"### {title}", "", "긍정 신호", "", "| 규칙 | 검증/테스트 표본 | 검증 효과 | 테스트 효과 | 양 기간 FDR 확인 |", "|---|---:|---:|---:|:---:|"]
        for row in report["rules"][group]["positive"]:
            lines.append(
                f"| {row['label']} | {row['validationGames']}/{row['testGames']} | "
                f"{row['validationLift']*100:+.2f}%p | {row['testLift']*100:+.2f}%p | {'✓' if row['confirmed'] else '△'} |"
            )
        lines += ["", "부정 신호", "", "| 규칙 | 검증/테스트 표본 | 검증 효과 | 테스트 효과 | 양 기간 FDR 확인 |", "|---|---:|---:|---:|:---:|"]
        for row in report["rules"][group]["negative"]:
            lines.append(
                f"| {row['label']} | {row['validationGames']}/{row['testGames']} | "
                f"{row['validationLift']*100:+.2f}%p | {row['testLift']*100:+.2f}%p | {'✓' if row['confirmed'] else '△'} |"
            )
        lines.append("")

    lines += [
        "## 해석 원칙",
        "",
        "- AUC뿐 아니라 log loss, Brier, 로비 내 등수 일치도가 함께 좋아져야 실용 신호로 본다.",
        "- 단계별 증분은 순서 의존성이 있으므로 전체 모델 ablation도 함께 본다.",
        "- 규칙 후보는 검증 기간과 더 최신 테스트 기간에서 방향이 같고, 양쪽 모두 다중검정 FDR 기준을 통과해야 확인 신호로 본다.",
        "- 정확한 3인 조합은 표본이 희소하므로 2인·역할 효과보다 더 강하게 축소해서 앱에 반영해야 한다.",
        "- 패치 값이 모두 `current`라 날짜 분리가 패치 변화의 대용치다. 실제 패치 번호 수집을 추가하면 더 정확해진다.",
    ]
    return "\n".join(lines) + "\n"


def main():
    args = parse_args()
    archive_dir = (ROOT / args.archive_dir).resolve()
    out_json = (ROOT / args.out_json).resolve()
    out_md = (ROOT / args.out_md).resolve()
    targets = [value.strip() for value in args.targets.split(",") if value.strip()]
    alphas = [float(value) for value in args.alphas.split(",")]

    metadata, weapon_ranges = parse_metadata()
    print(f"# metadata characters={len(metadata)} (Craver={89 in metadata})", flush=True)
    ds = load_archive(
        archive_dir,
        metadata,
        args.max_teams,
        args.max_teams_per_shard,
    )
    train, validation, test, train_cut, val_cut = temporal_split(ds)
    print(
        f"# raw={ds.stats.get('rawLines', 0):,} duplicates={ds.stats.get('duplicates', 0):,} "
        f"uniqueValid={len(ds.rank):,}",
        flush=True,
    )
    print(
        f"# split train={len(train):,} <= {iso_date(train_cut)}  "
        f"validation={len(validation):,} <= {iso_date(val_cut)}  test={len(test):,}",
        flush=True,
    )

    blocks = build_blocks(ds, metadata, weapon_ranges)
    print("  feature block popularity train-only normalized pick rates", flush=True)
    blocks["popularity"] = build_popularity_block(ds, train)
    y_by_target = {target: target_values(ds, target) for target in targets}
    predictions = {target: {} for target in targets}
    results = {target: {"stages": {}, "deltas": {}} for target in targets}
    chosen_alphas = {}

    for stage_index, (stage, block_names) in enumerate(STAGE_BLOCKS.items()):
        print(f"\n# fitting {stage}: {','.join(block_names)}", flush=True)
        X = sparse.hstack([blocks[name] for name in block_names], format="csr", dtype=np.float32)
        top3_y = y_by_target["top3"]
        alpha, val_probability, test_probability = fit_with_alpha_search(
            X, top3_y, train, validation, test, alphas, args.seed + stage_index
        )
        chosen_alphas[stage] = alpha
        predictions["top3"][stage] = {"validation": val_probability, "test": test_probability}
        results["top3"]["stages"][stage] = {
            "alpha": alpha,
            "validation": metric_bundle(
                top3_y[validation], val_probability, ds.gid[validation], ds.rank[validation], "top3"
            ),
            "test": metric_bundle(
                top3_y[test], test_probability, ds.gid[test], ds.rank[test], "top3"
            ),
        }
        print(
            f"  top3 alpha={alpha:g} testAUC={results['top3']['stages'][stage]['test']['auc']:.4f}",
            flush=True,
        )

        for target in targets:
            if target == "top3":
                continue
            y = y_by_target[target]
            val_probability, test_probability = fit_fixed_alpha(
                X, y, train, validation, test, alpha, args.seed + stage_index + 101
            )
            predictions[target][stage] = {"validation": val_probability, "test": test_probability}
            results[target]["stages"][stage] = {
                "alpha": alpha,
                "validation": metric_bundle(
                    y[validation], val_probability, ds.gid[validation], ds.rank[validation], target
                ),
                "test": metric_bundle(y[test], test_probability, ds.gid[test], ds.rank[test], target),
            }
        del X
        gc.collect()

    stage_names = list(STAGE_BLOCKS)
    y_test = y_by_target["top3"][test]
    for position in range(1, len(stage_names)):
        current, previous = stage_names[position], stage_names[position - 1]
        results["top3"]["deltas"][current] = bootstrap_delta(
            y_test,
            predictions["top3"][current]["test"],
            predictions["top3"][previous]["test"],
            ds.gid[test],
            args.bootstrap,
            args.seed + position * 31,
        )

    sensitivity = {}
    sensitivity_scales = (0.0, 0.1, 0.25, 0.5, 0.75, 1.0)
    sensitivity_ensemble = predictions["top3"][stage_names[0]]
    for position in range(1, len(stage_names)):
        current, previous = stage_names[position], stage_names[position - 1]
        sensitivity[current], sensitivity_ensemble = incremental_sensitivity(
            y_by_target["top3"][validation],
            y_test,
            sensitivity_ensemble,
            predictions["top3"][previous],
            predictions["top3"][current],
            sensitivity_scales,
        )
    sensitivity_ensemble_metrics = metric_bundle(
        y_test,
        sensitivity_ensemble["test"],
        ds.gid[test],
        ds.rank[test],
        "top3",
    )

    full_blocks = list(STAGE_BLOCKS["+triple"])
    full_alpha = chosen_alphas["+triple"]
    ablations = {}
    for position, omitted in enumerate(("solo", "popularity", "structure", "pair", "pair_role", "triple")):
        names = [name for name in full_blocks if name != omitted]
        print(f"# ablation without {omitted}", flush=True)
        X = sparse.hstack([blocks[name] for name in names], format="csr", dtype=np.float32)
        _, test_probability = fit_fixed_alpha(
            X,
            y_by_target["top3"],
            train,
            validation,
            test,
            full_alpha,
            args.seed + 500 + position,
        )
        ablations[omitted] = metric_bundle(
            y_by_target["top3"][test], test_probability, ds.gid[test], ds.rank[test]
        )
        del X
        gc.collect()

    y_validation = y_by_target["top3"][validation]
    rule_baselines = {
        "structure": "+popularity",
        "pair": "+structure",
        "pair_role": "+pair",
        "triple": "+pair_role",
    }
    rules = {}
    for group, baseline_stage in rule_baselines.items():
        rules[group] = stable_rule_report(
            ds,
            validation,
            test,
            y_validation - predictions["top3"][baseline_stage]["validation"],
            y_test - predictions["top3"][baseline_stage]["test"],
            group,
            metadata,
            weapon_ranges,
            args.min_rule_validation,
            args.min_rule_test,
            args.rule_fdr,
            args.top_rules,
        )

    date_counts = Counter(map(int, ds.date))
    report = {
        "schemaVersion": 3,
        "method": {
            "model": "L2-regularized hashed logistic SGD",
            "trainingPasses": 50,
            "split": "chronological whole-day holdout",
            "deduplication": "first gameId:teamKey across all shards",
            "targets": targets,
            "alphas": alphas,
            "bootstrapGames": args.bootstrap,
            "ruleFdr": args.rule_fdr,
            "stageBlocks": {key: list(value) for key, value in STAGE_BLOCKS.items()},
            "hashDimensions": HASH_DIMS,
            "popularity": "train-only standardized character and variant log pick rates",
            "sensitivityScales": list(sensitivity_scales),
        },
        "data": {
            "archiveDir": str(archive_dir.relative_to(ROOT)).replace("\\", "/"),
            "rawLines": ds.stats.get("rawLines", 0),
            "duplicatesRemoved": ds.stats.get("duplicates", 0),
            "uniqueValidTeams": len(ds.rank),
            "invalidTeamSize": ds.stats.get("invalidTeamSize", 0),
            "unknownOrDuplicateCharacter": ds.stats.get("unknownOrDuplicateCharacter", 0),
            "dateCounts": {iso_date(key): value for key, value in sorted(date_counts.items())},
        },
        "split": {
            "train": {
                "count": len(train),
                "dates": f"{iso_date(int(ds.date.min()))}~{iso_date(train_cut)}",
            },
            "validation": {
                "count": len(validation),
                "dates": f"{iso_date(train_cut + 1)}~{iso_date(val_cut)}",
            },
            "test": {
                "count": len(test),
                "dates": f"{iso_date(val_cut + 1)}~{iso_date(int(ds.date.max()))}",
            },
        },
        "targets": results,
        "ablations": ablations,
        "sensitivity": sensitivity,
        "sensitivityEnsemble": sensitivity_ensemble_metrics,
        "rules": rules,
    }
    report = round_metrics(report)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    out_md.write_text(render_markdown(report), encoding="utf-8")
    print(f"\nSaved {out_json.relative_to(ROOT)}")
    print(f"Saved {out_md.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
