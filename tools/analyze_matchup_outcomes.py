"""Offline pilot: same-lobby placement comparisons, never direct fight win rates.

Uses only pre-game builds/MMR. Splits whole games chronologically before fitting
vocabularies, regularization or models. Raw/private input is never committed.
"""
import argparse
import collections
import itertools
import json
from pathlib import Path
from datetime import datetime

import numpy as np
from scipy.special import xlogy
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score


def build_key(row, cores=False):
    return '|'.join(sorted(m['variantId'] + ('#' + str(m.get('traits', {}).get('core', 'unknown')) if cores else '')
                           for m in row['members']))


def team_features(row):
    features = collections.Counter()
    tokens = []
    for member in row['members']:
        variant = member['variantId']
        token = variant + '#' + str(member.get('traits', {}).get('core', 'unknown'))
        tokens.append(token)
        features['variant:' + variant] += 1
        features['core:' + token] += 1
    for a, b in itertools.combinations(sorted(m['variantId'] for m in row['members']), 2):
        features['synergy:' + a + '|' + b] += 1
    return dict(features), tokens


def pair_features(a, b):
    fa, ta = team_features(a)
    fb, tb = team_features(b)
    baseline = {key: fa.get(key, 0) - fb.get(key, 0) for key in fa.keys() | fb.keys()}
    baseline['mmr_difference'] = np.clip((a.get('teamMmr', 0) or 0) - (b.get('teamMmr', 0) or 0), -3000, 3000) / 1000
    counters = collections.Counter()
    for own in ta:
        for enemy in tb:
            if own == enemy:
                continue
            lo, hi = sorted([own, enemy])
            counters['opponent:' + lo + '|' + hi] += 1 if own == lo else -1
    return baseline, dict(counters)


def fit_model(train_rows, val_rows, train_y, val_y, train_w, val_w):
    vectorizer = DictVectorizer(dtype=np.float64)
    x = vectorizer.fit_transform(train_rows)
    xv = vectorizer.transform(val_rows)
    best = None
    for regularization in (0.01, 0.1, 1.0):
        model = LogisticRegression(C=regularization, fit_intercept=False, solver='liblinear', max_iter=500, random_state=7)
        model.fit(x, train_y, sample_weight=train_w)
        p = np.clip(model.predict_proba(xv)[:, 1], 1e-7, 1-1e-7)
        loss = np.average(-xlogy(val_y, p)-xlogy(1-val_y, 1-p), weights=val_w)
        if best is None or loss < best[0]:
            best = (float(loss), model, regularization)
    return vectorizer, best[1], best[2], len(vectorizer.feature_names_)


def analyze(input_path, output_path, version):
    games = collections.defaultdict(dict)
    variants = collections.Counter()
    cores = collections.Counter()
    rejected = collections.Counter()
    for line in Path(input_path).open(encoding='utf-8'):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get('matchingMode') != 3 or (row.get('versionSeason'), row.get('versionMajor')) != version:
            rejected['other_mode_or_version'] += 1
            continue
        members = row.get('members', [])
        if len(members) != 3 or len({m['characterId'] for m in members}) != 3 or not row.get('startedAt'):
            rejected['invalid_team'] += 1
            continue
        if not row.get('result', {}).get('placement'):
            rejected['missing_placement'] += 1
            continue
        game = games[str(row['gameId'])]
        team_id = str(row.get('teamKey', build_key(row, True)))
        if team_id in game:
            rejected['duplicate_team'] += 1
            continue
        game[team_id] = row
        variants[build_key(row)] += 1
        cores[build_key(row, True)] += 1
    ordered = sorted((list(teams.values()) for teams in games.values() if len(teams) >= 4), key=lambda g: (datetime.fromisoformat(g[0]['startedAt']), str(g[0]['gameId'])))
    n = len(ordered)
    if n < 100:
        raise ValueError('Too few complete-enough games for a chronological pilot')
    boundaries = [0, int(n*.70), int(n*.85), n]
    partitions = []
    direct = collections.defaultdict(lambda: {'games': set(), 'wins': 0, 'ties': 0, 'pairs': 0})
    for low, high in zip(boundaries, boundaries[1:]):
        baseline, opponents, labels, weights, gids = [], [], [], [], []
        for game in ordered[low:high]:
            # Canonical ordering does not depend on final placement.
            teams = sorted(game, key=lambda t: (build_key(t, True), str(t.get('teamKey', ''))))
            pairs = [(a,b) for a,b in itertools.combinations(teams, 2) if a['result']['placement'] != b['result']['placement']]
            for a,b in pairs:
                fa,fo = pair_features(a,b)
                baseline.append(fa); opponents.append(fo)
                labels.append(int(a['result']['placement'] < b['result']['placement']))
                weights.append(1/max(1,len(pairs))); gids.append(str(a['gameId']))
                ka,kb = sorted([build_key(a),build_key(b)])
                if ka != kb:
                    item = direct[(ka,kb)]
                    item['games'].add(str(a['gameId']));item['pairs'] += 1
                    item['wins'] += int((a['result']['placement'] < b['result']['placement']) if build_key(a)==ka else (b['result']['placement'] < a['result']['placement']))
        partitions.append((baseline,opponents,np.asarray(labels),np.asarray(weights),gids))
    counts = collections.Counter(key for row in partitions[0][1] for key,value in row.items() if value)
    allowed = {key for key,count in counts.items() if count >= 50}
    full = [[{**base, **{k:v for k,v in opp.items() if k in allowed and v}} for base,opp in zip(part[0],part[1])] for part in partitions]
    reports = {}
    predictions = {}
    test_y,test_w = partitions[2][2:4]
    for name,features in [('build_strength', [p[0] for p in partitions]), ('build_strength_plus_opponent',full)]:
        vectorizer,model,c,dimension = fit_model(features[0],features[1],partitions[0][2],partitions[1][2],partitions[0][3],partitions[1][3])
        p = np.clip(model.predict_proba(vectorizer.transform(features[2]))[:,1],1e-7,1-1e-7)
        losses = -xlogy(test_y,p)-xlogy(1-test_y,1-p)
        predictions[name] = losses
        reports[name] = {'selected_C':c, 'features':dimension,'test_log_loss':float(np.average(losses,weights=test_w)),
            'test_auc':float(roc_auc_score(test_y,p,sample_weight=test_w)),
            'test_order_accuracy':float(np.average(((p>.5)==test_y).astype(float),weights=test_w))}
    per_game = collections.defaultdict(list)
    delta = predictions['build_strength_plus_opponent']-predictions['build_strength']
    for gid,value in zip(partitions[2][4],delta):
        per_game[gid].append(value)
    game_delta = np.asarray([np.mean(values) for values in per_game.values()])
    rng = np.random.default_rng(17)
    bootstrap = np.asarray([rng.choice(game_delta,size=len(game_delta),replace=True).mean() for _ in range(1000)])
    report = {'scope':'same-lobby relative final placement; not head-to-head combat', 'version':list(version),
        'raw_filtered_teams':sum(variants.values()),'eligible_games':n,'split_games':np.diff(boundaries).tolist(),
        'split_pair_counts':[len(p[2]) for p in partitions],
        'split_time_ranges':[[ordered[a][0]['startedAt'],ordered[b-1][0]['startedAt']] for a,b in zip(boundaries,boundaries[1:])],
        'variant_combinations':len(variants),'core_combinations':len(cores),
        'variant_combinations_at_least_30':sum(count>=30 for count in variants.values()),
        'core_combinations_at_least_30':sum(count>=30 for count in cores.values()),
        'rejected':dict(rejected),'models':reports,
        'opponent_log_loss_delta':float(game_delta.mean()),'opponent_log_loss_delta_ci95':np.quantile(bootstrap,[.025,.975]).tolist(),
        'reliable_direct_pairs_at_least_30_games':sum(len(item['games'])>=30 for item in direct.values()),
        'most_common_combinations':[{'members':key.split('|'),'teams':count} for key,count in variants.most_common(12)],
        'most_observed_direct_pairs':[{'a':key[0].split('|'),'b':key[1].split('|'),'games':len(item['games']),'comparisons':item['pairs'],'a_finishes_above_b_rate':item['wins']/item['pairs']} for key,item in sorted(direct.items(),key=lambda x:len(x[1]['games']),reverse=True)[:8]],
        'limitations':['No direct encounter/death log','One patch family and narrow collection coverage','MMR is a pre-game proxy, not randomized skill assignment','Rare exact builds require more data','Predictive associations are not causal counter relationships']}
    Path(output_path).parent.mkdir(parents=True,exist_ok=True)
    Path(output_path).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['raw_filtered_teams','eligible_games','split_games','models','opponent_log_loss_delta','opponent_log_loss_delta_ci95','reliable_direct_pairs_at_least_30_games']},ensure_ascii=False))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--in',dest='input',required=True)
    parser.add_argument('--out',required=True)
    parser.add_argument('--version',default='12.5')
    args=parser.parse_args()
    analyze(args.input,args.out,tuple(map(int,args.version.split('.'))))
