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
  basic: "평타 딜러",
  skill: "스킬 딜러",
  hybrid: "교전형 딜러",
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

const signatureReasons = {
  garnet: "가넷은 단단하게 버티면서 광역 CC로 진입각을 열 수 있어 앞라인이 필요한 조합에 잘 맞습니다.",
  nadine: "나딘은 오브젝트와 긴 교전에서 누적 화력이 강해 앞라인이 시간을 벌어주는 조합에서 가치가 큽니다.",
  nathapon: "나타폰은 카메라 기반 스킬 화력과 CC로 대치 중 상대를 묶어 아군 스킬 적중률을 높여줍니다.",
  nia: "니아는 짧은 폭딜과 포커싱이 강해 CC가 걸린 대상을 빠르게 마무리하기 좋습니다.",
  nicky: "니키는 반격과 진입으로 상대 핵심 딜러에게 압박을 줄 수 있어 박치기 조합의 선봉 역할에 어울립니다.",
  daniel: "다니엘은 후방 딜러를 노리는 암살 압박이 강해 상대 원딜 중심 조합을 흔들기 좋습니다.",
  darko: "다르코는 단단하게 들어가 광역 CC와 근접 압박을 동시에 만들 수 있어 교전 시작점이 됩니다.",
  debi_marlene: "데비&마를렌은 진입 후 지속 교전 화력이 좋아 앞라인이 열린 뒤 따라 들어가는 구도에 강합니다.",
  tia: "띠아는 광역 스킬과 CC로 좁은 지형 교전에서 상대 진형을 무너뜨리기 좋습니다.",
  laura: "라우라는 기동성과 순간 진입으로 상대 원거리 딜러를 직접 압박하는 브루저 역할에 적합합니다.",
  lenox: "레녹스는 지속적인 견제와 저지력이 좋아 상대 진입을 끊고 아군 딜러가 딜할 시간을 벌어줍니다.",
  leni: "레니는 보호와 보조 CC를 통해 진입한 아군을 살리고 짧은 교전을 길게 이어가게 해줍니다.",
  leon: "레온은 물 지형과 광역 진입으로 한 번에 교전을 열기 좋아 호응 가능한 딜러와 잘 맞습니다.",
  rozzi: "로지는 권총 기동성과 짧은 교전 폭딜로 CC에 걸린 대상을 빠르게 추격해 마무리하기 좋습니다.",
  luke: "루크는 1:1 압박과 진입 후 지속딜이 좋아 사이드 운영과 포커싱 교전에 힘을 보탭니다.",
  lenore: "르노어는 대치 구도에서 포킹과 CC를 섞어 상대가 먼저 들어오기 어렵게 만듭니다.",
  li_dailin: "리 다이린은 진입 후 난전 지속력이 좋아 앞라인이 흔든 전장에 따라 들어가기 좋습니다.",
  rio: "리오는 긴 사거리의 평타 지속딜로 앞라인 뒤에서 안정적으로 핵심 화력을 담당합니다.",
  martina: "마르티나는 카메라 기반 견제와 후반 화력이 있어 대치가 길어지는 조합에서 힘을 냅니다.",
  mai: "마이는 보호와 세이브 능력이 좋아 아군 핵심 딜러를 살리는 받아치기 조합에 어울립니다.",
  markus: "마커스는 단단한 진입과 딜 기여를 함께 할 수 있어 1탱 1근 1원에서도 화력 공백을 줄여줍니다.",
  magnus: "매그너스는 강한 진입과 근접 압박으로 상대 진형을 밀어내고 교전 시작점을 만들기 좋습니다.",
  mirka: "미르카는 탱커 중에서도 딜 기여와 광역 CC가 있어 앞라인과 화력 보충을 동시에 맡을 수 있습니다.",
  vanya: "바냐는 보호막과 광역 견제로 상대 진입을 받아치며 긴 교전을 안정적으로 만듭니다.",
  barbara: "바바라는 설치물 중심의 지역 장악으로 상대가 들어오는 길을 제한하고 지속 화력을 냅니다.",
  bernice: "버니스는 덫과 저지력으로 상대 진입을 끊어 짧은 사거리 딜러의 약점을 보완합니다.",
  blair: "블레어는 근접 브루저처럼 붙어서 화염 장판과 스킬 압박을 이어가며 난전에서 화력을 보탭니다.",
  bianca: "비앙카는 순간 폭딜과 단일 CC로 한 대상을 빠르게 전장이탈시키는 데 강점이 있습니다.",
  bihyung: "비형은 진입 후 순간 화력과 포커싱이 좋아 상대 핵심 딜러를 빠르게 압박합니다.",
  celine: "셀린은 폭발물 기반 광역 압박으로 좁은 길목에서 상대 체력을 크게 깎아줍니다.",
  sua: "수아는 단단함과 CC, 유지력을 함께 갖춰 앞에서 오래 버티며 교전을 이어갑니다.",
  sissela: "시셀라는 원거리 견제와 생존력을 바탕으로 대치 중 체력을 깎고 받아치는 구도에 강합니다.",
  silvia: "실비아는 기동성으로 교전 각을 빠르게 바꾸며 짧은 거리에서 딜과 진입을 함께 수행합니다.",
  adela: "아델라는 스킬 배치와 CC로 상대 이동을 제한해 아군 스킬 딜러의 적중 각을 만들어줍니다.",
  arda: "아르다는 CC와 보조 능력으로 박치기 조합의 진입 호응을 안정적으로 만들어줍니다.",
  alonso: "알론소는 확정 CC와 넓은 광역 제어로 한 번에 교전을 열어 아군 포커싱 대상을 만들어줍니다.",
  yan: "얀은 근접 난전에서 CC와 압박을 넣어 상대 딜러가 편하게 딜하지 못하게 만듭니다.",
  estelle: "에스텔은 보호와 딜 기여가 모두 가능해 탱커지만 화력 공백을 어느 정도 메울 수 있습니다.",
  elena: "엘레나는 광역 진입과 딜 기여가 있어 앞라인을 세우면서도 교전 화력을 보탭니다.",
  yumin: "유민은 스킬 딜러로 중거리 포킹과 유틸을 섞어 앞라인 뒤에서 안정적으로 압박을 넣습니다.",
  justina: "유스티나는 스킬 화력과 기동성을 살려 대치 중 빈틈을 찌르고 포커싱 대상을 빠르게 압박합니다.",
  ian: "이안은 진입 후 폭딜과 포커싱이 강해 CC가 들어간 대상을 빠르게 녹이는 데 어울립니다.",
  eleven: "일레븐은 도발로 상대 진입을 끊거나 한 명을 묶어 아군 딜러가 때릴 시간을 만듭니다.",
  cathy: "캐시는 빠른 진입과 폭딜로 상대 후방을 직접 노리는 암살 압박을 제공합니다.",
  kenneth: "케네스는 단단한 근접 지속딜로 앞라인과 함께 오래 싸우는 난전에 강합니다.",
  theodore: "테오도르는 원거리 지원과 보호막을 통해 대치 구도에서 아군 딜러의 안정성을 높입니다.",
  hart: "하트는 짧은 거리에서 꾸준한 평타 화력과 기동성을 살려 앞라인이 만든 교전 안에서 힘을 냅니다.",
  tazia: "타지아는 짧은 거리 스킬 폭딜로 CC에 걸린 대상을 빠르게 마무리하는 데 강점이 있습니다.",
  karla: "칼라는 스킬 딜러로 석궁 견제와 CC를 섞어 근거리로 붙는 상대를 제어하며 딜을 넣습니다.",
  jenny: "제니는 기동성과 순간 스킬 화력으로 짧은 교전에서 포커싱 대상을 빠르게 압박합니다.",
  tsubame: "츠바메는 짧은 사거리의 원거리 딜러지만 기동성과 순간 화력이 좋아 근접 난전에서 포커싱을 돕습니다.",
  henry: "헨리는 짧은 사거리 스킬 딜러로 넓은 CC와 포킹을 섞어 상대 진입을 받아치는 데 힘을 보탭니다.",
};

const variantSignatureReasons = {
  "nadine:bow": "활 나딘은 스킬 딜러로 긴 사거리 견제와 오브젝트 압박을 맡아 대치 구도에서 힘을 냅니다.",
  "isol:pistol": "권총 아이솔은 스킬 딜러로 기동성과 함정 견제를 살려 상대 진입로를 제한하고 포킹을 넣습니다.",
  "magnus:bat": "방망이 매그너스는 탱커보다는 브루저로 들어가 근접 압박과 딜 교환을 맡는 픽입니다.",
  "magnus:hammer": "망치 매그너스는 탱커로 앞라인을 세우면서도 교전 중간중간 딜을 섞을 수 있습니다.",
  "markus:axe": "도끼 마커스는 탱커 역할을 하면서도 근접 딜 교환이 가능해 화력 공백을 줄입니다.",
  "markus:hammer": "망치 마커스는 단단한 진입과 광역 압박으로 앞라인 교전을 열기 좋습니다.",
  "sho:dagger": "단검 쇼우는 탱커 역할을 하되 짧은 교전에서 더 빠르게 압박을 넣는 선택지입니다.",
  "sho:spear": "창 쇼우는 앞라인에서 버티며 지속 교전과 진입각을 안정적으로 만들어줍니다.",
  "aya:pistol": "권총 아야는 기동성이 좋은 스킬 딜러라 위치를 바꾸며 포킹과 마무리 딜을 넣기 좋습니다.",
  "aya:sniper_rifle": "저격총 아야는 더 강한 스킬 화력과 긴 사거리로 대치 구도에서 상대 핵심 딜러를 압박합니다.",
  "aya:assault_rifle": "돌격소총 아야는 평타 지속딜이 안정적이라 앞라인 뒤에서 꾸준히 화력을 넣을 수 있습니다.",
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

function signatureReason(character) {
  return variantSignatureReasons[character.variantId] ?? signatureReasons[character.characterId];
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
  const total = (cc.targeted ?? 0) + (cc.nonTarget ?? 0);
  const areaTotal = (cc.wide ?? 0) + (cc.medium ?? 0);

  if (cc.targeted) parts.push("확정 CC");
  if (areaTotal) parts.push("광역 CC");
  if (total > 0 && parts.length === 0) parts.push("CC기");
  if (cc.conditional && parts.length > 0) parts.push("조건부 CC");

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

function teamShapeLabel(shape) {
  if (shape.tanks === 1 && shape.backline === 2 && shape.melee === 0 && shape.supports === 0) return "1탱 2원";
  if (shape.tanks === 0 && shape.melee === 1 && shape.backline === 2 && shape.supports === 0) return "1근 2원";
  if (shape.tanks === 0 && shape.melee === 2 && shape.backline === 1 && shape.supports === 0) return "2근 1원";
  if (shape.tanks === 0 && shape.melee === 2 && shape.supports === 1 && shape.backline === 0) return "2근 1서포터";
  if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1 && shape.supports === 0) return "1탱 1근 1원";
  if (shape.tanks >= 1 && shape.supports >= 1) return "탱커+서포터";
  if (shape.tanks >= 2) return "투탱";
  return `${shape.tanks}탱 ${shape.melee}근 ${shape.backline}원${shape.supports ? ` ${shape.supports}서포터` : ""}`;
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

function killPressureScore(candidate, selected) {
  if (!isBacklineDealer(candidate)) return 0;
  const damageTypes = selected.map((character) => character.damage);
  const basicCount = damageTypes.filter((type) => type === "basic").length;
  const skillCount = damageTypes.filter((type) => type === "skill").length;

  if (candidate.damage === "basic" && basicCount === 0) return 0.7;
  if (candidate.damage === "skill" && skillCount === 0) return 0.45;
  if (candidate.damage === "hybrid" && basicCount === 0) return 0.35;
  if (candidate.damage === "skill" && skillCount >= 2 && basicCount === 0) return -0.7;
  return 0;
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
  const identityDetail = isBacklineDealer(candidate) ? ` / ${damageLabel(candidate)}` : "";
  const identity = `${subjectName(candidate)} ${candidate.weaponLabel} 무기를 쓰는 ${roleLabel(candidate)}${identityDetail} 실험체입니다.`;
  const signature = signatureReason(candidate);

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
  if (scores.teamShape >= 1.4) {
    const shape = teamShape([...selected, candidate]);
    const shapeLabel = teamShapeLabel(shape);
    reasons.push(`${objectName(candidate)} 넣으면 ${shapeLabel} 조합이 됩니다. 딜러 자리가 충분해 교전에서 상대를 마무리할 화력이 나옵니다.`);
  }
  if (signature) reasons.push(signature);

  if (scores.roleBalance >= 1.5 && reasons.length < 1) {
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

  if (scores.killPressure > 0 && isBacklineDealer(candidate)) {
    if (candidate.damage === "basic") {
      reasons.push(`평타 딜러라 스킬이 빗나간 뒤에도 확정적으로 킬캐치를 이어갈 수 있습니다.`);
    } else if (candidate.damage === "skill") {
      reasons.push(`스킬 딜러라 유틸, 사거리, 순간 화력을 보태 교전 각을 더 다양하게 만듭니다.`);
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
    killPressure: killPressureScore(candidate, selected),
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
    scores.killPressure +
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
