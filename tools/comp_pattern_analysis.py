#!/usr/bin/env python3
"""
조합 '역할 패턴' 분포·성과 분석.

질문: 학습형 천장이 조합 신호를 못 잡은 게, 조합이 무의미해서인가
      아니면 상위권이 이미 합리적 조합만 써서 '파탄 조합'이 데이터에서
      빠졌기(선택 편향/restricted range) 때문인가?

천장 분석은 '존재하는 조합들 사이'의 효과를 본다. 만약 3서폿/3탱/노프론트/
노CC-3원딜 같은 극단(나쁜) 패턴이 표본에 거의 없다면 그 효과는 측정 불가다.

이 스크립트는 (1) 역할 패턴 분포와 (2) 극단 패턴의 실제 성과(top3율/평균등수)를
티어별로 직접 센다. 모델 없음 — 순수 빈도/성과.

사용:
  python tools/comp_pattern_analysis.py --data reports/generated/latest-official-archive.normalized.jsonl --tiers all
"""
import argparse
import json
from collections import Counter, defaultdict


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--tiers", default="all", help="쉼표구분 필터 또는 all")
    return p.parse_args()


CC_TAGS = {"cc", "initiate", "engage"}
DEALER_ROLES = {"ranged", "mage", "assassin"}
FRONT_ROLES = {"frontline", "bruiser"}


def classify(members):
    rc = Counter(m.get("role") for m in members)
    cc = sum(1 for m in members if set(m.get("tags") or []) & CC_TAGS)
    front = sum(rc[r] for r in FRONT_ROLES)
    dealer = sum(rc[r] for r in DEALER_ROLES)
    support = rc.get("support", 0)
    flags = []
    if front == 0:
        flags.append("no_frontline")
    if dealer == 0:
        flags.append("no_dealer")
    if support == 3:
        flags.append("triple_support")
    if rc and max(rc.values()) == 3:
        flags.append("triple_same_role")
    if (rc.get("ranged", 0) + rc.get("mage", 0)) == 3 and cc == 0:
        flags.append("triple_backline_no_cc")
    if front == 0 and cc == 0:
        flags.append("no_front_no_cc")
    if front >= 1 and dealer >= 1 and support <= 1:
        flags.append("balanced")
    # 정규 역할 패턴 키 (front/dealer/support 카운트)
    pattern = f"F{front}/D{dealer}/S{support}"
    return flags, pattern


def main():
    args = parse_args()
    tierset = None if (not args.tiers or args.tiers == "all") else set(args.tiers.split(","))

    # tier -> bucket -> [n, top3, plc_sum, plc_n]
    stat = defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0, 0]))
    patterns = defaultdict(Counter)  # tier -> pattern -> n
    rows = 0

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
            tier = t.get("tierBucket", "unknown")
            if tierset is not None and tier not in tierset:
                continue
            res = t.get("result") or {}
            top3 = 1 if res.get("isTop3") else 0
            plc = res.get("placement")
            flags, pattern = classify(members)
            rows += 1
            patterns[tier][pattern] += 1
            for bucket in flags + ["__all__"]:
                s = stat[tier][bucket]
                s[0] += 1
                s[1] += top3
                if isinstance(plc, (int, float)) and plc > 0:
                    s[2] += plc
                    s[3] += 1

    if rows == 0:
        print("표본 0 — --data/--tiers 확인")
        return

    print(f"# comp pattern analysis  data={args.data}  tiers={args.tiers}  rows={rows}\n")

    order = ["balanced", "no_frontline", "no_dealer", "triple_support",
             "triple_same_role", "triple_backline_no_cc", "no_front_no_cc"]

    for tier in sorted(stat):
        base = stat[tier]["__all__"]
        base_top3 = base[1] / base[0] if base[0] else 0
        base_plc = base[2] / base[3] if base[3] else 0
        print(f"== {tier}  (teams={base[0]}, baseline top3={base_top3*100:.1f}%, avgPlc={base_plc:.2f}) ==")
        print(f"   {'bucket':<22}{'n':>8}{'share':>9}{'top3%':>9}{'lift':>9}{'avgPlc':>9}")
        for bucket in order:
            s = stat[tier].get(bucket)
            if not s or s[0] == 0:
                print(f"   {bucket:<22}{0:>8}{'-':>9}{'-':>9}{'-':>9}{'-':>9}")
                continue
            n = s[0]
            share = n / base[0]
            top3 = s[1] / n
            plc = s[2] / s[3] if s[3] else 0
            lift = top3 - base_top3
            print(f"   {bucket:<22}{n:>8}{share*100:>8.2f}%{top3*100:>8.1f}%{lift*100:>+8.1f}{plc:>9.2f}")
        # 상위 역할패턴 분포
        toppat = patterns[tier].most_common(8)
        tot = sum(patterns[tier].values())
        patstr = ", ".join(f"{p}:{c/tot*100:.0f}%" for p, c in toppat)
        print(f"   상위 역할패턴(F=전열 D=딜러 S=서폿): {patstr}\n")

    print("판독:")
    print("  - 극단 패턴(no_frontline/no_dealer/triple_*)의 share가 ~0%면 → 데이터에 '나쁜 조합'이 없음")
    print("    = 사람들이 이미 조합을 맞춤(선택 편향) → 천장이 그 효과를 측정 못 한 것(당신 가설 지지).")
    print("  - 극단 패턴이 충분히 있는데 lift가 음(−)이면 → 나쁜 조합은 실제로 진다(조합 효과 실재, 모델이 평균에 묻혀 못 잡음).")
    print("  - 극단 패턴이 있는데 lift ≈ 0이면 → 진짜로 조합 무관.")


if __name__ == "__main__":
    main()
