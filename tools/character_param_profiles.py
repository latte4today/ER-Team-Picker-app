#!/usr/bin/env python3
"""
캐릭터별 '파라미터' 프로파일 — 실제 전투 스탯에서 데이터로 도출.

역할 라벨(특히 브루저)은 거칠다: 같은 브루저라도 데미지형/탱형/어그로핑퐁형이
섞여 있다. 손라벨 대신 각 캐릭터의 실제 평균 전투 스탯을 로스터 percentile(0~10)로
환산해 파라미터 프로파일을 만든다:
  dmg    = 가한 데미지(damageToPlayer)        → 화력
  tank   = 받은 데미지(damageFromPlayer)       → 어그로 흡수/전선 체류
  protect= 보호막 흡수(protectAbsorb)          → 보호/방어 유틸
  heal   = 힐량(healAmount)                    → 유지/회복
  cc     = ccTime                              → 군중제어
  + 참고: top3%(멤버 귀속) = solo 강함

브루저는 dmg vs (tank/protect)로 형(型)을 자동 힌트한다(DMG형/탱형/하이브리드).
이 파라미터가 (1) 골격 재분류(데미지 브루저→딜러), (2) "아키타입별 필요 파라미터"의 토대.

사용:
  python tools/character_param_profiles.py --data reports/generated/latest-official-archive.normalized.jsonl
  python tools/character_param_profiles.py --data ... --role bruiser   # 특정 역할만
"""
import argparse
import json
from collections import Counter, defaultdict


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--role", default=None, help="특정 역할만 출력(예: bruiser)")
    p.add_argument("--min-games", type=int, default=200)
    return p.parse_args()


METRICS = ["dmg", "tank", "protect", "heal", "cc"]
STAT_KEY = {"dmg": "damageToPlayer", "tank": "damageFromPlayer",
            "protect": "protectAbsorb", "heal": "healAmount", "cc": "ccTime"}


def pct_rank(sorted_vals, x):
    lo, hi = 0, len(sorted_vals)
    while lo < hi:
        m = (lo + hi) // 2
        if sorted_vals[m] <= x:
            lo = m + 1
        else:
            hi = m
    return (lo / len(sorted_vals)) * 10 if sorted_vals else 0


def main():
    args = parse_args()
    agg = defaultdict(lambda: {"n": 0, "dmg": 0.0, "tank": 0.0, "protect": 0.0,
                               "heal": 0.0, "cc": 0.0, "top3": 0, "roles": Counter()})
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
            for m in members:
                cid = m.get("characterId")
                if not cid:
                    continue
                a = agg[cid]
                a["n"] += 1
                a["top3"] += top3
                a["roles"][m.get("role")] += 1
                st = m.get("stats") or {}
                for k in METRICS:
                    a[k] += float(st.get(STAT_KEY[k], 0) or 0)

    chars = [c for c, a in agg.items() if a["n"] >= args.min_games]
    if not chars:
        print("표본 부족")
        return

    # 캐릭터 평균
    means = {}
    for c in chars:
        a = agg[c]
        means[c] = {k: a[k] / a["n"] for k in METRICS}
        means[c]["top3"] = a["top3"] / a["n"]
        means[c]["role"] = a["roles"].most_common(1)[0][0]
        means[c]["n"] = a["n"]

    # metric별 percentile 척도
    sorted_vals = {k: sorted(means[c][k] for c in chars) for k in METRICS}
    for c in chars:
        for k in METRICS:
            means[c][k + "_p"] = pct_rank(sorted_vals[k], means[c][k])

    def flavor(m):
        if m["role"] != "bruiser":
            return ""
        d, tk, pr = m["dmg_p"], m["tank_p"], m["protect_p"]
        if d >= 6 and pr < 5 and tk < 6:
            return "DMG형"
        if (pr >= 6 or tk >= 7) and d < 5:
            return "탱형"
        return "하이브리드"

    roles_order = ["frontline", "bruiser", "assassin", "ranged", "mage", "support"]
    print(f"# character param profiles  data={args.data}  chars={len(chars)}  (값=0~10 percentile)\n")
    print(f"{'char':<16}{'role':<10}{'games':>7}{'dmg':>6}{'tank':>6}{'prot':>6}{'heal':>6}{'cc':>6}{'top3%':>7}  flavor")
    show_roles = [args.role] if args.role else roles_order
    for role in show_roles:
        rc = [c for c in chars if means[c]["role"] == role]
        rc.sort(key=lambda c: -means[c]["dmg_p"])
        if not rc:
            continue
        print(f"--- {role} ({len(rc)}) ---")
        for c in rc:
            m = means[c]
            print(f"{c:<16}{role:<10}{m['n']:>7}{m['dmg_p']:>6.1f}{m['tank_p']:>6.1f}"
                  f"{m['protect_p']:>6.1f}{m['heal_p']:>6.1f}{m['cc_p']:>6.1f}{m['top3']*100:>6.1f}  {flavor(m)}")
        print()

    # 브루저 형 분포 요약
    br = [c for c in chars if means[c]["role"] == "bruiser"]
    if br:
        fc = Counter(flavor(means[c]) for c in br)
        print(f"브루저 형 분포: {dict(fc)}  → 'F'(전열) 골격에 DMG형 브루저가 섞이면 딜러로 재분류 검토.")


if __name__ == "__main__":
    main()
