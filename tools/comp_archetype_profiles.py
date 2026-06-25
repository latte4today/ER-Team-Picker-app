#!/usr/bin/env python3
"""
조합 아키타입 프로파일러.

전체 팀을 역할 골격(F=전열[frontline+bruiser] / D=딜러[ranged+mage+assassin] / S=서폿)으로
나눈다(f+d+s=3 → 정확히 ≤10개 구성). 각 구성별로 실측 특징을 뽑는다:
  - 인기(share, 티어별)
  - 성과: win%(천장) / top3% / bottom%(바닥) / meanPlc / stdPlc(일관성)
  - 티어 민감도: top3 lift의 iron→demigod 기울기 (양수=기량 보상형/고티어 유리)
  - 교전 시그니처: 팀 평균 가한딜/받은딜/딜비/CC시간/힐
  - 플레이스타일 태그 분포 (dive/poke/sustain/cc/burst…)
  - 대표 캐릭터 top5

→ 이 프로파일을 근거로 "픽 + 티어"에 맞는 아키타입을 추천할 수 있다.

사용:
  python tools/comp_archetype_profiles.py --data reports/generated/latest-official-archive.normalized.jsonl
  python tools/comp_archetype_profiles.py --data ... --min 800   # 최소표본
"""
import argparse
import json
import math
from collections import Counter, defaultdict

FRONT_ROLES = {"frontline", "bruiser"}
DEALER_ROLES = {"ranged", "mage", "assassin"}
TIERS = ["iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"]
PLAYSTYLE_TAGS = ["dive", "poke", "zone", "burst", "pick", "duel", "cc", "initiate",
                  "engage", "sustain", "sustained", "peel", "shield", "healing", "mobility", "range"]

LABELS = {
    "F1/D2/S0": "정석 (1전열·2딜)",
    "F2/D1/S0": "더블전열·1딜",
    "F0/D3/S0": "노탱 3딜",
    "F3/D0/S0": "트리플 전열",
    "F2/D0/S1": "더블전열·서폿",
    "F1/D1/S1": "밸런스·서폿",
    "F0/D2/S1": "2딜·서폿 (노탱)",
    "F1/D0/S2": "1전열·2서폿",
    "F0/D1/S2": "1딜·2서폿",
    "F0/D0/S3": "트리플 서폿",
    "F3/D0/S0 ": "",
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--min", type=int, default=500, help="프로파일 출력 최소 표본")
    p.add_argument("--bottom", type=int, default=6)
    return p.parse_args()


def skeleton(members):
    f = sum(1 for m in members if m.get("role") in FRONT_ROLES)
    d = sum(1 for m in members if m.get("role") in DEALER_ROLES)
    s = sum(1 for m in members if m.get("role") == "support")
    return f"F{f}/D{d}/S{s}"


class Acc:
    __slots__ = ("n", "win", "top3", "bottom", "plc_s", "plc_s2",
                 "dealt", "taken", "cc", "heal", "tags", "chars")

    def __init__(self):
        self.n = 0
        self.win = 0
        self.top3 = 0
        self.bottom = 0
        self.plc_s = 0.0
        self.plc_s2 = 0.0
        self.dealt = 0.0
        self.taken = 0.0
        self.cc = 0.0
        self.heal = 0.0
        self.tags = Counter()
        self.chars = Counter()

    def add(self, members, plc, top3, bottom_cut):
        self.n += 1
        self.top3 += top3
        if plc and plc > 0:
            self.plc_s += plc
            self.plc_s2 += plc * plc
            if plc == 1:
                self.win += 1
            if plc >= bottom_cut:
                self.bottom += 1
        for m in members:
            st = m.get("stats") or {}
            self.dealt += float(st.get("damageToPlayer", 0) or 0)
            self.taken += float(st.get("damageFromPlayer", 0) or 0)
            self.cc += float(st.get("ccTime", 0) or 0)
            self.heal += float(st.get("healAmount", 0) or 0)
            cid = m.get("characterId")
            if cid:
                self.chars[cid] += 1
            for tg in (m.get("tags") or []):
                if tg in PLAYSTYLE_TAGS:
                    self.tags[tg] += 1

    def rate(self, k):
        return getattr(self, k) / self.n if self.n else 0

    def std(self):
        if self.n == 0:
            return 0
        mean = self.plc_s / self.n
        return math.sqrt(max(0.0, self.plc_s2 / self.n - mean * mean))


def main():
    args = parse_args()
    overall = defaultdict(Acc)          # skel -> Acc
    by_tier = defaultdict(lambda: defaultdict(Acc))  # tier -> skel -> Acc
    tier_base = defaultdict(Acc)        # tier -> Acc (전체)
    total = 0

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
            res = t.get("result") or {}
            plc = res.get("placement")
            top3 = 1 if res.get("isTop3") else 0
            sk = skeleton(members)
            total += 1
            overall[sk].add(members, plc, top3, args.bottom)
            by_tier[tier][sk].add(members, plc, top3, args.bottom)
            tier_base[tier].add(members, plc, top3, args.bottom)

    if total == 0:
        print("표본 0")
        return

    print(f"# comp archetype profiles  data={args.data}  teams={total}\n")
    skels = sorted(overall, key=lambda s: -overall[s].n)
    for sk in skels:
        a = overall[sk]
        if a.n < args.min:
            continue
        label = LABELS.get(sk, "")
        share = a.n / total
        mtotal = a.n * 3  # 멤버 수
        print(f"== {sk}  {label}   n={a.n} ({share*100:.1f}%) ==")
        print(f"   성과: win {a.rate('win')*100:.1f}%  top3 {a.rate('top3')*100:.1f}%  "
              f"bottom {a.rate('bottom')*100:.1f}%  meanPlc {a.plc_s/a.n:.2f}  stdPlc {a.std():.2f}")
        # 티어별 top3 lift (그 티어 baseline 대비) + 기울기
        lifts = []
        cells = []
        for tier in TIERS:
            at = by_tier[tier].get(sk)
            bt = tier_base[tier]
            if at and at.n >= 50 and bt.n:
                lift = at.rate("top3") - bt.rate("top3")
                lifts.append((tier, lift, at.n))
                cells.append(f"{tier.split('_')[0]} {lift*100:+.1f}({at.n})")
            else:
                cells.append(f"{tier.split('_')[0]} -")
        slope = ""
        if len(lifts) >= 2:
            slope = f"  기울기(저→고) {((lifts[-1][1]-lifts[0][1])*100):+.1f}"
        print(f"   티어별 top3 lift: {'  '.join(cells)}{slope}")
        # 교전 시그니처 (멤버 평균)
        print(f"   교전: 가한딜 {a.dealt/mtotal:,.0f}  받은딜 {a.taken/mtotal:,.0f}  "
              f"딜비 {a.dealt/max(1,a.taken):.2f}  CC {a.cc/mtotal:.1f}s  힐 {a.heal/mtotal:,.0f}")
        # 플레이스타일 + 대표 캐릭
        topstyle = ", ".join(f"{k} {v/mtotal*100:.0f}%" for k, v in a.tags.most_common(5))
        topchar = ", ".join(f"{k}({v})" for k, v in a.chars.most_common(6))
        print(f"   스타일: {topstyle}")
        print(f"   대표캐릭: {topchar}\n")

    print("판독: win%(천장)·bottom%(바닥)·stdPlc(일관성)·티어기울기로 각 구성의 '위험/난이도' 프로파일을 본다.")
    print("  기울기 +가 크면 고티어 보상형(저티어 비권장), 평탄하면 어느 티어나 무난.")


if __name__ == "__main__":
    main()
