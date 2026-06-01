import { characterVariants, synergyPairs } from "./data.js";
import { getFeedbackScore } from "./feedback.js";
import {
  experimentTiers,
  oneTrickWeight,
  placementScore,
  rankerCandidateStats,
  rankerCompositionStats,
  statsBucketForTier,
  tierScoreWeights,
} from "./metaData.js";

const requiredTags = ["initiate", "focus", "peel", "cc", "sustained", "poke", "burst"];

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

function pairScore(candidate, selected) {
  if (selected.length === 0) return 0;
  const total = selected.reduce((sum, teammate) => {
    return sum + (synergyPairs[pairKey(candidate.characterId, teammate.characterId)] ?? 6.2);
  }, 0);
  return total / selected.length - 6.2;
}

function coverageScore(candidate, selected) {
  const currentTags = new Set(selected.flatMap((character) => character.tags));
  const missing = requiredTags.filter((tag) => !currentTags.has(tag));
  return candidate.tags.filter((tag) => missing.includes(tag)).length * 0.9;
}

function roleBalanceScore(candidate, selected) {
  const roles = selected.map((character) => character.role);
  if (roles.length === 0) return 1;
  if (!roles.includes("frontline") && ["frontline", "bruiser"].includes(candidate.role)) return 2.2;
  if (!roles.includes("ranged") && ["ranged", "mage"].includes(candidate.role)) return 1.5;
  if (!roles.includes("support") && candidate.role === "support") return 1.0;
  if (roles.includes(candidate.role)) return -0.8;
  return 0.5;
}

function damageBalanceScore(candidate, selected) {
  const damageTypes = selected.map((character) => character.damage);
  const sameTypeCount = damageTypes.filter((type) => type === candidate.damage).length;
  return sameTypeCount >= 2 ? -1.2 : sameTypeCount === 1 ? -0.2 : 0.8;
}

function weaponBalanceScore(candidate, selected) {
  const ranges = selected.map((character) => character.weaponRange);
  if (candidate.weaponRange === "unknown") return -0.4;
  const sameRangeCount = ranges.filter((range) => range === candidate.weaponRange).length;
  if (sameRangeCount >= 2) return -0.8;
  if (ranges.includes("melee") && candidate.weaponRange === "ranged") return 0.8;
  if (ranges.includes("ranged") && candidate.weaponRange === "melee") return 0.6;
  return 0.2;
}

function conflictScore(candidate, selected) {
  if (selected.length < 2) return 0;
  const nextTeam = [...selected, candidate];
  const roles = nextTeam.map((character) => character.role);
  const ranges = nextTeam.map((character) => character.weaponRange);
  const tags = new Set(nextTeam.flatMap((character) => character.tags));
  let penalty = 0;

  const frontlineCount = roles.filter((role) => role === "frontline" || role === "bruiser").length;
  const rangedCount = roles.filter((role) => role === "ranged" || role === "mage").length;
  const supportCount = roles.filter((role) => role === "support").length;
  const assassinCount = roles.filter((role) => role === "assassin").length;

  if (frontlineCount === 0) penalty -= 2.4;
  if (rangedCount === 0) penalty -= 1.6;
  if (supportCount >= 2) penalty -= 1.4;
  if (assassinCount >= 2 && frontlineCount === 0) penalty -= 1.4;
  if (ranges.every((range) => range === "melee")) penalty -= 1.2;
  if (ranges.every((range) => range === "ranged")) penalty -= 0.9;
  if (!tags.has("initiate") && !tags.has("cc")) penalty -= 1.1;
  if (!tags.has("focus") && !tags.has("burst")) penalty -= 0.8;

  return penalty;
}

function dakCompositionScore(candidate, selected) {
  if (selected.length === 0 || rankerCompositionStats.length === 0) return 0;

  const selectedCharacters = new Set(selected.map((character) => character.characterId));
  const rows = rankerCompositionStats.filter((row) => row.candidate === candidate.characterId);
  if (rows.length === 0) return 0;

  const total = rows.reduce((sum, row) => {
    const teammates = row.teammates ?? [];
    const matchedCount = teammates.filter((characterId) => selectedCharacters.has(characterId)).length;
    if (matchedCount === 0) return sum;

    const matchWeight = matchedCount === selectedCharacters.size ? 1 : 0.38;
    const sampleWeight = Math.min(1, Math.log10((row.games ?? 0) + 1) / 1.6);
    return sum + placementScore(row) * matchWeight * sampleWeight * oneTrickWeight(row.oneTrickRatio);
  }, 0);

  return Math.min(2.6, total);
}

function dakTierScore(candidate, tier) {
  const bucket = statsBucketForTier(tier);
  const tierLabel = experimentTiers[bucket]?.[candidate.characterId] ?? experimentTiers.all?.[candidate.characterId];
  const tierScore = tierScoreWeights[tierLabel] ?? 0;
  const broadRanker = rankerCandidateStats[candidate.characterId];
  const broadRankerScore = broadRanker ? placementScore(broadRanker) * oneTrickWeight(broadRanker.oneTrickRatio) * 0.35 : 0;
  return tierScore + broadRankerScore;
}

function explain(candidate, selected, scores) {
  const reasons = [];
  if (scores.roleBalance >= 1.5) reasons.push("현재 조합에 부족한 탱커 또는 핵심 딜 포지션을 보완합니다.");
  if (scores.coverage >= 1.8) reasons.push("부족한 이니쉬, 포커싱, CC, 포킹, 지속딜 같은 기능을 채워줍니다.");
  if (scores.damageBalance > 0) reasons.push("평타 딜과 스킬 딜이 섞여 있어 교전 방식이 단조롭지 않습니다.");
  if (scores.weaponBalance > 0.5) reasons.push(`${candidate.weaponLabel} 무기로 교전 거리와 역할 분포를 보완합니다.`);
  if (scores.synergy >= 1.4) reasons.push("샘플 상성 데이터에서 팀원과의 조합 점수가 높습니다.");
  if (scores.dakComposition >= 1.1) reasons.push("랭커 전적에서 비슷한 팀 조합과 함께 좋은 결과가 나온 선택지입니다.");
  if (scores.dakTier >= 0.8) reasons.push("최근 통계 티어가 높아 현재 메타 보정이 붙었습니다.");
  if (scores.conflict <= -2) reasons.push("역할이나 교전 방식이 겹쳐 조합 점수가 낮게 계산됩니다.");
  if (selected.length === 0) reasons.push("무난하게 조합의 뼈대를 만들기 좋은 선택지입니다.");
  if (reasons.length === 0 && candidate.tags.includes("cc")) reasons.push("교전 시작과 받아치기에 필요한 제어 능력을 더해줍니다.");
  if (reasons.length === 0 && candidate.tags.includes("sustained")) reasons.push("긴 교전에서 꾸준히 피해를 누적할 수 있습니다.");
  if (reasons.length === 0 && candidate.tags.includes("poke")) reasons.push("교전 전에 체력을 깎아 유리한 진입 각을 만들 수 있습니다.");
  if (reasons.length === 0) reasons.push("현재 선택된 팀원과 역할이 크게 충돌하지 않는 무난한 후보입니다.");
  return reasons.slice(0, 3);
}

function selectedCharactersFromIds(selectedIds) {
  return selectedIds
    .map((id) => characterVariants.find((character) => character.variantId === id))
    .filter(Boolean);
}

export function evaluateCandidate(selectedIds, candidateId, tier = "all", remoteFeedback = {}) {
  const selected = selectedCharactersFromIds(selectedIds);
  const candidate = characterVariants.find((character) => character.variantId === candidateId);
  if (!candidate) return undefined;

  const scores = {
    synergy: pairScore(candidate, selected),
    coverage: coverageScore(candidate, selected),
    roleBalance: roleBalanceScore(candidate, selected),
    damageBalance: damageBalanceScore(candidate, selected),
    weaponBalance: weaponBalanceScore(candidate, selected),
    conflict: conflictScore(candidate, selected),
    dakComposition: dakCompositionScore(candidate, selected),
    dakTier: dakTierScore(candidate, tier),
  };
  const total =
    scores.synergy * 1.6 +
    scores.coverage +
    scores.roleBalance +
    scores.damageBalance +
    scores.weaponBalance +
    scores.conflict +
    scores.dakComposition +
    scores.dakTier -
    candidate.difficulty * 0.08 +
    getFeedbackScore(selectedIds, candidate.variantId, tier) +
    getFeedbackScore(selectedIds, candidate.variantId, tier, remoteFeedback) * 0.7;

  return {
    character: candidate,
    score: Number(total.toFixed(1)),
    reasons: explain(candidate, selected, scores),
  };
}

export function recommend(selectedIds, tier = "all", remoteFeedback = {}, candidateCharacterIds = undefined) {
  const selected = selectedCharactersFromIds(selectedIds);

  const selectedCharacters = new Set(selected.map((character) => character.characterId));
  const candidatePool = candidateCharacterIds?.length ? new Set(candidateCharacterIds) : undefined;

  return characterVariants
    .filter((candidate) => !selectedCharacters.has(candidate.characterId))
    .filter((candidate) => !candidatePool || candidatePool.has(candidate.characterId))
    .map((candidate) => evaluateCandidate(selectedIds, candidate.variantId, tier, remoteFeedback))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
}
