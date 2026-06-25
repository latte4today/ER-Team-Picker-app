#!/usr/bin/env python3
"""
Learned ceiling + composition-diversity diagnostic.

핵심 질문: "조합이 캐릭터 자체 강함을 넘어서는 예측력이 있는가?"
  - baseline  = 팀 solo 강함(폴드별 leave-out 캐릭터 강함표 → 'control'의 학습형 버전)
  - comp      = baseline + 캐릭터 identity 멀티핫 (트리 모델이 캐릭/페어 상호작용을 학습)
  - gameId 기준 GroupKFold OOF → 로비 누수 없음.
  - 보고: OOF AUC(baseline vs comp) + 델타(comp-baseline) + 부트스트랩 95% CI.

판독:
  - 델타 CI가 0을 뚜렷이 넘으면 → 조합은 강함을 넘는 신호가 있다(우리 손점수가 못 잡았을 뿐).
  - 델타 ≈ 0 (CI가 0 포함) → 이 타깃에선 조합이 강함 위에 더해주는 게 없다(측정 한계가 아니라 진짜).

또한 ③ 조합 다양성(티어별 트리오 엔트로피)을 출력 → 고티어가 동질적이면(restricted range)
null이 "조합 무의미"가 아니라 "대비 부족" 때문임을 가려준다.

사용:
  pip install scikit-learn numpy
  python tools/learned_ceiling.py --data reports/generated/latest-official-archive.normalized.jsonl \
      --tiers meteor_mithril,demigod_eternity --target isTop3 --bootstrap 300
"""
import argparse
import json
import math
import sys
from collections import defaultdict, Counter

import numpy as np

try:
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold
    from sklearn.metrics import roc_auc_score
except ImportError:
    sys.exit("의존성 설치 필요:  pip install scikit-learn numpy")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="reports/generated/latest-official-archive.normalized.jsonl")
    p.add_argument("--tiers", default="meteor_mithril,demigod_eternity",
                   help="쉼표구분 티어 필터. 'all'이면 전체.")
    p.add_argument("--target", default="isTop3",
                   choices=["isTop3", "isWin", "dmgTrade", "fightWin"],
                   help="isTop3/isWin=등수, dmgTrade=가한딜>받은딜(딜교환 승), fightWin=로비 내 가한딜 상위절반")
    p.add_argument("--folds", type=int, default=5)
    p.add_argument("--bootstrap", type=int, default=300)
    p.add_argument("--smoothing", type=float, default=50.0, help="캐릭터 강함표 베이지안 스무딩")
    p.add_argument("--max-rows", type=int, default=0, help="0=전체, 디버그용 상한")
    p.add_argument("--seed", type=int, default=1)
    return p.parse_args()


def load(path, tiers, target, max_rows):
    tierset = None if (not tiers or tiers == "all") else set(tiers.split(","))
    rows = []
    with open(path, encoding="utf-8") as f:
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
            cids = [m.get("characterId") for m in members]
            if any(c is None for c in cids):
                continue
            tier = t.get("tierBucket", "unknown")
            if tierset is not None and tier not in tierset:
                continue
            res = t.get("result") or {}
            gid = t.get("gameId")
            if gid is None:
                continue
            dealt = sum(float((m.get("stats") or {}).get("damageToPlayer", 0) or 0) for m in members)
            taken = sum(float((m.get("stats") or {}).get("damageFromPlayer", 0) or 0) for m in members)
            if target == "dmgTrade":
                y = 1 if dealt > taken else 0
            elif target == "fightWin":
                y = None  # 로비 그룹 후 결정
            else:
                y = 1 if res.get(target) else 0
            rows.append({"gid": str(gid), "cids": tuple(sorted(cids)), "tier": tier, "y": y, "dealt": dealt})
            if max_rows and len(rows) >= max_rows:
                break
    if target == "fightWin":
        from statistics import median
        by_g = defaultdict(list)
        for r in rows:
            by_g[r["gid"]].append(r["dealt"])
        med = {g: median(v) for g, v in by_g.items()}
        for r in rows:
            r["y"] = 1 if r["dealt"] > med[r["gid"]] else 0
    return rows


def fold_strength(rows, idx, smoothing):
    sums = defaultdict(float)
    ns = defaultdict(int)
    g_sum = 0
    for i in idx:
        y = rows[i]["y"]
        g_sum += y
        for c in rows[i]["cids"]:
            sums[c] += y
            ns[c] += 1
    gmean = g_sum / max(1, len(idx))
    strength = {}
    for c in ns:
        strength[c] = (sums[c] + smoothing * gmean) / (ns[c] + smoothing)
    return strength, gmean


def strength_feats(row, strength, gmean):
    vals = [strength.get(c, gmean) for c in row["cids"]]
    return [sum(vals), sum(vals) / 3.0, min(vals), max(vals)]


def diversity_report(rows):
    by_tier = defaultdict(list)
    for r in rows:
        by_tier[r["tier"]].append(r["cids"])
    print("\n=== 조합 다양성(restricted-range 진단) ===")
    print(f"{'tier':<18}{'teams':>9}{'distinctTrio':>14}{'top1share':>11}{'entropyNorm':>13}{'charsUsed':>11}")
    for tier in sorted(by_tier):
        trios = by_tier[tier]
        n = len(trios)
        c = Counter(trios)
        distinct = len(c)
        top1 = c.most_common(1)[0][1] / n if n else 0
        # 정규화 섀넌 엔트로피 (0=완전 동질, 1=완전 균등)
        ent = -sum((v / n) * math.log(v / n) for v in c.values()) if n else 0
        ent_norm = ent / math.log(distinct) if distinct > 1 else 0
        chars = set()
        for trio in trios:
            chars.update(trio)
        print(f"{tier:<18}{n:>9}{distinct:>14}{top1share_fmt(top1):>11}{ent_norm:>13.3f}{len(chars):>11}")
    print("해석: entropyNorm이 낮고 top1share가 높으면 그 티어는 동질적 → 조합 대비가 작아 null이 과장될 수 있음.")


def top1share_fmt(x):
    return f"{x*100:.1f}%"


def auc_safe(y, p):
    if len(set(y)) < 2:
        return float("nan")
    return roc_auc_score(y, p)


def main():
    args = parse_args()
    rng = np.random.default_rng(args.seed)
    rows = load(args.data, args.tiers, args.target, args.max_rows)
    if len(rows) < 200:
        sys.exit(f"표본 부족: {len(rows)}행. --tiers/--data 확인.")

    print(f"# learned ceiling  data={args.data}")
    print(f"# tiers={args.tiers}  target={args.target}  rows={len(rows)}  "
          f"games={len(set(r['gid'] for r in rows))}  baserate={np.mean([r['y'] for r in rows]):.3f}")

    diversity_report(rows)

    # 캐릭터 어휘 + 멀티핫
    vocab = sorted({c for r in rows for c in r["cids"]})
    vindex = {c: i for i, c in enumerate(vocab)}
    n = len(rows)
    multihot = np.zeros((n, len(vocab)), dtype=np.float32)
    for i, r in enumerate(rows):
        for c in r["cids"]:
            multihot[i, vindex[c]] = 1.0
    y = np.array([r["y"] for r in rows])
    groups = np.array([r["gid"] for r in rows])

    oof_base = np.full(n, np.nan)
    oof_comp = np.full(n, np.nan)

    gkf = GroupKFold(n_splits=args.folds)
    dummy = np.zeros((n, 1))
    for fold, (tr, te) in enumerate(gkf.split(dummy, y, groups), 1):
        strength, gmean = fold_strength(rows, tr, args.smoothing)
        Xb_tr = np.array([strength_feats(rows[i], strength, gmean) for i in tr])
        Xb_te = np.array([strength_feats(rows[i], strength, gmean) for i in te])
        Xc_tr = np.hstack([Xb_tr, multihot[tr]])
        Xc_te = np.hstack([Xb_te, multihot[te]])

        mb = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05,
                                            max_leaf_nodes=31, random_state=args.seed)
        mb.fit(Xb_tr, y[tr])
        oof_base[te] = mb.predict_proba(Xb_te)[:, 1]

        mc = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05,
                                            max_leaf_nodes=63, random_state=args.seed)
        mc.fit(Xc_tr, y[tr])
        oof_comp[te] = mc.predict_proba(Xc_te)[:, 1]
        print(f"  fold {fold}/{args.folds} done (train={len(tr)} test={len(te)})")

    auc_base = auc_safe(y, oof_base)
    auc_comp = auc_safe(y, oof_comp)
    delta = auc_comp - auc_base

    # 부트스트랩: 게임 단위 리샘플링으로 델타 CI
    game_to_idx = defaultdict(list)
    for i, g in enumerate(groups):
        game_to_idx[g].append(i)
    game_ids = list(game_to_idx.keys())
    deltas = []
    for _ in range(args.bootstrap):
        sampled = rng.choice(len(game_ids), size=len(game_ids), replace=True)
        idx = []
        for s in sampled:
            idx.extend(game_to_idx[game_ids[s]])
        idx = np.array(idx)
        yb = y[idx]
        if len(set(yb)) < 2:
            continue
        deltas.append(auc_safe(yb, oof_comp[idx]) - auc_safe(yb, oof_base[idx]))
    deltas = np.array(deltas)
    lo, hi = (np.percentile(deltas, [2.5, 97.5]) if len(deltas) else (float("nan"), float("nan")))

    print("\n=== LEARNED CEILING (OOF AUC, GroupKFold by game) ===")
    print(f"  baseline (solo 강함)         AUC = {auc_base:.4f}")
    print(f"  comp (강함 + 캐릭 identity)   AUC = {auc_comp:.4f}")
    print(f"  delta (comp - baseline)      = {delta:+.4f}   bootstrap95% CI [{lo:+.4f}, {hi:+.4f}]")
    print("\n판독:")
    print("  - CI가 0을 뚜렷이 넘음(양수) → 조합은 강함을 넘는 예측력이 있다(손점수가 못 잡았을 뿐).")
    print("  - CI가 0을 포함/음수      → 이 타깃에선 조합이 강함 위에 더해주는 게 없다.")
    print("  - baseline AUC 자체가 천장(=control). comp가 그걸 넘는지가 핵심.")


if __name__ == "__main__":
    main()
