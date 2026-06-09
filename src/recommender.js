import { characterVariants, roleNames, synergyPairs } from "./data.js";
import { getFeedbackScore, loadFeedback } from "./feedback.js";
import {
  experimentTiers,
  oneTrickWeight,
  placementScore,
  rankerCandidateStats,
  rankerCompositionStats,
  statisticsPerformance,
  statsBucketForTier,
  tierScoreWeights,
} from "./metaData.js";
import { metricCompositionReason, teamMetricProfile } from "./characterMetrics.js";
import { dakggRealtimeStatsByVariant, realtimeStatAverages } from "./dakggRealtimeStats.js";
import { t } from "./i18n/index.js";
import { tournamentCompositions } from "./tournamentMeta.js";
import {
  cannotStartEngage,
  helpsMeleeEngage,
  isCounterOnlyRanged,
  isDelayedEngageStyle,
  isFirstEngageStyle,
  isGuardOnly,
  isGuardSometimesEngage,
  isPokeThenEngage,
  likesDiveFollow,
} from "./combatProfiles.js";

const requiredTags = ["initiate", "focus", "peel", "cc", "sustained", "poke", "burst"];

// Pre-built indexes for O(1) lookup instead of O(n) filter on every evaluateCandidate call
const _rankerCompositionByCandidate = new Map();
for (const row of rankerCompositionStats) {
  const key = row.candidate;
  if (!_rankerCompositionByCandidate.has(key)) _rankerCompositionByCandidate.set(key, []);
  _rankerCompositionByCandidate.get(key).push(row);
}

const _tournamentCompositionByCandidate = new Map();
for (const row of tournamentCompositions) {
  for (const memberId of row.members ?? []) {
    if (!_tournamentCompositionByCandidate.has(memberId)) _tournamentCompositionByCandidate.set(memberId, []);
    _tournamentCompositionByCandidate.get(memberId).push(row);
  }
}

// Pre-resolved tournament row teams for tournamentArchetypeScore (avoids repeated .find calls)
const _tournamentCompositionTeams = tournamentCompositions.map((row) => ({
  row,
  team: (row.members ?? []).map((id) => characterVariants.find((c) => c.characterId === id)).filter(Boolean),
  memberSet: new Set(row.members ?? []),
}));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const damageLabels = {
  basic: "recommender.damageLabels.basic",
  skill: "recommender.damageLabels.skill",
  hybrid: "recommender.damageLabels.hybrid",
};

const roleJobs = {
  frontline: "recommender.roleJobs.frontline",
  bruiser: "recommender.roleJobs.bruiser",
  ranged: "recommender.roleJobs.ranged",
  mage: "recommender.roleJobs.mage",
  assassin: "recommender.roleJobs.assassin",
  support: "recommender.roleJobs.support",
};

const tagLabels = {
  initiate: "recommender.tagLabels.initiate",
  engage: "recommender.tagLabels.engage",
  focus: "recommender.tagLabels.focus",
  cc: "recommender.tagLabels.cc",
  peel: "recommender.tagLabels.peel",
  sustained: "recommender.tagLabels.sustained",
  burst: "recommender.tagLabels.burst",
  poke: "recommender.tagLabels.poke",
  durable: "recommender.tagLabels.durable",
  shield: "recommender.tagLabels.shield",
  healing: "recommender.tagLabels.healing",
  utility: "recommender.tagLabels.utility",
  range: "recommender.tagLabels.range",
  zone: "recommender.tagLabels.zone",
  dive: "recommender.tagLabels.dive",
  mobility: "recommender.tagLabels.mobility",
  objective: "recommender.tagLabels.objective",
  duel: "recommender.tagLabels.duel",
  pick: "recommender.tagLabels.pick",
  sustain: "recommender.tagLabels.sustain",
  short_range_dealer: "recommender.tagLabels.short_range_dealer",
};

const counterEngageAnchorIds = new Set(["lenox"]);
const lateButCanStartIds = new Set(["fenrir"]);
const lateEngageIds = new Set(["vanya"]);
const needsEngageHelpIds = new Set(["jackie", "shoichi"]);
const meleeEngageHelperIds = new Set(["coreline"]);

const signatureReasons = {
  garnet: "recommender.signatureReasons.garnet",
  nadine: "recommender.signatureReasons.nadine",
  nathapon: "recommender.signatureReasons.nathapon",
  nia: "recommender.signatureReasons.nia",
  nicky: "recommender.signatureReasons.nicky",
  daniel: "recommender.signatureReasons.daniel",
  darko: "recommender.signatureReasons.darko",
  debi_marlene: "recommender.signatureReasons.debi_marlene",
  tia: "recommender.signatureReasons.tia",
  laura: "recommender.signatureReasons.laura",
  lenox: "recommender.signatureReasons.lenox",
  leni: "recommender.signatureReasons.leni",
  leon: "recommender.signatureReasons.leon",
  rozzi: "recommender.signatureReasons.rozzi",
  luke: "recommender.signatureReasons.luke",
  lenore: "recommender.signatureReasons.lenore",
  li_dailin: "recommender.signatureReasons.li_dailin",
  rio: "recommender.signatureReasons.rio",
  martina: "recommender.signatureReasons.martina",
  mai: "recommender.signatureReasons.mai",
  markus: "recommender.signatureReasons.markus",
  magnus: "recommender.signatureReasons.magnus",
  mirka: "recommender.signatureReasons.mirka",
  vanya: "recommender.signatureReasons.vanya",
  barbara: "recommender.signatureReasons.barbara",
  bernice: "recommender.signatureReasons.bernice",
  blair: "recommender.signatureReasons.blair",
  bianca: "recommender.signatureReasons.bianca",
  bihyung: "recommender.signatureReasons.bihyung",
  celine: "recommender.signatureReasons.celine",
  sua: "recommender.signatureReasons.sua",
  sissela: "recommender.signatureReasons.sissela",
  silvia: "recommender.signatureReasons.silvia",
  adela: "recommender.signatureReasons.adela",
  arda: "recommender.signatureReasons.arda",
  alonso: "recommender.signatureReasons.alonso",
  yan: "recommender.signatureReasons.yan",
  estelle: "recommender.signatureReasons.estelle",
  elena: "recommender.signatureReasons.elena",
  yumin: "recommender.signatureReasons.yumin",
  justina: "recommender.signatureReasons.justina",
  ian: "recommender.signatureReasons.ian",
  eleven: "recommender.signatureReasons.eleven",
  cathy: "recommender.signatureReasons.cathy",
  kenneth: "recommender.signatureReasons.kenneth",
  theodore: "recommender.signatureReasons.theodore",
  hart: "recommender.signatureReasons.hart",
  tazia: "recommender.signatureReasons.tazia",
  karla: "recommender.signatureReasons.karla",
  jenny: "recommender.signatureReasons.jenny",
  tsubame: "recommender.signatureReasons.tsubame",
  henry: "recommender.signatureReasons.henry",
  abigail: "recommender.signatureReasons.abigail",
  adina: "recommender.signatureReasons.adina",
  adriana: "recommender.signatureReasons.adriana",
  aiden: "recommender.signatureReasons.aiden",
  alex: "recommender.signatureReasons.alex",
  camilo: "recommender.signatureReasons.camilo",
  charlotte: "recommender.signatureReasons.charlotte",
  chiara: "recommender.signatureReasons.chiara",
  chloe: "recommender.signatureReasons.chloe",
  coreline: "recommender.signatureReasons.coreline",
  echion: "recommender.signatureReasons.echion",
  emma: "recommender.signatureReasons.emma",
  eva: "recommender.signatureReasons.eva",
  felix: "recommender.signatureReasons.felix",
  fenrir: "recommender.signatureReasons.fenrir",
  fiora: "recommender.signatureReasons.fiora",
  haze: "recommender.signatureReasons.haze",
  hisui: "recommender.signatureReasons.hisui",
  hyejin: "recommender.signatureReasons.hyejin",
  hyunwoo: "recommender.signatureReasons.hyunwoo",
  irem: "recommender.signatureReasons.irem",
  isaac: "recommender.signatureReasons.isaac",
  isol: "recommender.signatureReasons.isol",
  istvan: "recommender.signatureReasons.istvan",
  jackie: "recommender.signatureReasons.jackie",
  johann: "recommender.signatureReasons.johann",
  katja: "recommender.signatureReasons.katja",
  piolo: "recommender.signatureReasons.piolo",
  priya: "recommender.signatureReasons.priya",
  shirin: "recommender.signatureReasons.shirin",
  shoichi: "recommender.signatureReasons.shoichi",
  william: "recommender.signatureReasons.william",
  yuki: "recommender.signatureReasons.yuki",
  zahir: "recommender.signatureReasons.zahir",
};;

const variantSignatureReasons = {
  "nadine:bow": "recommender.variantSignatureReasons.nadine_bow",
  "isol:pistol": "recommender.variantSignatureReasons.isol_pistol",
  "magnus:bat": "recommender.variantSignatureReasons.magnus_bat",
  "magnus:hammer": "recommender.variantSignatureReasons.magnus_hammer",
  "markus:axe": "recommender.variantSignatureReasons.markus_axe",
  "markus:hammer": "recommender.variantSignatureReasons.markus_hammer",
  "sho:dagger": "recommender.variantSignatureReasons.sho_dagger",
  "sho:spear": "recommender.variantSignatureReasons.sho_spear",
  "aya:pistol": "recommender.variantSignatureReasons.aya_pistol",
  "aya:sniper_rifle": "recommender.variantSignatureReasons.aya_sniper_rifle",
  "aya:assault_rifle": "recommender.variantSignatureReasons.aya_assault_rifle",
};

function labelList(values) {
  return [...new Set(values.map((value) => tagLabels[value] ? t(tagLabels[value]) : value))].join(", ");
}

function roleLabel(character) {
  return roleNames[character.role] ?? character.role;
}

function damageLabel(character) {
  return damageLabels[character.damage] ? t(damageLabels[character.damage]) : character.damage;
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
  const key = variantSignatureReasons[character.variantId] ?? signatureReasons[character.characterId];
  return key ? t(key) : undefined;
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

function isFrontRole(character) {
  return isTank(character) || character.role === "bruiser";
}

function realtimeStatsFor(character) {
  return dakggRealtimeStatsByVariant[character.variantId];
}

let realtimeDamageReferenceCache;

function realtimeDamageGroup(character) {
  if (isFrontRole(character) || character.role === "assassin") return "front";
  if (isBacklineDealer(character)) return "backline";
  if (isSupport(character)) return "support";
  return "all";
}

function buildRealtimeDamageReferences() {
  const groups = {
    all: [],
    front: [],
    backline: [],
    support: [],
  };

  characterVariants.forEach((variant) => {
    const stats = realtimeStatsFor(variant);
    if (!stats?.damage) return;
    groups.all.push(stats.damage);
    groups[realtimeDamageGroup(variant)]?.push(stats.damage);
  });

  return Object.fromEntries(
    Object.entries(groups).map(([group, values]) => [
      group,
      values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : realtimeStatAverages.damage,
    ]),
  );
}

function realtimeDamageReference(character) {
  realtimeDamageReferenceCache ??= buildRealtimeDamageReferences();
  return realtimeDamageReferenceCache[realtimeDamageGroup(character)] ?? realtimeStatAverages.damage;
}

function realtimeDamageBucket(character) {
  const stats = realtimeStatsFor(character);
  if (!stats?.damage) return undefined;
  const reference = realtimeDamageReference(character);
  if (stats.damage >= reference * 1.08) return "high";
  if (stats.damage <= reference * 0.86) return "low";
  return "medium";
}

function isHighDamageFront(character) {
  return isFrontRole(character) && (character.frontDamage === "high" || realtimeDamageBucket(character) === "high");
}

function isLowDamageFront(character) {
  return isFrontRole(character) && (character.frontDamage === "low" || realtimeDamageBucket(character) === "low");
}

function isHighDamageBackline(character) {
  return isBacklineDealer(character) && (character.backlineDamage === "high" || realtimeDamageBucket(character) === "high");
}

function isLowDamageBackline(character) {
  return isBacklineDealer(character) && (character.backlineDamage === "low" || realtimeDamageBucket(character) === "low");
}

function isHighDamageContributor(character) {
  return isHighDamageFront(character) || isHighDamageBackline(character) || character.role === "assassin";
}

function isLowDamageContributor(character) {
  return isLowDamageFront(character) || isLowDamageBackline(character) || isSupport(character);
}

function isDamageLeaningTank(character) {
  return (
    isTank(character) &&
    (character.frontDamage === "high" ||
      character.damage === "hybrid" ||
      character.tags.includes("burst") ||
      character.tags.includes("sustained"))
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

function isPrimaryEngage(character) {
  return (
    isFirstEngageStyle(character) ||
    character.tags.includes("initiate") ||
    (character.role === "frontline" && !isGuardOnly(character)) ||
    (ccPower(character) >= 2.4 && !isCounterOnlyRanged(character) && !isGuardOnly(character)) ||
    lateButCanStartIds.has(character.characterId)
  );
}

function isLongPokeCharacter(character) {
  return isCounterOnlyRanged(character) || isPokeThenEngage(character) || (
    character.tags.includes("poke") ||
    character.tags.includes("zone") ||
    character.tags.includes("range")
  ) && !character.tags.includes("dive");
}

function teamShape(team) {
  return {
    tanks: team.filter(isTank).length,
    melee: team.filter(isMeleeDealer).length,
    backline: team.filter(isBacklineDealer).length,
    supports: team.filter(isSupport).length,
    reliableDps: team.filter(isReliableDps).length,
    damageTanks: team.filter(isDamageLeaningTank).length,
    highDamageFronts: team.filter(isHighDamageFront).length,
    lowDamageFronts: team.filter(isLowDamageFront).length,
    highDamageBacklines: team.filter(isHighDamageBackline).length,
    lowDamageBacklines: team.filter(isLowDamageBackline).length,
    highDamageContributors: team.filter(isHighDamageContributor).length,
    lowDamageContributors: team.filter(isLowDamageContributor).length,
    longRangeCarries: team.filter(isLongRangeCarry).length,
    sustainedCarries: team.filter(isSustainedCarry).length,
    diveFollowUps: team.filter(isDiveFollowUp).length,
    firstEngagers: team.filter(isFirstEngageStyle).length,
    delayedEngagers: team.filter(isDelayedEngageStyle).length,
    cannotStarters: team.filter(cannotStartEngage).length,
    rangedEngageHelpers: team.filter(helpsMeleeEngage).length,
    diveFollowRanged: team.filter(likesDiveFollow).length,
    counterOnlyRanged: team.filter(isCounterOnlyRanged).length,
    pokeThenEngage: team.filter(isPokeThenEngage).length,
    guardOnly: team.filter(isGuardOnly).length,
    guardSometimesEngage: team.filter(isGuardSometimesEngage).length,
  };
}

function teamShapeLabel(shape) {
  if (shape.tanks === 1 && shape.backline === 2 && shape.melee === 0 && shape.supports === 0) return "1탱 2원";
  if (shape.tanks === 0 && shape.melee === 1 && shape.backline === 2 && shape.supports === 0) return "1근 2원";
  if (shape.tanks === 0 && shape.melee === 2 && shape.backline === 1 && shape.supports === 0) return "2근 1원";
  if (shape.tanks === 0 && shape.melee === 2 && shape.supports === 1 && shape.backline === 0) return "2근 1서포터";
  if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1 && shape.supports === 0) return "1탱 1근 1원";
  if (shape.backline === 3 && shape.tanks === 0 && shape.melee === 0) return "3원";
  if (shape.melee + shape.tanks === 3 && shape.backline === 0 && shape.supports === 0) return "3근";
  if (shape.tanks >= 1 && shape.supports >= 1) return "탱커+서포터";
  if (shape.tanks >= 2) return "투탱";
  return `${shape.tanks}탱 ${shape.melee}근 ${shape.backline}원${shape.supports ? ` ${shape.supports}서포터` : ""}`;
}

function teamFeatureSummary(team, candidate) {
  const shape = teamShape(team);
  const { total, average } = teamMetricProfile(team);
  if (shape.backline === 3 && total.damage >= 11 && (total.crowdControl >= 8 || total.utility >= 7)) {
    return `${objectName(candidate)} 넣으면 후방 화력이 세 명으로 늘고, CC/보조 지표가 받쳐줘 대치전 중심 운영이 가능합니다.`;
  }
  if (shape.backline === 0 && shape.melee + shape.tanks === 3 && total.damage >= 10 && total.crowdControl >= 8 && average.mobility >= 3.0) {
    return `${objectName(candidate)} 넣으면 근접 압박이 강해지고, 이니시와 CC로 짧은 교전을 빠르게 열 수 있습니다.`;
  }
  if (shape.tanks >= 1 && shape.backline >= 1) {
    return `${objectName(candidate)} 넣으면 앞에서 버티는 자리와 뒤에서 마무리하는 화력이 함께 생깁니다.`;
  }
  if (shape.melee >= 2 && shape.backline >= 1) {
    return `${objectName(candidate)} 넣으면 진입 압박과 후방 마무리 화력이 함께 갖춰집니다.`;
  }
  if (shape.supports >= 1 && shape.melee >= 2) {
    return `${objectName(candidate)} 넣으면 근접 교전에 보조 능력이 더해져 한 번 들어간 싸움을 오래 이어갈 수 있습니다.`;
  }
  return `${objectName(candidate)} 넣으면 화력, CC, 기동 지표가 현재 팀원과 비교적 잘 맞습니다.`;
}

function teamShapeScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;

  const shape = teamShape(team);
  const { total, average } = teamMetricProfile(team);
  const hasInitiator = team.some((character) => character.tags.includes("initiate")) || teamCcPower(team) >= 3.0;
  const hasPeel = team.some((character) => character.tags.includes("peel") || character.tags.includes("shield") || character.tags.includes("healing"));
  let score = 0;

  if (shape.reliableDps < 2) score -= 2.4;
  if (shape.tanks >= 2 && total.damage < 10) score -= 1.8;
  if (shape.tanks >= 1 && shape.supports >= 1) score -= shape.reliableDps >= 2 && total.damage >= 10 ? 0.55 : 2.4;
  if (shape.supports >= 1 && shape.reliableDps >= 2 && total.damage >= 10 && (total.crowdControl >= 7 || total.utility >= 8)) score += 0.75;
  if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) {
    const tank = team.find(isTank);
    if (isHighDamageFront(tank)) score -= 0.35;
    else if (isDamageLeaningTank(tank)) score -= 0.85;
    else if (isLowDamageFront(tank)) score -= 3.2;
    else score -= 2.2;
  }

  if (shape.tanks === 1 && shape.backline === 2 && shape.supports === 0) {
    const tank = team.find(isTank);
    score += isLowDamageFront(tank) ? 1.2 : 1.45;
  }
  if (shape.tanks === 0 && shape.melee === 2 && shape.backline === 1) score += 1.25;
  if (shape.tanks === 0 && shape.melee === 2 && shape.supports === 1) score += 1.1;

  if (shape.backline === 3 && shape.tanks === 0 && shape.melee === 0) {
    if (total.damage >= 11 && (total.crowdControl >= 8 || total.utility >= 7 || hasPeel)) score += 1.15;
    else if (shape.rangedEngageHelpers >= 1 && total.damage >= 10 && teamCcPower(team) >= 2.0) score += 0.45;
    else if (shape.diveFollowRanged >= 1 && shape.pokeThenEngage + shape.counterOnlyRanged >= 1 && total.damage >= 10) score += 0.25;
    else score -= 0.75;
  }

  if (shape.backline === 0 && shape.supports === 0 && shape.tanks + shape.melee === 3) {
    if (total.damage >= 10 && total.crowdControl >= 8 && (hasInitiator || average.mobility >= 3.2)) score += 1.05;
    else if (shape.firstEngagers >= 1 && shape.delayedEngagers + shape.cannotStarters >= 1 && total.damage >= 10) score += 0.35;
    else score -= 0.75;
  }

  if (hasInitiator && shape.diveFollowUps >= 2) score += 0.9;
  if (shape.longRangeCarries >= 1 && shape.sustainedCarries >= 1 && (hasPeel || teamCcPower(team) >= 2.4)) score += 0.85;
  if (shape.longRangeCarries >= 2 && !hasPeel && teamCcPower(team) < 2.0) score -= 0.7;
  if (shape.sustainedCarries >= 2 && teamCcPower(team) < 1.6) score -= 0.6;

  // ── speedBoost 서포터: 팀 평균 사거리 점수가 낮을수록 이동속도 이득이 커짐 ──
  if (candidate.tags.includes("speedBoost") && isSupport(candidate) && selected.length >= 1) {
    const avgRange = selected.reduce((s, c) => s + (c.roleProfile?.range ?? 1), 0) / selected.length;
    const hasFront = selected.some((c) => c.role === "frontline" || c.role === "bruiser");
    if (hasFront) {
      if (avgRange < 2.0) score += 1.3;       // 전원 근접: 최대 이득
      else if (avgRange < 2.8) score += 0.7;  // 주로 근접
      else if (avgRange < 3.5) score += 0.2;  // 혼합
    }
  }

  // ── hyperCarry 암살자: 팀 이니시 강도 + CC 수치에 따라 가치가 선형 변동 ──
  if (candidate.tags.includes("hyperCarry") && selected.length >= 1) {
    const selectedCC = teamCcPower(selected);
    const teamInitiate = selected.reduce((s, c) => s + (c.roleProfile?.initiate ?? 0), 0);
    const setupScore = teamInitiate + selectedCC * 0.5;
    const hasFront = selected.some((c) => c.role === "frontline" || c.role === "bruiser");
    if (hasFront) {
      if (setupScore >= 5.0) score += 1.4;
      else if (setupScore >= 3.0) score += 0.8;
      else if (setupScore >= 1.5) score += 0.1;
      else score -= 0.8;
    } else {
      score -= 1.1;
    }
  }

  // ── 낮은 이니시 암살자 (initiateStrength ≤ 1): 팀 셋업 없을 때 경미한 패널티 ──
  if (candidate.role === "assassin" && !candidate.tags.includes("hyperCarry") && selected.length >= 1) {
    const selfInitiate = candidate.roleProfile?.initiate ?? 0;
    if (selfInitiate <= 1) {
      const teamInitiate = selected.reduce((s, c) => s + (c.roleProfile?.initiate ?? 0), 0);
      const setupScore = teamInitiate + teamCcPower(selected) * 0.5;
      if (setupScore < 1.5) score -= 0.7;
      else if (setupScore >= 4.0) score += 0.5;
    }
  }

  return Math.max(-5.4, Math.min(3.0, score));
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
  if (selected.length >= 2 && isTank(candidate) && hasMeleeDealer && hasBacklineDealer) return -0.8;
  if (selected.length >= 2 && isSupport(candidate) && hasTank) return -1.4;
  if (!roles.includes("frontline") && ["frontline", "bruiser"].includes(candidate.role)) return 1.35;
  if (!roles.includes("ranged") && ["ranged", "mage"].includes(candidate.role)) return 1.0;
  if (!roles.includes("support") && candidate.role === "support") return 0.6;
  if (roles.includes(candidate.role)) return -0.25;
  return 0.35;
}

function frontDamageScore(candidate, selected) {
  if (!isFrontRole(candidate) || selected.length === 0) return 0;

  const team = [...selected, candidate];
  const shape = teamShape(team);
  let score = 0;

  if (isHighDamageFront(candidate)) {
    if (shape.reliableDps < 2) score += 0.75;
    if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) score += isTank(candidate) ? 0.85 : 0.45;
    if (shape.tanks === 0 && shape.melee === 2 && shape.backline === 1) score += 0.35;
  }

  if (isLowDamageFront(candidate)) {
    if (shape.reliableDps < 2) score -= 1.1;
    if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) score -= 0.75;
    if (shape.tanks >= 1 && shape.supports >= 1) score -= 0.45;
  }

  return Math.max(-1.6, Math.min(1.4, score));
}

function backlineDamageScore(candidate, selected) {
  if (!isBacklineDealer(candidate) || selected.length === 0) return 0;

  const team = [...selected, candidate];
  const shape = teamShape(team);
  const selectedBacklines = selected.filter(isBacklineDealer).length;
  const selectedReliableDps = selected.filter(isReliableDps).length;
  let score = 0;

  if (isHighDamageBackline(candidate)) {
    if (selectedReliableDps < 2) score += 0.9;
    if (selectedBacklines === 0) score += 0.55;
    if (shape.tanks >= 1 || shape.melee >= 1) score += 0.35;
    if (candidate.damage === "basic") score += 0.18;
  }

  if (isLowDamageBackline(candidate)) {
    if (selectedReliableDps < 2) score -= 1.0;
    if (selectedBacklines === 0) score -= 0.45;
    if (shape.tanks >= 1 && shape.supports >= 1) score -= 0.35;
  }

  return Math.max(-1.5, Math.min(1.6, score));
}

function teamDamageBudgetScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;

  const shape = teamShape(team);
  let score = 0;

  if (shape.highDamageContributors === 0) score -= 2.4;
  if (shape.highDamageContributors === 1 && shape.lowDamageContributors >= 2) score -= 1.15;
  if (shape.lowDamageContributors >= 3) score -= 2.0;
  if (shape.reliableDps < 2 && shape.highDamageContributors <= 1) score -= 1.0;

  if (shape.highDamageContributors >= 2 && shape.lowDamageContributors <= 1) score += 0.6;
  if (shape.highDamageContributors >= 1 && shape.reliableDps >= 2 && shape.lowDamageContributors <= 1) score += 0.35;
  score += teamRealtimeDamageScore(team);

  return clamp(score, -3.4, 1.25);
}

function teamRealtimeDamageScore(team) {
  const measured = team
    .map((character) => realtimeStatsFor(character)?.damage)
    .filter((damage) => Number.isFinite(damage));
  if (measured.length < 2) return 0;

  const expected = team
    .filter((character) => realtimeStatsFor(character)?.damage)
    .reduce((sum, character) => sum + realtimeDamageReference(character), 0);
  if (!expected) return 0;

  const ratio = measured.reduce((sum, damage) => sum + damage, 0) / expected;
  if (ratio >= 1.12) return 0.55;
  if (ratio >= 1.05) return 0.25;
  if (ratio <= 0.78) return -1.15;
  if (ratio <= 0.88) return -0.65;
  if (ratio <= 0.94) return -0.3;
  return 0;
}

function metricBalanceScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;

  const { total, average } = teamMetricProfile(team);
  let score = 0;

  if (total.damage <= 8) score -= 1.2;
  else if (total.damage >= 11) score += 0.55;

  if (total.defense <= 6 && average.mobility < 3.4) score -= 0.75;
  else if (total.defense >= 9) score += 0.35;

  if (total.crowdControl <= 5) score -= 0.65;
  else if (total.crowdControl >= 9) score += 0.5;

  if (average.mobility >= 3.7 && total.crowdControl >= 7) score += 0.35;
  if (total.utility >= 8 && total.damage >= 9) score += 0.25;
  if (total.utility >= 8 && total.damage <= 8) score -= 0.35;

  return Math.max(-1.6, Math.min(1.25, score));
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
  const { total, average } = teamMetricProfile(nextTeam);
  let penalty = 0;

  const frontlineCount = roles.filter((role) => role === "frontline" || role === "bruiser").length;
  const rangedCount = roles.filter((role) => role === "ranged" || role === "mage").length;
  const supportCount = roles.filter((role) => role === "support").length;
  const assassinCount = roles.filter((role) => role === "assassin").length;

  if (frontlineCount === 0 && total.defense <= 6 && totalCc < 2.2) penalty -= 1.4;
  if (rangedCount === 0 && total.damage < 10 && totalCc < 3.0) penalty -= 1.0;
  if (supportCount >= 2) penalty -= 1.2;
  if (assassinCount >= 2 && frontlineCount === 0 && totalCc < 2.5) penalty -= 1.0;
  if (ranges.every((range) => range === "melee") && !(total.damage >= 10 && totalCc >= 8 && average.mobility >= 3.0)) penalty -= 0.55;
  if (ranges.every((range) => range === "ranged") && !(total.damage >= 11 && (totalCc >= 8 || total.utility >= 7))) penalty -= 0.45;
  if (!tags.has("initiate") && !tags.has("cc") && totalCc < 4.5) penalty -= 0.8;
  if (totalCc < 1.2) penalty -= 0.65;
  if (!tags.has("focus") && !tags.has("burst") && total.damage < 10) penalty -= 0.55;

  return penalty;
}

function compositionGuideScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;

  const shape = teamShape(team);
  const { total } = teamMetricProfile(team);
  const hasLenox = team.some((character) => counterEngageAnchorIds.has(character.characterId));
  const hasSupport = team.some(isSupport);
  const hasPrimaryEngage = team.some(isPrimaryEngage);
  const hasMeleeEngageHelper = team.some((character) => meleeEngageHelperIds.has(character.characterId) || helpsMeleeEngage(character));
  const hasDiveTeam = team.filter((character) => character.tags.includes("dive") || isMeleeDealer(character)).length >= 2;
  const hasFirstEngager = shape.firstEngagers > 0;
  const hasHardDiveDirection = hasFirstEngager && (shape.melee >= 1 || shape.cannotStarters >= 1 || shape.delayedEngagers >= 1);
  let score = 0;

  if (hasLenox) {
    if (shape.backline >= 2 && shape.melee === 0) score += 1.05;
    if (shape.melee >= 1) score -= 1.85;
  }

  if (shape.guardOnly >= 1 && shape.melee >= 1) score -= 1.15;
  if (shape.guardOnly >= 1 && shape.backline >= 2 && shape.counterOnlyRanged + shape.pokeThenEngage + shape.rangedEngageHelpers >= 1) score += 0.55;

  if (hasSupport) {
    if (shape.highDamageContributors >= 2 || total.damage >= 11) score += 0.65;
    if (shape.lowDamageContributors >= 2 || total.damage <= 8) score -= 1.75;
  }

  if (!hasPrimaryEngage && (needsEngageHelpIds.has(candidate.characterId) || cannotStartEngage(candidate))) score -= 1.75;
  if (!hasPrimaryEngage && team.some((character) => needsEngageHelpIds.has(character.characterId) || cannotStartEngage(character))) score -= 0.95;
  if (!hasFirstEngager && shape.delayedEngagers >= 2) score -= 0.75;
  if (hasFirstEngager && shape.delayedEngagers >= 1) score += 0.25;

  if (shape.tanks === 1 && shape.melee === 2 && shape.backline === 0) {
    const tank = team.find(isTank);
    if (tank && !counterEngageAnchorIds.has(tank.characterId) && isPrimaryEngage(tank)) score += 0.85;
  }

  if (teamCcPower(team) < 1.2) score -= 1.2;
  if (hasHardDiveDirection && shape.counterOnlyRanged >= 1 && !hasSupport && !hasMeleeEngageHelper) score -= 1.15;
  if (hasHardDiveDirection && shape.pokeThenEngage >= 1 && !hasMeleeEngageHelper) score -= 0.35;
  if (hasDiveTeam && isLongPokeCharacter(candidate) && !hasSupport && !hasMeleeEngageHelper && !likesDiveFollow(candidate)) score -= 0.75;
  if (hasDiveTeam && hasMeleeEngageHelper) score += 0.7;
  if (hasHardDiveDirection && shape.diveFollowRanged >= 1) score += 0.45;
  if (shape.rangedEngageHelpers >= 1 && shape.melee >= 1) score += 0.55;
  if (shape.backline >= 3 && shape.firstEngagers === 0 && shape.counterOnlyRanged + shape.pokeThenEngage + shape.rangedEngageHelpers >= 2 && teamCcPower(team) >= 2.0) score += 0.55;
  if (lateEngageIds.has(candidate.characterId) && hasDiveTeam && !hasSupport) score -= 0.45;

  return Math.max(-4.0, Math.min(2.2, score));
}

function dakCompositionScore(candidate, selected) {
  if (selected.length === 0 || rankerCompositionStats.length === 0) return 0;

  const selectedCharacters = new Set(selected.map((character) => character.characterId));
  const rows = _rankerCompositionByCandidate.get(candidate.characterId);
  if (!rows || rows.length === 0) return 0;

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

function tournamentResultScore(row) {
  const placement = (4.5 - (row.rank ?? 4.5)) / 3.5;
  const teamScore = Math.min(1, (row.ts ?? 0) / 22);
  const killScore = Math.min(1, (row.ks ?? 0) / 14);
  return Math.max(-1.15, Math.min(1.35, placement * 0.78 + teamScore * 0.32 + killScore * 0.28));
}

function tournamentCompositionScore(candidate, selected) {
  if (selected.length === 0 || tournamentCompositions.length === 0) return 0;

  const candidateId = candidate.characterId;
  const selectedIds = selected.map((character) => character.characterId);
  const selectedSet = new Set(selectedIds);
  const rows = _tournamentCompositionByCandidate.get(candidateId);
  if (!rows || rows.length === 0) return 0;

  const aggregate = rows.reduce((state, row) => {
    const members = new Set(row.members);
    const matchedSelected = selectedIds.filter((id) => members.has(id)).length;
    if (matchedSelected === 0) return state;

    const completesExactTeam = selected.length >= 2 && selectedIds.every((id) => members.has(id));
    const pairOnly = selected.length === 1 && members.has(selectedIds[0]);
    const repeatWeight = Math.min(1.35, Math.log2((row.appearances ?? 1) + 1));
    const matchWeight = completesExactTeam ? 2.75 : pairOnly ? 0.72 : 0.9;
    const score = tournamentResultScore(row) * matchWeight * repeatWeight;

    state.score += score;
    state.weight += matchWeight;
    state.exact += completesExactTeam ? 1 : 0;
    state.exactScore += completesExactTeam ? Math.max(0.2, tournamentResultScore(row)) : 0;
    return state;
  }, { score: 0, weight: 0, exact: 0, exactScore: 0 });

  if (aggregate.weight === 0) return 0;
  const cap = aggregate.exact > 0 ? 2.6 : 0.85;
  const exactCompletionBonus = aggregate.exact > 0 ? Math.min(10, aggregate.exact * 5 + aggregate.exactScore * 3) : 0;
  return Math.max(-1.0, Math.min(cap + exactCompletionBonus, aggregate.score / aggregate.weight + exactCompletionBonus));
}

function characterByCharacterId(characterId) {
  return characterVariants.find((character) => character.characterId === characterId);
}

function metricSimilarityScore(team, referenceTeam) {
  const teamAverage = teamMetricProfile(team).average;
  const referenceAverage = teamMetricProfile(referenceTeam).average;
  const fields = ["damage", "defense", "crowdControl", "mobility", "utility"];
  const distance = fields.reduce((sum, field) => sum + Math.abs((teamAverage[field] ?? 0) - (referenceAverage[field] ?? 0)), 0);
  return Math.max(0, 1 - distance / 7.5);
}

function tournamentArchetypeScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3 || tournamentCompositions.length === 0) return 0;

  const aggregate = _tournamentCompositionTeams.reduce((state, { row, team: referenceTeam, memberSet }) => {
    if (referenceTeam.length < 3) return state;

    const overlap = team.reduce((n, c) => n + (memberSet.has(c.characterId) ? 1 : 0), 0);
    const similarity = metricSimilarityScore(team, referenceTeam);
    if (similarity < 0.72 && overlap === 0) return state;

    const result = tournamentResultScore(row);
    const overlapWeight = overlap >= 2 ? 1.0 : overlap === 1 ? 0.45 : 0.22;
    const weight = similarity * overlapWeight;
    state.score += result * weight;
    state.weight += weight;
    state.bestSimilarity = Math.max(state.bestSimilarity, similarity);
    return state;
  }, { score: 0, weight: 0, bestSimilarity: 0 });

  if (aggregate.weight === 0) return 0;
  const raw = (aggregate.score / aggregate.weight) * Math.min(1, aggregate.bestSimilarity + 0.08);
  return Math.max(-0.8, Math.min(1.15, raw * 0.9));
}

function dakTierScore(candidate, tier) {
  const bucket = statsBucketForTier(tier);
  const tierLabel = experimentTiers[bucket]?.[candidate.characterId] ?? experimentTiers.all?.[candidate.characterId];
  const tierScore = tierScoreWeights[tierLabel] ?? 0;
  const broadRanker = rankerCandidateStats[candidate.characterId];
  const broadRankerScore = broadRanker ? placementScore(broadRanker) * oneTrickWeight(broadRanker.oneTrickRatio) * 0.35 : 0;
  return tierScore + broadRankerScore;
}

function dakStatisticsScore(candidate, tier) {
  const bucket = statsBucketForTier(tier);
  const stats = statisticsPerformance?.[bucket]?.[candidate.characterId] ?? statisticsPerformance?.all?.[candidate.characterId];
  if (!stats) return 0;

  const confidence = Math.min(1, Math.log10((stats.games ?? 0) + 1) / 2.5);
  return Math.max(-1.25, Math.min(1.35, placementScore(stats) * confidence * 0.85));
}

function dakRealtimeScore(candidate) {
  const stats = realtimeStatsFor(candidate);
  if (!stats) return 0;

  const sampleConfidence = clamp(Math.log10((stats.pickCount ?? 0) + 1) / 4, 0.35, 1);
  const damageReference = realtimeDamageReference(candidate);
  const damageScore = damageReference ? clamp((stats.damage / damageReference - 1) * 1.1, -0.55, 0.65) : 0;
  const tierScore = ({ S: 0.42, A: 0.24, B: 0.03, C: -0.18, D: -0.38 })[stats.tier] ?? 0;
  const raw =
    (stats.winRate - realtimeStatAverages.winRate) * 0.08 +
    (stats.top3Rate - realtimeStatAverages.top3Rate) * 0.045 +
    (realtimeStatAverages.averageRank - stats.averageRank) * 0.55 +
    (stats.averageTK - realtimeStatAverages.averageTK) * 0.2 +
    damageScore +
    tierScore;

  return clamp(raw * sampleConfidence, -1.2, 1.35);
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

function candidateSpecificPenaltyReasons(candidate, selected, scores) {
  const team = [...selected, candidate];
  const selectedShape = teamShape(selected);
  const nextShape = teamShape(team);
  const reasons = [];
  const selectedHasFirstEngage = selected.some(isPrimaryEngage);
  const selectedHasDiveDirection =
    selected.some(isFirstEngageStyle) ||
    selected.filter((character) => character.tags.includes("dive") || isMeleeDealer(character)).length >= 1;

  if (scores.compositionGuide <= -0.75) {
    if (isGuardOnly(candidate) && selectedShape.melee >= 1) {
      reasons.push(`${subjectName(candidate)} 먼저 열기보다 받아치는 쪽에 가까워서, 현재 근접 진입 조합에 넣으면 교전 방향이 갈릴 수 있습니다.`);
    } else if (cannotStartEngage(candidate) && !selectedHasFirstEngage) {
      reasons.push(`${subjectName(candidate)} 들어가면 강하지만 먼저 교전을 열기 어렵습니다. 현재 팀에 먼저 박아줄 실험체가 없어 진입 각이 잘 나오지 않습니다.`);
    } else if (isCounterOnlyRanged(candidate) && selectedHasDiveDirection && !selected.some(helpsMeleeEngage)) {
      reasons.push(`${subjectName(candidate)} 받아치기와 대치에 강한 픽이라, 팀원이 먼저 들어가는 조합에서는 호흡이 늦어질 수 있습니다.`);
    } else if (isPokeThenEngage(candidate) && selectedShape.melee >= 2) {
      reasons.push(`${subjectName(candidate)} 대치로 체력을 깎은 뒤 들어가는 쪽이 좋아서, 바로 박는 근접 조합과는 템포가 어긋날 수 있습니다.`);
    } else if (isSupport(candidate) && teamMetricProfile(team).total.damage <= 8) {
      reasons.push(`${subjectName(candidate)} 보호와 보조 성향이 강합니다. 현재 조합은 마무리 화력이 부족해서 서포터를 더하면 상대를 잡기 어려워질 수 있습니다.`);
    }
  }

  if (scores.frontDamage <= -0.6 && isLowDamageFront(candidate)) {
    const damageText = candidate.frontAverageDamage ? ` 평균 딜량 ${candidate.frontAverageDamage.toLocaleString("ko-KR")} 기준으로` : "";
    reasons.push(`${subjectName(candidate)} DAK.GG 탱커 지표${damageText} 데미지 기여가 낮은 편입니다. 현재 팀처럼 화력이 필요한 상황에서는 앞라인은 서도 킬 압박을 보태기 어렵습니다.`);
  }

  if (scores.backlineDamage <= -0.65 && isLowDamageBackline(candidate)) {
    reasons.push(`${subjectName(candidate)} 딜보다 견제/유틸 성향이 강한 편입니다. 현재 팀이 마무리 화력이 필요한 상태라면 우선순위가 낮아집니다.`);
  }

  if (scores.teamDamageBudget <= -1.4 && isLowDamageContributor(candidate)) {
    reasons.push(`${objectName(candidate)} 넣으면 팀 전체 화력이 더 부족해질 수 있습니다. 이미 딜 기여가 낮은 픽이 있어, 이 후보는 부족한 데미지를 해결하지 못합니다.`);
  }

  if (scores.weaponBalance <= -0.5 && candidate.tags.includes("short_range_dealer") && !selected.some(isPrimaryEngage)) {
    reasons.push(`${subjectName(candidate)} 짧은 거리에서 강한 픽이라 앞에서 각을 만들어줄 팀원이 필요합니다. 현재 조합에서는 딜을 넣기 전에 물릴 위험이 큽니다.`);
  }

  if (nextShape.guardOnly >= 1 && nextShape.melee >= 1 && candidate.characterId !== "lenox") {
    reasons.push(`${subjectName(candidate)} 레녹스의 받아치기 구도와 달리 앞으로 들어가야 힘이 납니다. 레녹스 조합에서는 원거리 딜러 쪽이 더 안정적입니다.`);
  }

  return reasons;
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
  reasons.push(...candidateSpecificPenaltyReasons(candidate, selected, scores));

  if (scores.teamShape <= -2.2) {
    const team = [...selected, candidate];
    const shape = teamShape(team);
    if (shape.tanks >= 1 && shape.supports >= 1) {
      reasons.push(`탱커와 서포터가 함께 들어가면 딜 자리가 부족해지기 쉬워 조합 점수가 크게 낮아집니다.`);
    } else if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) {
      const tank = team.find(isTank);
      if (isDamageLeaningTank(tank)) {
        reasons.push(`1탱 1근 1원 구조지만, ${subjectName(tank)} 데미지 기여가 가능한 탱커라 부족한 화력을 보완할 수 있습니다.`);
      } else {
        reasons.push(`1탱 1근 1원 구조는 근딜이 먼저 점사당하기 쉽고 탱커의 데미지 기여도 부족해 감점되었습니다.`);
      }
    } else if (shape.reliableDps < 2) {
      reasons.push(`현재 형태는 딜러 자리가 부족해 상대를 마무리할 화력이 모자랄 수 있습니다.`);
    }
  }

  if (scores.teamDamageBudget <= -1.4) {
    const shape = teamShape([...selected, candidate]);
    if (shape.highDamageContributors === 0) {
      reasons.push(`세 명 모두 데미지 기여가 부족한 편이라, 교전에서 상대를 마무리할 화력이 모자랄 수 있습니다.`);
    } else {
      reasons.push(`데미지 기여가 부족한 픽이 많이 겹쳐 현재 조합은 킬캐치와 화력 총량이 부족해질 위험이 있습니다.`);
    }
  }

  if (scores.metricBalance >= 0.65) {
    reasons.push(`지표상 ${metricCompositionReason([...selected, candidate])}`);
  }

  if (scores.metricBalance <= -0.75) {
    reasons.push(`지표상 ${metricCompositionReason([...selected, candidate])} 현재 조합에서는 이 약점이 감점으로 반영됩니다.`);
  }

  if (scores.compositionGuide >= 0.75) {
    const team = [...selected, candidate];
    if (team.some((character) => counterEngageAnchorIds.has(character.characterId)) && teamShape(team).backline >= 2) {
      reasons.push("레녹스처럼 받아치는 앞라인이 있을 때는 2원거리 딜러로 대치와 역점사를 보는 구도가 좋습니다.");
    } else if (teamShape(team).tanks === 1 && teamShape(team).melee === 2 && teamShape(team).backline === 0) {
      reasons.push("탱커가 먼저 열고 어그로를 받아줄 수 있어 2근딜이 한 대상을 같이 물기 좋습니다.");
    } else {
      reasons.push("표 기준 운영상 현재 팀원과 교전 템포가 잘 맞는 조합입니다.");
    }
  }

  if (scores.compositionGuide <= -0.75) {
    const team = [...selected, candidate];
    if (team.some((character) => counterEngageAnchorIds.has(character.characterId)) && teamShape(team).melee >= 1) {
      reasons.push("레녹스 조합에 근딜이 섞이면 들어갈 사람과 받아칠 사람이 갈라져 교전 방향이 애매해질 수 있습니다.");
    } else if (team.some(isSupport) && teamMetricProfile(team).total.damage <= 8) {
      reasons.push("서포터가 있는 조합인데 나머지 화력이 부족해 상대를 마무리하기 어려운 구도입니다.");
    } else if (!team.some(isPrimaryEngage) && team.some((character) => needsEngageHelpIds.has(character.characterId))) {
      reasons.push("먼저 박아줄 사람이 없어서 선진입이 어려운 픽이 쉬는 시간이 길어질 수 있습니다.");
    } else if (teamCcPower(team) < 1.2) {
      reasons.push("팀 전체 CC가 거의 없어 상대 진입을 막거나 한 명을 묶어두기 어렵습니다.");
    }
  }

  if (scores.teamShape > -2.2) {
    const team = [...selected, candidate];
    const shape = teamShape(team);
    const tank = team.find(isTank);
    if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1 && isDamageLeaningTank(tank)) {
      reasons.push(`1탱 1근 1원 구조라 기본 효율은 낮지만, ${subjectName(tank)} 데미지 기여가 가능한 탱커라 부족한 화력을 보완할 수 있습니다.`);
    }
  }
  if (scores.teamShape >= 1.4 && scores.teamDamageBudget > -1.0) {
    reasons.push(teamFeatureSummary([...selected, candidate], candidate));
  }
  if (scores.frontDamage >= 0.6 && isHighDamageFront(candidate)) {
    reasons.push(`${subjectName(candidate)} 데미지 기여가 충분한 ${roleLabel(candidate)}라서 앞라인을 세우면서도 부족한 화력을 보탤 수 있습니다.`);
  }

  if (scores.frontDamage <= -0.6 && isLowDamageFront(candidate)) {
    reasons.push(`${subjectName(candidate)} 데미지 기여가 부족한 편이라 현재 조합처럼 딜러 자리가 부족할 때는 감점했습니다.`);
  }

  if (scores.backlineDamage >= 0.65 && isHighDamageBackline(candidate)) {
    reasons.push(`${subjectName(candidate)} 데미지 기여가 충분한 ${damageLabel(candidate)}라서 현재 조합에 부족한 마무리 화력을 채워줍니다.`);
  }

  if (scores.backlineDamage <= -0.65 && isLowDamageBackline(candidate)) {
    reasons.push(`${subjectName(candidate)} 유틸 성향이 강하고 데미지 기여는 부족한 편이라, 딜러 자리가 부족한 조합에서는 감점했습니다.`);
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
  if (scores.tournamentComposition >= 0.8) reasons.push(`대회 데이터에서 현재 팀원과 함께 완성 조합으로 쓰인 기록이 있어 조합 보정이 반영되었습니다.`);
  if (scores.tournamentComposition >= 0.25 && scores.tournamentComposition < 0.8) reasons.push(`대회 데이터에서 현재 팀원과 함께 쓰인 페어 기록이 있어 소폭 가산했습니다.`);
  if (scores.tournamentComposition <= -0.45) reasons.push(`대회 데이터에서 비슷한 조합이 낮은 결과를 낸 기록이 있어 조합 보정에서 감점되었습니다.`);
  if (scores.tournamentArchetype >= 0.45) reasons.push(`선수들이 사용한 상위권 조합과 화력, 방어, CC, 기동 지표 구성이 비슷해 대회 조합 분석 보정이 반영되었습니다.`);
  if (scores.tournamentArchetype <= -0.35) reasons.push(`선수들이 사용한 하위권 조합과 지표 구성이 비슷해 대회 조합 분석에서 감점되었습니다.`);
  if (scores.dakComposition >= 1.1) reasons.push(`랭커 전적에서 ${subjectName(candidate)} 비슷한 팀 조합과 함께 좋은 결과를 낸 기록이 있습니다.`);
  if (scores.dakComposition <= -0.8) reasons.push(`랭커 전적 기준으로 ${subjectName(candidate)} 비슷한 조합에서 하위권을 기록한 사례가 있어 감점되었습니다.`);
  if (scores.dakTier >= 0.8) reasons.push(`${candidate.name}의 최근 통계 티어가 높아 현재 메타 기준으로도 선택 가치가 있습니다.`);
  if (scores.dakStatistics >= 0.55) reasons.push(`${candidate.name}의 현재 승률과 TOP3 지표가 좋아 메타 보정 점수가 반영되었습니다.`);
  if (scores.dakStatistics <= -0.45) reasons.push(`${candidate.name}의 현재 승률과 TOP3 지표가 낮아 메타 보정에서 감점되었습니다.`);
  if (scores.dakRealtime >= 0.65) {
    const stats = realtimeStatsFor(candidate);
    reasons.push(`${candidate.weaponLabel} ${candidate.name}의 DAK.GG 평균 지표가 좋습니다. 승률 ${stats.winRate.toFixed(1)}%, TOP3 ${stats.top3Rate.toFixed(1)}%, 평균 딜량 ${stats.damage.toLocaleString("ko-KR")}을 반영했습니다.`);
  }
  if (scores.dakRealtime <= -0.55) {
    const stats = realtimeStatsFor(candidate);
    reasons.push(`${candidate.weaponLabel} ${candidate.name}의 최근 평균 지표가 낮은 편입니다. 승률 ${stats.winRate.toFixed(1)}%, TOP3 ${stats.top3Rate.toFixed(1)}%, 평균 딜량 ${stats.damage.toLocaleString("ko-KR")} 기준으로 감점했습니다.`);
  }
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
    frontDamage: frontDamageScore(candidate, selected),
    backlineDamage: backlineDamageScore(candidate, selected),
    teamDamageBudget: teamDamageBudgetScore(candidate, selected),
    metricBalance: metricBalanceScore(candidate, selected),
    killPressure: killPressureScore(candidate, selected),
    weaponBalance: weaponBalanceScore(candidate, selected),
    teamShape: teamShapeScore(candidate, selected),
    conflict: conflictScore(candidate, selected),
    compositionGuide: compositionGuideScore(candidate, selected),
    dakComposition: dakCompositionScore(candidate, selected),
    tournamentComposition: tournamentCompositionScore(candidate, selected),
    tournamentArchetype: tournamentArchetypeScore(candidate, selected),
    dakTier: dakTierScore(candidate, tier),
    dakStatistics: dakStatisticsScore(candidate, tier),
    dakRealtime: dakRealtimeScore(candidate),
    relationship: relationshipScore(candidate, selected, tier, relationshipRows),
  };
  const total =
    scores.synergy * 1.6 +
    scores.coverage +
    scores.roleBalance +
    scores.frontDamage +
    scores.backlineDamage +
    scores.teamDamageBudget +
    scores.metricBalance +
    scores.killPressure +
    scores.weaponBalance +
    scores.teamShape +
    scores.conflict +
    scores.compositionGuide +
    scores.dakComposition +
    scores.tournamentComposition * 1.25 +
    scores.tournamentArchetype * 1.1 +
    scores.dakTier +
    scores.dakStatistics +
    scores.dakRealtime +
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
  const candidateUsesVariants = candidateCharacterIds?.some((id) => String(id).includes(":")) ?? false;

  return characterVariants
    .filter((candidate) => !selectedCharacters.has(candidate.characterId))
    .filter((candidate) => !candidatePool || candidatePool.has(candidateUsesVariants ? candidate.variantId : candidate.characterId))
    .map((candidate) => evaluateCandidate(selectedIds, candidate.variantId, tier, remoteFeedback, relationshipRows))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
}

// Given a single anchor character (나), returns top complete 3-man compositions.
// Each entry: { teammate1, teammate2, combinedScore }
export function recommendFullTeam(anchorId, tier = "all", remoteFeedback = {}, candidateCharacterIds = undefined, relationshipRows = []) {
  const slot1Results = recommend([anchorId], tier, remoteFeedback, candidateCharacterIds, relationshipRows).slice(0, 8);

  const compositions = [];
  const seen = new Set();

  for (const r1 of slot1Results) {
    const slot2Results = recommend(
      [anchorId, r1.character.variantId],
      tier, remoteFeedback, candidateCharacterIds, relationshipRows
    ).slice(0, 3);

    for (const r2 of slot2Results) {
      const pairKey = [r1.character.characterId, r2.character.characterId].sort().join("+");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      compositions.push({
        teammate1: r1,
        teammate2: r2,
        combinedScore: parseFloat((r1.score + r2.score).toFixed(1)),
      });
    }
  }

  return compositions.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, 7);
}
