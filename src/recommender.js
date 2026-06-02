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
  short_range_dealer: "인파이팅 딜",
};

const damageCapableTankIds = new Set(["estelle", "elena", "lenox", "mirka", "markus", "magnus"]);

function labelList(values) {
  return [...new Set(values.map((value) => tagLabels[value] ?? value))].join(", ");
}

function roleLabel(character) {
  return roleNames[character.role] ?? character.role;
}

function damageLabel(character) {
  return damageLabels[character.damage] ?? character.damage;
}

function hasFinalConsonant(text) {
  const charCode = text.charCodeAt(text.length - 1);
  if (charCode < 0xac00 || charCode > 0xd7a3) return false;
  return (charCode - 0xac00) % 28 > 0;
}

function josa(text, withFinal, withoutFinal) {
  return `${text}${hasFinalConsonant(text) ? withFinal : withoutFinal}`;
}

function subjectName(character) {
  return josa(character.name, "은", "는");
}

function objectName(character) {
  return josa(character.name, "을", "를");
}

function withName(character) {
  return josa(character.name, "과", "와");
}

function ccPower(character) {
  const cc = character.ccProfile ?? {};
  const raw =
    (cc.targeted ?? 0) * 1.25 +
    (cc.nonTarget ?? 0) * 0.72 +
    (cc.single ?? 0) * 0.58 +
    (cc.veryNarrow ?? 0) * 0.34 +
    (cc.narrow ?? 0) * 0.46 +
    (cc.medium ?? 0) * 0.68 +
    (cc.wide ?? 0) * 0.94;
  return raw * (cc.conditional ? 0.86 : 1);
}

function teamCcPower(selected) {
  return selected.reduce((sum, character) => sum + ccPower(character), 0);
}

function ccCoverageScore(candidate, selected) {
  const candidateCc = ccPower(candidate);
  if (candidateCc <= 0) return 0;

  const teamCc = teamCcPower(selected);
  const teamTargeted = selected.reduce((sum, character) => sum + (character.ccProfile?.targeted ?? 0), 0);
  const teamArea = selected.reduce((sum, character) => sum + (character.ccProfile?.medium ?? 0) + (character.ccProfile?.wide ?? 0), 0);
  const candidateArea = (candidate.ccProfile?.medium ?? 0) + (candidate.ccProfile?.wide ?? 0);
  let score = 0;

  if (teamCc < 1.4) score += Math.min(1.5, candidateCc * 0.42);
  else if (teamCc < 3.0) score += Math.min(0.9, candidateCc * 0.22);

  if (teamTargeted === 0 && (candidate.ccProfile?.targeted ?? 0) > 0) score += 0.45;
  if (teamArea === 0 && candidateArea > 0) score += 0.38;
  return Math.min(1.9, score);
}

function ccSummary(character) {
  const cc = character.ccProfile ?? {};
  const parts = [];
  if (cc.targeted) parts.push(`타겟팅 CC ${cc.targeted}개`);
  if (cc.nonTarget) parts.push(`논타겟 CC ${cc.nonTarget}개`);

  const areas = [];
  if (cc.wide) areas.push(`넓은 광역 ${cc.wide}개`);
  if (cc.medium) areas.push(`중간 광역 ${cc.medium}개`);
  if (cc.narrow) areas.push(`좁은 광역 ${cc.narrow}개`);
  if (cc.veryNarrow) areas.push(`매우 좁은 광역 ${cc.veryNarrow}개`);
  if (cc.single) areas.push(`단일 대상 ${cc.single}개`);
  if (areas.length) parts.push(areas.join(", "));
  if (cc.conditional) parts.push("조건부 CC 포함");

  return parts.join(", ");
}

function isTank(character) {
  return character.role === "frontline";
}

function isMeleeDealer(character) {
  return character.role === "bruiser" || character.role === "assassin";
}

function isBacklineDealer(character) {
  return character.role === "ranged" || character.role === "mage";
}

function isSupport(character) {
  return character.role === "support";
}

function isReliableDps(character) {
  return isMeleeDealer(character) || isBacklineDealer(character);
}

function isDamageLeaningTank(character) {
  return (
    isTank(character) &&
    (character.damage === "hybrid" ||
      character.tags.includes("burst") ||
      character.tags.includes("sustained") ||
      damageCapableTankIds.has(character.characterId))
  );
}

function isLongRangeCarry(character) {
  return isBacklineDealer(character) && character.tags.includes("range") && !character.tags.includes("short_range_dealer");
}

function isSustainedCarry(character) {
  return character.tags.includes("sustained") || character.damage === "basic";
}

function isDiveFollowUp(character) {
  return character.tags.includes("dive") || character.tags.includes("mobility") || isMeleeDealer(character);
}

function teamShape(team) {
  return {
    tanks: team.filter(isTank).length,
    melee: team.filter(isMeleeDealer).length,
    backline: team.filter(isBacklineDealer).length,
    supports: team.filter(isSupport).length,
    reliableDps: team.filter(isReliableDps).length,
    damageTanks: team.filter(isDamageLeaningTank).length,
    longRangeCarries: team.filter(isLongRangeCarry).length,
    sustainedCarries: team.filter(isSustainedCarry).length,
    diveFollowUps: team.filter(isDiveFollowUp).length,
  };
}

function teamShapeScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;

  const shape = teamShape(team);
  const hasInitiator = team.some((character) => character.tags.includes("initiate")) || teamCcPower(team) >= 3.0;
  const hasPeel = team.some((character) => character.tags.includes("peel") || character.tags.includes("shield") || character.tags.includes("healing"));
  let score = 0;

  if (shape.reliableDps < 2) score -= 3.2;
  if (shape.tanks >= 2) score -= 2.2;
  if (shape.tanks >= 1 && shape.supports >= 1) score -= shape.reliableDps >= 2 ? 1.8 : 3.8;
  if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) score -= isDamageLeaningTank(team.find(isTank)) ? 1.2 : 8.0;

  if (shape.tanks === 1 && shape.backline === 2 && shape.supports === 0) score += 1.9;
  if (shape.tanks === 0 && shape.melee === 2 && shape.backline === 1) score += 1.7;
  if (shape.tanks === 0 && shape.melee === 2 && shape.supports === 1) score += 1.5;

  if (hasInitiator && shape.diveFollowUps >= 2) score += 1.0;
  if (shape.longRangeCarries >= 1 && shape.sustainedCarries >= 1 && (hasPeel || teamCcPower(team) >= 2.4)) score += 0.9;
  if (shape.longRangeCarries >= 2 && !hasPeel && teamCcPower(team) < 2.0) score -= 0.8;
  if (shape.sustainedCarries >= 2 && teamCcPower(team) < 1.6) score -= 0.7;

  return Math.max(-8.0, Math.min(2.6, score));
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
  return candidate.tags.filter((tag) => missing.includes(tag)).length * 0.9 + ccCoverageScore(candidate, selected);
}

function roleBalanceScore(candidate, selected) {
  const roles = selected.map((character) => character.role);
  if (roles.length === 0) return 1;
  const hasMeleeDealer = selected.some(isMeleeDealer);
  const hasBacklineDealer = selected.some(isBacklineDealer);
  const hasTank = selected.some(isTank);
  if (selected.length >= 2 && isTank(candidate) && hasMeleeDealer && hasBacklineDealer) return -1.2;
  if (selected.length >= 2 && isSupport(candidate) && hasTank) return -2.0;
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
  if (isSupport(candidate)) return 0;
  const ranges = selected.map((character) => character.weaponRange);
  if (candidate.weaponRange === "unknown") return -0.4;
  const sameRangeCount = ranges.filter((range) => range === candidate.weaponRange).length;
  const selectedRoles = selected.map((character) => character.role);
  const selectedTags = new Set(selected.flatMap((character) => character.tags));
  const hasFrontline = selectedRoles.some((role) => role === "frontline" || role === "bruiser");
  const hasControl = selectedTags.has("cc") || selectedTags.has("initiate") || teamCcPower(selected) >= 2.0;
  const shortRangeFit = candidate.tags.includes("short_range_dealer")
    ? hasFrontline && hasControl
      ? 0.55
      : selected.length >= 2
        ? -0.65
        : -0.15
    : 0;
  if (sameRangeCount >= 2) return -0.8;
  if (ranges.includes("melee") && candidate.weaponRange === "ranged") return 0.8 + shortRangeFit;
  if (ranges.includes("ranged") && candidate.weaponRange === "melee") return 0.6 + shortRangeFit;
  return 0.2 + shortRangeFit;
}

function conflictScore(candidate, selected) {
  if (selected.length < 2) return 0;
  const nextTeam = [...selected, candidate];
  const roles = nextTeam.map((character) => character.role);
  const ranges = nextTeam.map((character) => character.weaponRange);
  const tags = new Set(nextTeam.flatMap((character) => character.tags));
  const totalCc = teamCcPower(nextTeam);
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
  if (totalCc < 1.2) penalty -= 0.8;
  if (!tags.has("focus") && !tags.has("burst")) penalty -= 0.8;

  return penalty;
}

function dakCompositionScore(candidate, selected) {
  if (selected.length === 0 || rankerCompositionStats.length === 0) return 0;

  const selectedCharacters = new Set(selected.map((character) => character.characterId));
  const rows = rankerCompositionStats.filter((row) => row.candidate === candidate.characterId);
  if (rows.length === 0) return 0;

  const aggregate = rows.reduce((state, row) => {
    const teammates = row.teammates ?? [];
    const matchedCount = teammates.filter((characterId) => selectedCharacters.has(characterId)).length;
    if (matchedCount === 0) return state;

    const exactMatch = matchedCount === selectedCharacters.size;
    const matchWeight = exactMatch ? 1.45 : 0.48;
    const sampleWeight = Math.min(1.25, Math.log2((row.games ?? 0) + 1) / 3);
    const craftWeight = oneTrickWeight(row.oneTrickRatio);
    const weight = matchedCount * matchWeight * sampleWeight * craftWeight;
    state.score += placementScore(row) * weight;
    state.weight += weight;
    return state;
  }, { score: 0, weight: 0 });

  if (aggregate.weight === 0) return 0;
  return Math.max(-2.8, Math.min(2.8, (aggregate.score / aggregate.weight) * 1.7));
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
  const identity = `${subjectName(candidate)} ${candidate.weaponLabel} 무기를 쓰는 ${roleLabel(candidate)} / ${damageLabel(candidate)} 실험체입니다.`;

  if (scores.teamShape <= -2.2) {
    const team = [...selected, candidate];
    const shape = teamShape(team);
    if (shape.tanks >= 1 && shape.supports >= 1) {
      reasons.push(`탱커와 서포터가 함께 들어가면 딜 자리가 부족해지기 쉬워 조합 점수가 크게 낮아집니다.`);
    } else if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) {
      const tank = team.find(isTank);
      if (isDamageLeaningTank(tank)) {
        reasons.push(`1탱 1근 1원 구조지만, ${subjectName(tank)} 딜 기여가 가능한 탱커라 화력 보충을 전제로 어느 정도 성립할 수 있습니다.`);
      } else {
        reasons.push(`1탱 1근 1원 구조는 근딜이 먼저 점사당하기 쉽고 탱커의 딜 기여도 낮아 감점되었습니다.`);
      }
    } else if (shape.reliableDps < 2) {
      reasons.push(`현재 형태는 딜러 자리가 부족해 상대를 마무리할 화력이 모자랄 수 있습니다.`);
    }
  }
  if (scores.teamShape > -2.2) {
    const team = [...selected, candidate];
    const shape = teamShape(team);
    const tank = team.find(isTank);
    if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1 && isDamageLeaningTank(tank)) {
      reasons.push(`1탱 1근 1원 구조라 기본 효율은 낮지만, ${subjectName(tank)} 딜 기여가 가능한 탱커라 화력 보충을 전제로 선택할 수 있습니다.`);
    }
  }
  if (scores.teamShape >= 1.4) reasons.push(`${objectName(candidate)} 넣으면 1탱 2원, 2근 1원, 2근 1서포터처럼 딜 자리가 충분한 안정적인 조합 형태가 됩니다.`);

  if (scores.roleBalance >= 1.5) {
    if (["frontline", "bruiser"].includes(candidate.role) && !selectedRoles.includes("frontline")) {
      reasons.push(`${identity} ${job}. 팀의 핵심 딜러가 뒤에서 딜할 시간을 벌어줍니다.`);
    } else if (["ranged", "mage"].includes(candidate.role) && !selectedRoles.includes("ranged") && !selectedRoles.includes("mage")) {
      reasons.push(`${identity} 부족한 핵심 딜 자리를 채워 교전에서 마무리 딜을 담당합니다.`);
    } else if (candidate.role === "support") {
      reasons.push(`${identity} 아군을 살리고 받아치는 구도를 만들어 안정성을 올립니다.`);
    } else {
      reasons.push(`${identity} 현재 팀에 비어 있는 역할을 채워 조합의 형태를 잡아줍니다.`);
    }
  }

  if (scores.coverage >= 1.8 && addedTags.length > 0) {
    reasons.push(`${subjectName(candidate)} ${labelList(addedTags)} 역할을 더해 현재 조합에 부족한 교전 기능을 보완합니다.`);
  }

  const ccScore = ccCoverageScore(candidate, selected);
  const ccText = ccSummary(candidate);
  if (ccScore >= 0.45 && ccText) {
    reasons.push(`현재 조합에 CC가 부족한 편이라, ${subjectName(candidate)} ${ccText}를 보태 교전 시작과 받아치기를 더 안정적으로 만듭니다.`);
  }

  if (scores.relationship >= 0.7) reasons.push(`누적 평가 데이터에서 ${withName(candidate)} 현재 팀원의 실제 궁합이 좋게 기록되어 가산점이 반영되었습니다.`);
  if (scores.relationship <= -0.7) reasons.push(`누적 평가 데이터에서 ${withName(candidate)} 현재 팀원의 궁합 평가가 낮아 감점이 반영되었습니다.`);

  if (scores.damageBalance > 0) {
    if (candidate.damage === "basic") {
      reasons.push(`평타딜을 보태 스킬딜 위주 조합의 딜 공백을 줄이고, 긴 교전에서 꾸준한 압박을 만듭니다.`);
    } else if (candidate.damage === "skill") {
      reasons.push(`스킬딜 타이밍을 보태 평타딜 위주 조합의 교전 패턴을 보완합니다.`);
    } else {
      reasons.push(`평타와 스킬을 함께 쓰는 혼합딜로 팀의 딜 방식이 한쪽으로 치우치지 않게 합니다.`);
    }
  }

  if (scores.weaponBalance > 0.5) {
    const rangeText = candidate.tags.includes("short_range_dealer")
      ? "앞라인 뒤에서 짧은 거리의 교전을 받아먹는 자리"
      : candidate.weaponRange === "ranged"
        ? "후방에서 안정적으로 딜하는 자리"
        : "앞에서 시야와 진입각을 잡는 자리";
    reasons.push(`${candidate.weaponLabel} 특성상 ${rangeText}를 맡아 팀의 교전 거리 배분을 맞춥니다.`);
  }

  if (candidate.tags.includes("short_range_dealer")) {
    const hasFrontline = selectedRoles.some((role) => role === "frontline" || role === "bruiser");
    const hasControl = currentTags.has("cc") || currentTags.has("initiate") || teamCcPower(selected) >= 2.0;
    if (hasFrontline && hasControl) {
      reasons.push(`${subjectName(candidate)} 팔이 짧은 인파이팅 딜러라, 앞라인과 CC가 만든 짧은 교전 안에서 화력을 집중하기 좋습니다.`);
    } else if (selected.length >= 2) {
      reasons.push(`${subjectName(candidate)} 짧은 거리에서 강한 딜러지만, 현재 조합은 진입각이나 보호 수단이 부족해 점수가 낮게 잡힐 수 있습니다.`);
    }
  }

  if (scores.synergy >= 1.4) reasons.push(`${subjectName(candidate)} 현재 팀원과의 샘플 상성 점수가 높아 함께 쓸 때 기대값이 좋습니다.`);
  if (scores.dakComposition >= 1.1) reasons.push(`랭커 전적에서 ${subjectName(candidate)} 비슷한 팀 조합과 함께 좋은 결과를 낸 기록이 있습니다.`);
  if (scores.dakComposition <= -0.8) reasons.push(`랭커 전적 기준으로 ${subjectName(candidate)} 비슷한 조합에서 하위권을 기록한 사례가 있어 감점되었습니다.`);
  if (scores.dakTier >= 0.8) reasons.push(`${candidate.name}의 최근 통계 티어가 높아 현재 메타 기준으로도 선택 가치가 있습니다.`);
  if (scores.conflict <= -2) reasons.push(`${objectName(candidate)} 넣으면 역할이나 교전 방식이 겹쳐 조합 점수가 낮게 계산됩니다.`);
  if (selected.length === 0) reasons.push(`${identity} ${job} 첫 픽으로 조합 방향을 잡기 쉽습니다.`);
  if (reasons.length === 0 && candidate.tags.includes("cc")) reasons.push(`${subjectName(candidate)} CC로 교전 시작과 받아치기에 필요한 제어 능력을 더합니다.`);
  if (reasons.length === 0 && candidate.tags.includes("sustained")) reasons.push(`${subjectName(candidate)} ${damageLabel(candidate)} 기반으로 긴 교전에서 꾸준히 피해를 누적합니다.`);
  if (reasons.length === 0 && candidate.tags.includes("poke")) reasons.push(`${subjectName(candidate)} 교전 전에 체력을 깎아 팀이 들어가기 좋은 각을 만듭니다.`);
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
    teamShape: teamShapeScore(candidate, selected),
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
    scores.teamShape +
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
