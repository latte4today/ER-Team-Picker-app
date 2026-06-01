import { characterVariants, roleNames, synergyPairs } from "./data.js";
import { getFeedbackScore, loadFeedback } from "./feedback.js";
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

const damageLabels = {
  basic: "평타딜",
  skill: "스킬딜",
  hybrid: "평타와 스킬을 함께 쓰는 혼합딜",
};

const roleJobs = {
  frontline: "탱커로 앞라인을 세우고 먼저 맞아줄 수 있습니다",
  bruiser: "브루저로 앞라인과 딜 압박을 동시에 맡을 수 있습니다",
  ranged: "후방 핵심 딜러로 꾸준히 딜을 넣을 수 있습니다",
  mage: "스킬 딜러로 포킹과 광역 압박을 만들 수 있습니다",
  assassin: "암살자로 한 명을 빠르게 포커싱해 끊을 수 있습니다",
  support: "서포터로 아군 보호와 교전 보조를 맡을 수 있습니다",
};

const tagLabels = {
  initiate: "이니쉬",
  engage: "이니쉬",
  focus: "포커싱",
  cc: "CC",
  peel: "아군 보호",
  sustained: "지속딜",
  burst: "순간딜",
  poke: "포킹",
  durable: "버티기",
  shield: "보호막",
  healing: "회복",
  utility: "유틸",
  range: "사거리",
  zone: "지역 장악",
  dive: "진입",
  mobility: "기동성",
  objective: "오브젝트",
  duel: "맞싸움",
  pick: "잘라먹기",
  sustain: "유지력",
};

function labelList(values) {
  return [...new Set(values.map((value) => tagLabels[value] ?? value))].join(", ");
}

function roleLabel(character) {
  return roleNames[character.role] ?? character.role;
}

function damageLabel(character) {
  return damageLabels[character.damage] ?? character.damage;
}

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

function feedbackSentiment(likes = 0, dislikes = 0) {
  const total = likes + dislikes;
  if (total <= 0) return 0;
  const priorVotes = 6;
  const raw = (likes - dislikes) / (total + priorVotes);
  const confidence = Math.min(1, Math.log2(total + 1) / 4);
  return raw * confidence;
}

function parseFeedbackKey(key, entry) {
  const match = key.match(/^([^:]+):(.+)->(.+)$/);
  if (!match) return undefined;
  return {
    tier: match[1],
    teamKey: match[2],
    candidateId: match[3],
    likes: entry?.likes ?? 0,
    dislikes: entry?.dislikes ?? 0,
    updatedAt: entry?.updatedAt ?? 0,
  };
}

function normalizeFeedbackRows(rows = [], localFeedback = loadFeedback()) {
  const remoteRows = rows.map((row) => ({
    tier: row.tier ?? "all",
    teamKey: row.team_key ?? row.teamKey ?? "",
    candidateId: row.candidate_id ?? row.candidateId ?? "",
    likes: row.likes ?? 0,
    dislikes: row.dislikes ?? 0,
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
  }));
  const localRows = Object.entries(localFeedback)
    .map(([key, entry]) => parseFeedbackKey(key, entry))
    .filter(Boolean);
  return [...remoteRows, ...localRows].filter((row) => row.teamKey && row.candidateId);
}

function relationshipScore(candidate, selected, tier, feedbackRows = [], localFeedback = loadFeedback()) {
  if (selected.length === 0) return 0;

  const selectedIds = new Set(selected.map((character) => character.characterId));
  const candidateId = candidate.characterId;
  let weightedScore = 0;
  let totalWeight = 0;

  normalizeFeedbackRows(feedbackRows, localFeedback).forEach((row) => {
    if (tier !== "all" && row.tier !== tier && row.tier !== "all") return;

    const teamIds = new Set(row.teamKey.split("+").filter(Boolean));
    const finalTeam = new Set([...teamIds, row.candidateId]);
    if (!finalTeam.has(candidateId)) return;

    const matchedSelected = [...selectedIds].filter((id) => finalTeam.has(id)).length;
    if (matchedSelected === 0) return;

    const total = (row.likes ?? 0) + (row.dislikes ?? 0);
    if (total <= 0) return;

    const exactTeam = matchedSelected === selectedIds.size;
    const matchWeight = exactTeam ? 1.35 : 0.58;
    const sampleWeight = Math.min(1.4, Math.log2(total + 1) / 3);
    const tierWeight = row.tier === tier ? 1.15 : 0.75;
    const recencyWeight = row.updatedAt ? 1.05 : 1;
    const weight = matchedSelected * matchWeight * sampleWeight * tierWeight * recencyWeight;

    weightedScore += feedbackSentiment(row.likes, row.dislikes) * weight;
    totalWeight += weight;
  });

  if (totalWeight === 0) return 0;
  return Math.max(-2.2, Math.min(2.2, (weightedScore / totalWeight) * 3.4));
}

function explain(candidate, selected, scores) {
  const reasons = [];
  const selectedRoles = selected.map((character) => character.role);
  const selectedDamage = selected.map((character) => character.damage);
  const currentTags = new Set(selected.flatMap((character) => character.tags));
  const addedTags = candidate.tags.filter((tag) => requiredTags.includes(tag) && !currentTags.has(tag));
  const job = roleJobs[candidate.role] ?? `${roleLabel(candidate)} 역할을 맡을 수 있습니다`;
  const identity = `${candidate.name}은 ${candidate.weaponLabel} 무기를 쓰는 ${roleLabel(candidate)} / ${damageLabel(candidate)} 실험체입니다.`;

  if (scores.roleBalance >= 1.5) {
    if (["frontline", "bruiser"].includes(candidate.role) && !selectedRoles.includes("frontline")) {
      reasons.push(`${identity} ${job} 그래서 팀의 핵심 딜러가 뒤에서 딜할 시간을 벌어줍니다.`);
    } else if (["ranged", "mage"].includes(candidate.role) && !selectedRoles.includes("ranged") && !selectedRoles.includes("mage")) {
      reasons.push(`${identity} 부족한 핵심 딜 자리를 채워 교전에서 마무리 딜을 담당합니다.`);
    } else if (candidate.role === "support") {
      reasons.push(`${identity} 아군을 살리고 받아치는 구도를 만들어 안정성을 올립니다.`);
    } else {
      reasons.push(`${identity} 현재 팀에 비어 있는 역할을 채워 조합의 형태를 잡아줍니다.`);
    }
  }

  if (scores.coverage >= 1.8 && addedTags.length > 0) {
    reasons.push(`${candidate.name}이 추가하는 ${labelList(addedTags)} 덕분에 지금 조합에 없는 교전 기능을 보완합니다.`);
  }

  if (scores.relationship >= 0.7) reasons.push(`누적 평가 데이터에서 ${candidate.name}과 현재 팀원의 실제 궁합이 좋게 기록되어 점수에 반영됐습니다.`);
  if (scores.relationship <= -0.7) reasons.push(`누적 평가 데이터에서는 ${candidate.name}과 현재 팀원의 궁합 평가가 낮아 감점이 들어갔습니다.`);

  if (scores.damageBalance > 0) {
    const otherDamage = selectedDamage.includes("basic") && candidate.damage !== "basic" ? "평타딜 위주 팀에 스킬딜 타이밍" : "스킬딜 위주 팀에 지속 평타 압박";
    reasons.push(`${damageLabel(candidate)} 비중이 있어 ${otherDamage}을 더해 딜 넣는 방식이 한쪽으로 치우치지 않습니다.`);
  }

  if (scores.weaponBalance > 0.5) {
    const rangeText = candidate.weaponRange === "ranged" ? "후방에서 안정적으로 딜하는 자리" : "앞에서 시야와 진입각을 잡는 자리";
    reasons.push(`${candidate.weaponLabel} 특성상 ${rangeText}를 맡아 팀의 교전 거리 배분을 맞춥니다.`);
  }

  if (scores.synergy >= 1.4) reasons.push(`${candidate.name}은 현재 팀원과 샘플 상성 점수가 높아 같이 쓸 때 기대값이 좋습니다.`);
  if (scores.dakComposition >= 1.1) reasons.push(`랭커 전적에서 ${candidate.name}이 비슷한 팀 조합과 함께 좋은 결과를 낸 기록이 있습니다.`);
  if (scores.dakTier >= 0.8) reasons.push(`${candidate.name}의 최근 통계 티어가 높아 현재 메타 기준으로도 선택 가치가 있습니다.`);
  if (scores.conflict <= -2) reasons.push(`${candidate.name}을 넣으면 역할이나 교전 방식이 겹쳐 조합 점수가 낮게 계산됩니다.`);
  if (selected.length === 0) reasons.push(`${identity} ${job} 첫 픽으로 조합 방향을 잡기 쉽습니다.`);
  if (reasons.length === 0 && candidate.tags.includes("cc")) reasons.push(`${candidate.name}은 CC로 교전 시작과 받아치기에 필요한 제어 능력을 더합니다.`);
  if (reasons.length === 0 && candidate.tags.includes("sustained")) reasons.push(`${candidate.name}은 ${damageLabel(candidate)} 기반으로 긴 교전에서 꾸준히 피해를 누적합니다.`);
  if (reasons.length === 0 && candidate.tags.includes("poke")) reasons.push(`${candidate.name}은 교전 전에 체력을 깎아 팀이 들어가기 좋은 각을 만듭니다.`);
  if (reasons.length === 0) reasons.push(`${identity} 현재 선택된 팀원과 역할이 크게 충돌하지 않는 후보입니다.`);
  return reasons.slice(0, 3);
}

function selectedCharactersFromIds(selectedIds) {
  return selectedIds
    .map((id) => characterVariants.find((character) => character.variantId === id))
    .filter(Boolean);
}

export function evaluateCandidate(selectedIds, candidateId, tier = "all", remoteFeedback = {}, relationshipRows = []) {
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
    relationship: relationshipScore(candidate, selected, tier, relationshipRows),
  };
  const total =
    scores.synergy * 1.6 +
    scores.coverage +
    scores.roleBalance +
    scores.damageBalance +
    scores.weaponBalance +
    scores.conflict +
    scores.dakComposition +
    scores.dakTier +
    scores.relationship -
    candidate.difficulty * 0.08 +
    getFeedbackScore(selectedIds, candidate.variantId, tier) +
    getFeedbackScore(selectedIds, candidate.variantId, tier, remoteFeedback) * 0.7;

  return {
    character: candidate,
    score: Number(total.toFixed(1)),
    reasons: explain(candidate, selected, scores),
  };
}

export function recommend(selectedIds, tier = "all", remoteFeedback = {}, candidateCharacterIds = undefined, relationshipRows = []) {
  const selected = selectedCharactersFromIds(selectedIds);

  const selectedCharacters = new Set(selected.map((character) => character.characterId));
  const candidatePool = candidateCharacterIds?.length ? new Set(candidateCharacterIds) : undefined;

  return characterVariants
    .filter((candidate) => !selectedCharacters.has(candidate.characterId))
    .filter((candidate) => !candidatePool || candidatePool.has(candidate.characterId))
    .map((candidate) => evaluateCandidate(selectedIds, candidate.variantId, tier, remoteFeedback, relationshipRows))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
}
