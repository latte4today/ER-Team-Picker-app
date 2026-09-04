#!/usr/bin/env bash
# Unattended: wait out the running collect-seeds job, apply the one mechanical
# follow-up (baseline refresh), write a report to the Desktop, then power off.
# Runs detached from the Claude session so it survives the session ending.
set -u

RUN_ID="${1:-33890180983}"
REPO="/c/Users/WIN11/Documents/Codex/2026-05-31/https-dak-gg-er-https-dak"
REPORT="/c/Users/WIN11/Desktop/ER-CI-야간보고.txt"
DEADLINE=$(( $(date +%s) + 5*3600 ))   # never wait past 5 hours
THIN=442940                             # the source-team count that shipped broken

say() { echo "$(date '+%H:%M:%S')  $*" >> "$REPORT"; }

: > "$REPORT"
say "=== ER Team Picker · 야간 자동 마무리 ==="
say "감시 대상: GitHub Actions run $RUN_ID"
say ""

# ── 1. wait for the run ──────────────────────────────────────────────────────
conclusion="unknown"
while :; do
  json=$(gh run view "$RUN_ID" --repo latte4today/ER-Team-Picker-app --json status,conclusion 2>/dev/null)
  if [ -n "$json" ]; then
    status=$(echo "$json" | python -c "import sys,json;print(json.load(sys.stdin).get('status') or '')" 2>/dev/null)
    conclusion=$(echo "$json" | python -c "import sys,json;print(json.load(sys.stdin).get('conclusion') or '')" 2>/dev/null)
    [ "$status" = "completed" ] && break
  fi
  if [ "$(date +%s)" -gt "$DEADLINE" ]; then
    conclusion="timed-out-waiting"
    say "5시간이 지나도 끝나지 않아 대기를 중단했습니다."
    break
  fi
  sleep 180
done
say "CI 종료 상태: ${conclusion:-unknown}"
say ""

cd "$REPO" || { say "저장소로 이동 실패. 아무것도 하지 않고 종료합니다."; }

# What main carried before we pulled, so we can tell whether CI published anything.
before_stats=$(grep -m1 '"generatedAt"' src/pairRoleStats.js 2>/dev/null)
before_head=$(git rev-parse --short HEAD 2>/dev/null)

# ── 2. pick up whatever CI committed ─────────────────────────────────────────
dirty=$(git status --porcelain 2>/dev/null)
if [ -n "$dirty" ]; then
  say "주의: 작업 트리에 예상치 못한 변경이 있어 push는 건너뜁니다."
  say "$dirty"
else
  git fetch origin --quiet 2>/dev/null
  git pull --rebase --quiet origin main 2>/dev/null && say "main 최신화 완료: $(git log --oneline -1)"
fi
say ""

# ── 3. did the corpus fix actually work? ─────────────────────────────────────
say "--- corpus 수정 검증 ---"
check=$(node tools/check_pair_role_stats.mjs 2>&1)
say "$check"
teams=$(echo "$check" | grep -o 'sourceTeams=[0-9]*' | head -1 | cut -d= -f2)
after_stats=$(grep -m1 '"generatedAt"' src/pairRoleStats.js 2>/dev/null)

if [ "$conclusion" != "success" ]; then
  # A failed job never reaches its commit step, so main still holds the stats
  # built by hand on 2026-09-04. The numbers below say nothing about CI.
  say "판정: 보류. CI가 '$conclusion' 로 끝나 통계를 커밋하지 못했습니다."
  say "      아래 수치는 로컬에서 만든 것이고, CI의 corpus 수정 여부는 확인되지 않았습니다."
  say "      로그 확인: gh run view $RUN_ID --log-failed"
  say "      다만 통계가 얇아지는 퇴행은 막혔습니다 - check_pair_role_stats 가드가"
  say "      커밋 전에 잡으므로 main은 좋은 통계를 그대로 유지합니다."
elif [ "$before_stats" = "$after_stats" ]; then
  say "판정: 보류. CI는 성공했지만 pairRoleStats가 그대로입니다 (변경 없음으로 커밋 생략)."
  say "      다음 실행에서 다시 확인해야 합니다."
elif [ -z "$teams" ]; then
  say "판정: sourceTeams를 읽지 못했습니다. 직접 확인이 필요합니다."
elif [ "$teams" -le "$THIN" ]; then
  say "판정: 실패. CI가 새로 만든 통계의 sourceTeams=$teams 로 여전히 얇습니다 (기준 $THIN)."
  say "      워크플로의 corpus 재구축 단계를 다시 봐야 합니다."
else
  say "판정: 성공. CI가 커밋한 통계의 sourceTeams=$teams 입니다 (이전 $THIN)."
fi
say "HEAD: $before_head -> $(git rev-parse --short HEAD 2>/dev/null)"
say ""

# ── 4. the one mechanical follow-up ──────────────────────────────────────────
say "--- 추천 baseline ---"
if node tools/recommendation_snapshot.mjs >/dev/null 2>&1; then
  say "baseline 일치. 할 일 없음."
else
  say "baseline이 어긋나 재생성합니다 (CI가 재튜닝 이전 설정으로 만든 것)."
  node tools/recommendation_snapshot.mjs --update >/dev/null 2>&1
  if node tools/recommendation_snapshot.mjs >/dev/null 2>&1; then
    git add snapshots/recommendation-baseline.json 2>/dev/null
    if git diff --staged --quiet; then
      say "실제 변경 없음."
    else
      git -c user.name="latte4today" commit -q -m "chore: refresh recommendation baseline after the nightly stats build

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" 2>/dev/null
      if git push origin main >/dev/null 2>&1; then
        say "재생성 후 push 완료: $(git log --oneline -1)"
      else
        say "push 실패. 로컬에 커밋만 남아 있습니다."
      fi
    fi
  else
    say "재생성 후에도 검증에 실패했습니다. 직접 확인이 필요합니다."
  fi
fi
say ""

# ── 5. leave the tests' verdict, then power off ──────────────────────────────
say "--- 테스트 ---"
node tools/test_recommender.mjs >/dev/null 2>&1 && say "test_recommender: 통과" || say "test_recommender: 실패"
node tools/test_core_role_profile.mjs >/dev/null 2>&1 && say "test_core_role_profile: 통과" || say "test_core_role_profile: 실패"
say ""
say "작업 트리: $(git status --porcelain | wc -l) 개 변경"
say "HEAD: $(git log --oneline -1)"
say ""
say "2분 뒤 컴퓨터를 종료합니다. 취소하려면: shutdown /a"
shutdown //s //t 120 >/dev/null 2>&1 || shutdown /s /t 120 >/dev/null 2>&1
