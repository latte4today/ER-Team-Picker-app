#!/usr/bin/env python3
"""
조합 패턴의 '위험 프로파일' × 티어 상호작용.

평균(top3율)만 보면 조합 효과가 작게 보인다. 하지만 가설은 분산이다:
'전열 없는 / 삼후방' 같은 하드 조합은 천장은 높고 바닥도 깊은 boom-or-bust이고,
그 분산을 개인 기량(=티어)이 흡수한다 → 같은 조합이 고티어에선 안정적,
저티어에선 극단적. 그래서 추천은 '평균 승률'이 아니라 '플레이어 기량에 맞춘
위험 프로파일(스펙트럼)'이어야 한다.

이 스크립트는 패턴×티어별로:
  - win%   = 1등 비율 (천장/ceiling)
  - top3%
  - bottom% = placement>=6 (바닥/floor)
  - meanPlc, stdPlc (분산=일관성; 클수록 boom-or-bust)
를 직접 센다. 모델 없음.

핵심 검정: 하드 조합(no_frontline 등)의 stdPlc·bottom%가 저티어에서 크고
고티어로 갈수록 줄면 → "조합×기량" 상호작용 실재 = 티어별 스펙트럼 추천 정당.

사용:
  python tools/comp_risk_profile.py --data reports/generated/latest-official-archive.normalized.jsonl --tiers all
"""
import argparse
import json
import math
from collections import Counter, defaultdict

CC_TAGS = {"cc", "initiate", "engage"}
DEALER_ROLES = {"ranged", "mage", "assassin"}
FRONT_ROLES = {"frontline", "bruiser"}
TIER_ORDER = ["iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--tiers", default="all")
    p.add_argument("--bottom", type=int, default=6, help="이 등수 이상이면 '바닥'으로 집계")
    return p.parse_args()


def buckets_for(members):
    rc = Counter(m.get("role") for m in members)
    cc = sum(1 for m in members if set(m.get("tags") or []) & CC_TAGS)
    front = sum(rc[r] for r in FRONT_ROLES)
    dealer = sum(rc[r] for r in DEALER_ROLES)
    support = rc.get("support", 0)
    out = ["__all__"]
    if front >= 1 and dealer >= 1 and support <= 1:
        out.append("balanced")
    if front == 0:
        out.append("no_frontline")
    if dealer == 0:
        out.append("no_dealer")
    if rc and max(rc.values()) == 3:
        out.append("triple_same_role")
    if (rc.get("ranged", 0) + rc.get("mage", 0)) == 3 and cc == 0:
        out.append("triple_backline_no_cc")
    return out


class Acc:
    __slots__ = ("n", "win", "top3", "bottom", "s", "s2")

    def __init__(self):
        self.n = 0
        self.win = 0
        self.top3 = 0
        self.bottom = 0
        self.s = 0.0
        self.s2 = 0.0

    def add(self, plc, top3):
        self.n += 1
        self.top3 += top3
        if plc and plc > 0:
            self.s += plc
            self.s2 += plc * plc
            if plc == 1:
                self.win += 1

    def add_bottom(self, plc, bottom_cut):
        if plc and plc >= bottom_cut:
            self.bottom += 1

    def stats(self):
        if self.n == 0:
            return None
        mean = self.s / self.n
        var = max(0.0, self.s2 / self.n - mean * mean)
        return {
            "n": self.n,
            "win": self.win / self.n,
            "top3": self.top3 / self.n,
            "bottom": self.bottom / self.n,
            "mean": mean,
            "std": math.sqrt(var),
        }


def main():
    args = parse_args()
    tierset = None if (not args.tiers or args.tiers == "all") else set(args.tiers.split(","))
    data = defaultdict(lambda: defaultdict(Acc))  # tier -> bucket -> Acc
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
            plc = res.get("placement")
            top3 = 1 if res.get("isTop3") else 0
            rows += 1
            for b in buckets_for(members):
                acc = data[tier][b]
                acc.add(plc, top3)
                acc.add_bottom(plc, args.bottom)

    if rows == 0:
        print("표본 0")
        return

    print(f"# comp risk profile  data={args.data}  tiers={args.tiers}  rows={rows}  bottom>=#{args.bottom}\n")
    order = ["balanced", "no_frontline", "no_dealer", "triple_same_role", "triple_backline_no_cc"]
    tiers = [x for x in TIER_ORDER if x in data] + [x for x in data if x not in TIER_ORDER]

    for tier in tiers:
        alls = data[tier]["__all__"].stats()
        print(f"== {tier}  (teams={alls['n']}, win={alls['win']*100:.1f}% top3={alls['top3']*100:.1f}% "
              f"meanPlc={alls['mean']:.2f} stdPlc={alls['std']:.2f}) ==")
        print(f"   {'bucket':<24}{'n':>8}{'win%':>8}{'top3%':>8}{'bottom%':>9}{'meanPlc':>9}{'stdPlc':>8}")
        for b in order:
            st = data[tier][b].stats()
            if not st:
                print(f"   {b:<24}{0:>8}{'-':>8}{'-':>8}{'-':>9}{'-':>9}{'-':>8}")
                continue
            print(f"   {b:<24}{st['n']:>8}{st['win']*100:>7.1f}{st['top3']*100:>8.1f}"
                  f"{st['bottom']*100:>8.1f}{st['mean']:>9.2f}{st['std']:>8.2f}")
        print()

    print("판독 (핵심 = 분산×티어 상호작용):")
    print("  - 하드 조합(no_frontline 등)의 stdPlc·bottom%가 저티어↑ 고티어↓ 로 줄면")
    print("    → 같은 조합도 기량이 분산을 흡수 = '조합×기량' 상호작용 실재 → 티어별 스펙트럼 추천 정당.")
    print("  - 하드 조합이 win%(천장)는 높은데 bottom%(바닥)도 높으면 = boom-or-bust(고위험·고보상).")
    print("  - 안전 조합(balanced)은 win/bottom/std가 더 평탄할 것 — 저기량에 권장할 형태.")


if __name__ == "__main__":
    main()
