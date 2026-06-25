#!/usr/bin/env python3
"""
아키타입별 '필요 파라미터' 정의 — 데이터 기반.

캐릭터 파라미터(dmg/tank/protect/heal/cc, 0~10 percentile)를 먼저 도출하고,
각 조합 골격(F/D/S)에 속한 팀들의 *멤버 평균 파라미터*를 낸다. 이것이
"이 아키타입을 굴리려면 파라미터가 대략 이 정도여야 한다"는 실측 요구 시그니처.

또한 정직 체크: 각 아키타입 안에서 팀 파라미터 합이 높은 절반 vs 낮은 절반의
top3율을 비교 → '그 파라미터를 더 채우면 그 조합에서 실제로 더 잘하나'.

사용:
  python tools/archetype_param_requirements.py --data reports/generated/latest-official-archive.normalized.jsonl
"""
import argparse
import json
from collections import Counter, defaultdict

FRONT_ROLES = {"frontline", "bruiser"}
DEALER_ROLES = {"ranged", "mage", "assassin"}
METRICS = ["dmg", "tank", "protect", "heal", "cc"]
STAT_KEY = {"dmg": "damageToPlayer", "tank": "damageFromPlayer",
            "protect": "protectAbsorb", "heal": "healAmount", "cc": "ccTime"}
LABELS = {"F2/D1/S0": "더블전열·1딜", "F1/D2/S0": "정석", "F3/D0/S0": "트리플전열",
          "F0/D3/S0": "노탱3딜", "F2/D0/S1": "더블전열·서폿", "F1/D1/S1": "밸런스·서폿",
          "F0/D2/S1": "2딜·서폿"}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--min", type=int, default=800)
    return p.parse_args()


def pct_rank(sv, x):
    lo, hi = 0, len(sv)
    while lo < hi:
        m = (lo + hi) // 2
        if sv[m] <= x:
            lo = m + 1
        else:
            hi = m
    return (lo / len(sv)) * 10 if sv else 0


def skeleton(members):
    f = sum(1 for m in members if m.get("role") in FRONT_ROLES)
    d = sum(1 for m in members if m.get("role") in DEALER_ROLES)
    s = sum(1 for m in members if m.get("role") == "support")
    return f"F{f}/D{d}/S{s}"


def main():
    args = parse_args()
    # pass 1: 캐릭터 평균 스탯
    cagg = defaultdict(lambda: {"n": 0, **{k: 0.0 for k in METRICS}})
    teams = []
    with open(args.data, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                t = json.loads(line)
            except json.JSONDecodeError:
                continue
            members = t.get("members") or []
            if len(members) != 3:
                continue
            top3 = 1 if (t.get("result") or {}).get("isTop3") else 0
            teams.append((members, top3))
            for m in members:
                cid = m.get("characterId")
                if not cid:
                    continue
                a = cagg[cid]
                a["n"] += 1
                st = m.get("stats") or {}
                for k in METRICS:
                    a[k] += float(st.get(STAT_KEY[k], 0) or 0)

    chars = [c for c, a in cagg.items() if a["n"] >= 100]
    cmean = {c: {k: cagg[c][k] / cagg[c]["n"] for k in METRICS} for c in chars}
    sv = {k: sorted(cmean[c][k] for c in chars) for k in METRICS}
    cparam = {c: {k: pct_rank(sv[k], cmean[c][k]) for k in METRICS} for c in chars}

    # pass 2: 아키타입별 멤버 평균 파라미터 + 팀합 분위 성과
    arch = defaultdict(lambda: {"n": 0, **{k: 0.0 for k in METRICS}, "dmgsum": []})
    for members, top3 in teams:
        sk = skeleton(members)
        a = arch[sk]
        a["n"] += 1
        dmgsum = 0.0
        for m in members:
            cp = cparam.get(m.get("characterId"))
            if not cp:
                continue
            for k in METRICS:
                a[k] += cp[k]
            dmgsum += cp["dmg"]
        a["dmgsum"].append((dmgsum, top3))

    print(f"# archetype param requirements  teams={len(teams)}  (멤버평균 0~10)\n")
    print(f"{'archetype':<14}{'label':<14}{'n':>8}{'dmg':>6}{'tank':>6}{'prot':>6}{'heal':>6}{'cc':>6}   dmg채움 top3(상/하)")
    for sk in sorted(arch, key=lambda s: -arch[s]["n"]):
        a = arch[sk]
        if a["n"] < args.min:
            continue
        mem = a["n"] * 3
        prof = {k: a[k] / mem for k in METRICS}
        # dmg 합 상/하위 절반 top3
        ds = sorted(a["dmgsum"])
        half = len(ds) // 2
        lo_t3 = sum(t for _, t in ds[:half]) / max(1, half)
        hi_t3 = sum(t for _, t in ds[half:]) / max(1, len(ds) - half)
        print(f"{sk:<14}{LABELS.get(sk,''):<14}{a['n']:>8}"
              f"{prof['dmg']:>6.1f}{prof['tank']:>6.1f}{prof['protect']:>6.1f}"
              f"{prof['heal']:>6.1f}{prof['cc']:>6.1f}   {hi_t3*100:>5.1f}% / {lo_t3*100:>4.1f}%")

    print("\n판독:")
    print("  - 멤버평균 dmg/tank/...가 그 아키타입의 '요구 시그니처'(노탱3딜=dmg↑tank↓, 트리플전열=tank↑dmg↓ 등).")
    print("  - 'dmg채움 top3(상/하)': 그 조합 안에서 딜 파라미터 더 채운 팀이 더 잘하나. 차이 크면 '그 조합엔 딜 더 필요' 실증.")
    print("  - 추천: 픽으로 골격 정하고, 그 골격의 요구 시그니처에 부족한 파라미터를 채우는 캐릭을 권한다.")


if __name__ == "__main__":
    main()
