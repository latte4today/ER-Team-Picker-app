#!/usr/bin/env python3
"""
조합 모델 아티팩트 빌더 → src/compModel.json

아카이브 정규화 데이터에서 (매직넘버 없이) 다음을 계산해 앱 번들용 JSON으로 굽는다:
  characters[cid] = {role, effRole, function, params{dmg,tank,protect,heal,cc}, soloTop3, games}
    - params: 실제 전투 스탯의 로스터 percentile(0~10)
    - effRole: 골격용 역할. 브루저는 다축 복합(딜러성 dmg − 비딜성 평균)으로 D/F 재분류.
    - function: 5축 중 최고 → DPS/TANK/GUARD/SUSTAIN/CC
  archetypes[skel] = {label, n, share, requirement{params}, profile{win,top3,bottom,std,dmgRatio},
                      tierSlope, topChars}
    - skel: effRole 기준 F/D/S 골격 (브루저 재분류 반영)

사용:
  python tools/build_comp_model.py --data reports/generated/latest-official-archive.normalized.jsonl --out src/compModel.json
"""
import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone

METRICS = ["dmg", "tank", "protect", "heal", "cc"]
STAT_KEY = {"dmg": "damageToPlayer", "tank": "damageFromPlayer",
            "protect": "protectAbsorb", "heal": "healAmount", "cc": "ccTime"}
FUNC = {"dmg": "DPS", "tank": "TANK", "protect": "GUARD", "heal": "SUSTAIN", "cc": "CC"}
DEALER_ROLES = {"ranged", "mage", "assassin"}
TIERS = ["iron_gold", "platinum_diamond", "meteor_mithril", "demigod_eternity"]
LABELS = {"F2/D1/S0": "더블전열·1딜", "F1/D2/S0": "정석", "F3/D0/S0": "트리플전열",
          "F0/D3/S0": "노탱3딜", "F2/D0/S1": "더블전열·서폿", "F1/D1/S1": "밸런스·서폿",
          "F0/D2/S1": "2딜·서폿"}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--out", default="src/compModel.js",
                   help=".js면 'export const compModel=...' 모듈로, .json이면 순수 JSON으로 출력")
    p.add_argument("--min-games", type=int, default=200)
    p.add_argument("--min-arch", type=int, default=800)
    p.add_argument("--bruiser-margin", type=float, default=1.0,
                   help="브루저: dmg − (tank,protect,heal,cc 평균) 이 값 이상이면 딜러(D)로 재분류")
    return p.parse_args()


def pct_rank(sv, x):
    lo, hi = 0, len(sv)
    while lo < hi:
        m = (lo + hi) // 2
        if sv[m] <= x:
            lo = m + 1
        else:
            hi = m
    return round((lo / len(sv)) * 10, 1) if sv else 0


def main():
    args = parse_args()
    cagg = defaultdict(lambda: {"n": 0, "top3": 0, "roles": Counter(), **{k: 0.0 for k in METRICS}})
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
            res = t.get("result") or {}
            top3 = 1 if res.get("isTop3") else 0
            plc = res.get("placement")
            tier = t.get("tierBucket", "unknown")
            teams.append((members, top3, plc, tier))
            for m in members:
                cid = m.get("characterId")
                if not cid:
                    continue
                a = cagg[cid]
                a["n"] += 1
                a["top3"] += top3
                a["roles"][m.get("role")] += 1
                st = m.get("stats") or {}
                for k in METRICS:
                    a[k] += float(st.get(STAT_KEY[k], 0) or 0)

    chars = [c for c, a in cagg.items() if a["n"] >= args.min_games]
    cmean = {c: {k: cagg[c][k] / cagg[c]["n"] for k in METRICS} for c in chars}
    sv = {k: sorted(cmean[c][k] for c in chars) for k in METRICS}

    characters = {}
    eff_role = {}  # cid -> 'F'/'D'/'S'
    for c in chars:
        a = cagg[c]
        params = {k: pct_rank(sv[k], cmean[c][k]) for k in METRICS}
        role = a["roles"].most_common(1)[0][0]
        # 기능 라벨 = 최고 축
        func = FUNC[max(METRICS, key=lambda k: params[k])]
        # 골격 effRole
        if role in DEALER_ROLES:
            er = "D"
        elif role == "support":
            er = "S"
        elif role == "frontline":
            er = "F"
        else:  # bruiser → 복합 재분류
            nondmg = (params["tank"] + params["protect"] + params["heal"] + params["cc"]) / 4
            er = "D" if (params["dmg"] - nondmg) >= args.bruiser_margin else "F"
        eff_role[c] = er
        characters[c] = {
            "role": role, "effRole": er, "function": func,
            "params": params, "soloTop3": round(a["top3"] / a["n"] * 100, 1), "games": a["n"],
        }

    def skel(members):
        f = d = s = 0
        for m in members:
            er = eff_role.get(m.get("characterId"))
            if er == "D":
                d += 1
            elif er == "S":
                s += 1
            else:
                f += 1  # F 또는 미상
        return f"F{f}/D{d}/S{s}"

    # 아키타입 집계
    A = defaultdict(lambda: {"n": 0, "win": 0, "top3": 0, "bottom": 0, "ps": 0.0, "ps2": 0.0,
                             "dealt": 0.0, "taken": 0.0, "chars": Counter(),
                             **{k: 0.0 for k in METRICS}, "tier": defaultdict(lambda: [0, 0])})
    tier_base = defaultdict(lambda: [0, 0])  # tier -> [n, top3]
    for members, top3, plc, tier in teams:
        sk = skel(members)
        a = A[sk]
        a["n"] += 1
        a["top3"] += top3
        if plc and plc > 0:
            a["ps"] += plc
            a["ps2"] += plc * plc
            if plc == 1:
                a["win"] += 1
            if plc >= 6:
                a["bottom"] += 1
        a["tier"][tier][0] += 1
        a["tier"][tier][1] += top3
        tb = tier_base[tier]
        tb[0] += 1
        tb[1] += top3
        for m in members:
            cid = m.get("characterId")
            cp = characters.get(cid)
            if cp:
                for k in METRICS:
                    a[k] += cp["params"][k]
            if cid:
                a["chars"][cid] += 1
            st = m.get("stats") or {}
            a["dealt"] += float(st.get("damageToPlayer", 0) or 0)
            a["taken"] += float(st.get("damageFromPlayer", 0) or 0)

    archetypes = {}
    for sk, a in A.items():
        if a["n"] < args.min_arch:
            continue
        mem = a["n"] * 3
        mean_plc = a["ps"] / a["n"] if a["n"] else 0
        std = math.sqrt(max(0.0, a["ps2"] / a["n"] - mean_plc * mean_plc)) if a["n"] else 0
        # 티어 top3 lift + slope
        lifts = {}
        for tier in TIERS:
            tn, tt = a["tier"].get(tier, [0, 0])
            bn, bt = tier_base.get(tier, [0, 0])
            if tn >= 50 and bn:
                lifts[tier] = round((tt / tn - bt / bn) * 100, 1)
        slope = None
        if "iron_gold" in lifts and "demigod_eternity" in lifts:
            slope = round(lifts["demigod_eternity"] - lifts["iron_gold"], 1)
        archetypes[sk] = {
            "label": LABELS.get(sk, ""),
            "n": a["n"], "share": round(a["n"] / len(teams) * 100, 1),
            "requirement": {k: round(a[k] / mem, 1) for k in METRICS},
            "profile": {
                "win": round(a["win"] / a["n"] * 100, 1),
                "top3": round(a["top3"] / a["n"] * 100, 1),
                "bottom": round(a["bottom"] / a["n"] * 100, 1),
                "stdPlc": round(std, 2),
                "dmgRatio": round(a["dealt"] / max(1, a["taken"]), 2),
            },
            "tierLift": lifts, "tierSlope": slope,
            "topChars": [c for c, _ in a["chars"].most_common(6)],
        }

    model = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": args.data.replace("\\", "/"),
        "teams": len(teams),
        "bruiserMargin": args.bruiser_margin,
        "characters": characters,
        "archetypes": archetypes,
    }
    payload = json.dumps(model, ensure_ascii=False, indent=2)
    with open(args.out, "w", encoding="utf-8") as f:
        if args.out.endswith(".js"):
            f.write("// 자동 생성 (tools/build_comp_model.py). 직접 수정 금지.\n")
            f.write("export const compModel = " + payload + ";\n")
        else:
            f.write(payload + "\n")

    # 콘솔 요약 (브루저 재분류 검증)
    br = [(c, characters[c]) for c in chars if characters[c]["role"] == "bruiser"]
    to_d = [c for c, m in br if m["effRole"] == "D"]
    to_f = [c for c, m in br if m["effRole"] == "F"]
    print(f"saved {args.out}  (chars={len(characters)}, archetypes={len(archetypes)}, teams={len(teams)})")
    print(f"브루저 → 딜러(D) 재분류 ({len(to_d)}): {', '.join(sorted(to_d))}")
    print(f"브루저 → 전열(F) 유지 ({len(to_f)}): {', '.join(sorted(to_f))}")
    print("아키타입(재분류 골격):")
    for sk in sorted(archetypes, key=lambda s: -archetypes[s]["n"]):
        a = archetypes[sk]
        print(f"  {sk:<10}{a['label']:<14} n={a['n']:>7} ({a['share']}%)  "
              f"top3 {a['profile']['top3']}%  slope {a['tierSlope']}  req dmg {a['requirement']['dmg']}")


if __name__ == "__main__":
    main()
