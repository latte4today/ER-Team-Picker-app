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
  const key = `recommender.roleNames.${character.role}`;
  const label = t(key);
  return label === key ? (roleNames[character.role] ?? character.role) : label;
}

function characterName(character) {
  const key = `char.${character.characterId ?? character.id}`;
  const label = t(key);
  return label === key ? character.name : label;
}

function weaponLabel(character) {
  const key = `weapon.${character.weapon}`;
  const label = t(key);
  return label === key ? character.weaponLabel : label;
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
  return josa(characterName(character), "은", "는");
}

function objectName(character) {
  return josa(characterName(character), "을", "를");
}

function withName(character) {
  return josa(characterName(character), "과", "와");
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

  if (cc.targeted) parts.push(t("recommender.ccTypes.targeted"));
  if (areaTotal) parts.push(t("recommender.ccTypes.area"));
  if (total > 0 && parts.length === 0) parts.push(t("recommender.ccTypes.basic"));
  if (cc.conditional && parts.length > 0) parts.push(t("recommender.ccTypes.conditional"));

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
    return t("recommender.reason.teamFeatureBackline", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  if (shape.backline === 0 && shape.melee + shape.tanks === 3 && total.damage >= 10 && total.crowdControl >= 8 && average.mobility >= 3.0) {
    return t("recommender.reason.teamFeatureMelee", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  if (shape.tanks >= 1 && shape.backline >= 1) {
    return t("recommender.reason.teamFeatureFrontBack", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  if (shape.melee >= 2 && shape.backline >= 1) {
    return t("recommender.reason.teamFeatureDiveBackline", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  if (shape.supports >= 1 && shape.melee >= 2) {
    return t("recommender.reason.teamFeatureSupportMelee", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  return t("recommender.reason.teamFeatureDefault", { nameObject: objectName(candidate), name: characterName(candidate) });
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
    // 보호형 탱커(필/실드/힐 or 가드 스타일)와 돌격형 탱커(firstEngage only) 구분
    // 매그너스·엘레나 등 다이브형 탱커는 원거리 딜러를 지킬 수 없어 보너스 감소
    const isProtectiveTank = tank && (
      tank.tags.includes("peel") ||
      tank.tags.includes("shield") ||
      tank.tags.includes("healing") ||
      isGuardSometimesEngage(tank) ||
      isGuardOnly(tank)
    );
    if (isLowDamageFront(tank)) score += 1.2;
    else if (isProtectiveTank) score += 1.45;
    else score += 0.75; // 돌격형 탱커 (매그너스, 엘레나 등) — 데미지는 높지만 보호 불가
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

  // 돌격형 탱커(firstEngage, 필·실드 없음)가 백라인 2명과 근접 없는 구성
  // → 탱커가 적진으로 달려들어 자기 팀 원딜을 보호 못 함 (매그너스 등)
  if (shape.tanks === 1 && shape.backline === 2 && shape.melee === 0) {
    const tank = team.find(isTank);
    if (
      tank &&
      isFirstEngageStyle(tank) &&
      !tank.tags.includes("peel") &&
      !tank.tags.includes("shield") &&
      !isGuardSometimesEngage(tank)
    ) {
      score -= 0.75;
    }
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

  // 라우라: 전원 근접(백라인 0) + 기존 팀에 이미 다이브 캐릭터가 있을 때 중복 패널티
  // 팀에 원거리 딜러가 없으면 라우라의 다이브 가치가 희석됨
  if (candidate.characterId === "laura" && shape.backline === 0 && shape.supports === 0 && shape.melee + shape.tanks >= 3) {
    score -= 0.6;
  }

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
    const sampleWeight = Math.min(1.25, Math.log2((row.games ?? 0) + 1) / 4.5);
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
    const repeatWeight = Math.min(1.1, Math.log2((row.appearances ?? 1) + 1));
    const matchWeight = completesExactTeam ? 1.2 : pairOnly ? 0.45 : 0.5;
    const score = tournamentResultScore(row) * matchWeight * repeatWeight;

    state.score += score;
    state.weight += matchWeight;
    state.exact += completesExactTeam ? 1 : 0;
    state.exactScore += completesExactTeam ? Math.max(0.1, tournamentResultScore(row)) : 0;
    return state;
  }, { score: 0, weight: 0, exact: 0, exactScore: 0 });

  if (aggregate.weight === 0) return 0;
  const cap = aggregate.exact > 0 ? 1.1 : 0.55;
  const exactCompletionBonus = aggregate.exact > 0 ? Math.min(1.5, aggregate.exact * 0.6 + aggregate.exactScore * 0.4) : 0;
  return Math.max(-0.5, Math.min(cap + exactCompletionBonus, aggregate.score / aggregate.weight + exactCompletionBonus));
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
  if (!broadRanker) return tierScore;
  const rankerConfidence = Math.min(1, Math.log10((broadRanker.games ?? 0) + 1) / 2.5);
  const broadRankerScore = placementScore(broadRanker) * oneTrickWeight(broadRanker.oneTrickRatio) * rankerConfidence * 0.35;
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
      reasons.push(t("recommender.reason.counterEngagerInMeleeTeam", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    } else if (cannotStartEngage(candidate) && !selectedHasFirstEngage) {
      reasons.push(t("recommender.reason.engagerNoInitiator", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    } else if (isCounterOnlyRanged(candidate) && selectedHasDiveDirection && !selected.some(helpsMeleeEngage)) {
      reasons.push(t("recommender.reason.counterOnlyInEngageTeam", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    } else if (isPokeThenEngage(candidate) && selectedShape.melee >= 2) {
      reasons.push(t("recommender.reason.pokeThenEngageMismatch", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    } else if (isSupport(candidate) && teamMetricProfile(team).total.damage <= 8) {
      reasons.push(t("recommender.reason.supporterLowDamage", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    }
  }

  if (scores.frontDamage <= -0.6 && isLowDamageFront(candidate)) {
    if (candidate.frontAverageDamage) {
      reasons.push(t("recommender.reason.tankLowDamageWithAvg", { nameSubject: subjectName(candidate), name: characterName(candidate), avgDamage: candidate.frontAverageDamage.toLocaleString() }));
    } else {
      reasons.push(t("recommender.reason.tankLowDamage", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    }
  }

  if (scores.backlineDamage <= -0.65 && isLowDamageBackline(candidate)) {
    reasons.push(t("recommender.reason.utilityOverDamage", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  }

  if (scores.teamDamageBudget <= -1.4 && isLowDamageContributor(candidate)) {
    reasons.push(t("recommender.reason.aggravatesDamageLack", { nameObject: objectName(candidate), name: characterName(candidate) }));
  }

  if (scores.weaponBalance <= -0.5 && candidate.tags.includes("short_range_dealer") && !selected.some(isPrimaryEngage)) {
    reasons.push(t("recommender.reason.shortRangeNoSupport", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  }

  if (nextShape.guardOnly >= 1 && nextShape.melee >= 1 && candidate.characterId !== "lenox") {
    reasons.push(t("recommender.reason.engagerInLenoxTeam", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  }

  return reasons;
}

function explain(candidate, selected, scores) {
  const reasons = [];
  const selectedRoles = selected.map((character) => character.role);
  const selectedDamage = selected.map((character) => character.damage);
  const currentTags = new Set(selected.flatMap((character) => character.tags));
  const addedTags = candidate.tags.filter((tag) => requiredTags.includes(tag) && !currentTags.has(tag));
  const job = roleJobs[candidate.role] ? t(roleJobs[candidate.role]) : t("recommender.roleJobs.fallback", { role: roleLabel(candidate) });
  const identityDetail = isBacklineDealer(candidate) ? ` / ${damageLabel(candidate)}` : "";
  const identity = t("recommender.reason.identity", { nameSubject: subjectName(candidate), name: characterName(candidate), weapon: weaponLabel(candidate), role: roleLabel(candidate), detail: identityDetail });
  const signature = signatureReason(candidate);
  reasons.push(...candidateSpecificPenaltyReasons(candidate, selected, scores));

  if (scores.teamShape <= -2.2) {
    const team = [...selected, candidate];
    const shape = teamShape(team);
    if (shape.tanks >= 1 && shape.supports >= 1) {
      reasons.push(t("recommender.reason.tankSupportNoDamage"));
    } else if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1) {
      const tank = team.find(isTank);
      if (isDamageLeaningTank(tank)) {
        reasons.push(t("recommender.reason.tankMeleeRangedDamageTank", { nameSubject: subjectName(tank), name: characterName(tank) }));
      } else {
        reasons.push(t("recommender.reason.tankMeleeRangedLowDamage"));
      }
    } else if (shape.reliableDps < 2) {
      reasons.push(t("recommender.reason.notEnoughDamageDealer"));
    }
  }

  if (scores.teamDamageBudget <= -1.4) {
    const shape = teamShape([...selected, candidate]);
    if (shape.highDamageContributors === 0) {
      reasons.push(t("recommender.reason.allLowDamage"));
    } else {
      reasons.push(t("recommender.reason.tooManyLowDamage"));
    }
  }

  if (scores.metricBalance >= 0.65) {
    reasons.push(t("recommender.reason.metricPositive", { reason: metricCompositionReason([...selected, candidate]) }));
  }

  if (scores.metricBalance <= -0.75) {
    reasons.push(t("recommender.reason.metricNegative", { reason: metricCompositionReason([...selected, candidate]) }));
  }

  if (scores.compositionGuide >= 0.75) {
    const team = [...selected, candidate];
    if (team.some((character) => counterEngageAnchorIds.has(character.characterId)) && teamShape(team).backline >= 2) {
      reasons.push(t("recommender.reason.lenoxDoubleRanged"));
    } else if (teamShape(team).tanks === 1 && teamShape(team).melee === 2 && teamShape(team).backline === 0) {
      reasons.push(t("recommender.reason.tankDoubleMelee"));
    } else {
      reasons.push(t("recommender.reason.tempoMatch"));
    }
  }

  if (scores.compositionGuide <= -0.75) {
    const team = [...selected, candidate];
    if (team.some((character) => counterEngageAnchorIds.has(character.characterId)) && teamShape(team).melee >= 1) {
      reasons.push(t("recommender.reason.lenoxMeleeConflict"));
    } else if (team.some(isSupport) && teamMetricProfile(team).total.damage <= 8) {
      reasons.push(t("recommender.reason.supporterLowTeamDamage"));
    } else if (!team.some(isPrimaryEngage) && team.some((character) => needsEngageHelpIds.has(character.characterId))) {
      reasons.push(t("recommender.reason.noInitiatorForLateEngage"));
    } else if (teamCcPower(team) < 1.2) {
      reasons.push(t("recommender.reason.noTeamCC"));
    }
  }

  if (scores.teamShape > -2.2) {
    const team = [...selected, candidate];
    const shape = teamShape(team);
    const tank = team.find(isTank);
    if (shape.tanks === 1 && shape.melee === 1 && shape.backline === 1 && isDamageLeaningTank(tank)) {
      reasons.push(t("recommender.reason.tankMeleeRangedDamageTankBonus", { nameSubject: subjectName(tank), name: characterName(tank) }));
    }
  }
  if (scores.teamShape >= 1.4 && scores.teamDamageBudget > -1.0) {
    reasons.push(teamFeatureSummary([...selected, candidate], candidate));
  }
  if (scores.frontDamage >= 0.6 && isHighDamageFront(candidate)) {
    reasons.push(t("recommender.reason.tankWithDamage", { nameSubject: subjectName(candidate), name: characterName(candidate), role: roleLabel(candidate) }));
  }

  if (scores.frontDamage <= -0.6 && isLowDamageFront(candidate)) {
    reasons.push(t("recommender.reason.tankLowDamagePenalty", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  }

  if (scores.backlineDamage >= 0.65 && isHighDamageBackline(candidate)) {
    reasons.push(t("recommender.reason.dealerFillsDamage", { nameSubject: subjectName(candidate), name: characterName(candidate), role: damageLabel(candidate) }));
  }

  if (scores.backlineDamage <= -0.65 && isLowDamageBackline(candidate)) {
    reasons.push(t("recommender.reason.utilityLowDamagePenalty", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  }

  if (signature) reasons.push(signature);

  if (scores.roleBalance >= 1.5 && reasons.length < 1) {
    if (["frontline", "bruiser"].includes(candidate.role) && !selectedRoles.includes("frontline")) {
      reasons.push(t("recommender.reason.roleMainDamage", { identity, job }));
    } else if (["ranged", "mage"].includes(candidate.role) && !selectedRoles.includes("ranged") && !selectedRoles.includes("mage")) {
      reasons.push(t("recommender.reason.roleFillsDamage", { identity }));
    } else if (candidate.role === "support") {
      reasons.push(t("recommender.reason.roleSupportStability", { identity }));
    } else {
      reasons.push(t("recommender.reason.roleFillsVacancy", { identity }));
    }
  }

  if (scores.coverage >= 1.8 && addedTags.length > 0) {
    reasons.push(t("recommender.reason.addsFunctionTags", { nameSubject: subjectName(candidate), name: characterName(candidate), tags: labelList(addedTags) }));
  }

  const ccScore = ccCoverageScore(candidate, selected);
  const ccText = ccSummary(candidate);
  if (ccScore >= 0.45 && ccText) {
    reasons.push(t("recommender.reason.addsCC", { nameSubject: subjectName(candidate), name: characterName(candidate), cc: ccText }));
  }

  if (scores.relationship >= 0.7) reasons.push(t("recommender.reason.feedbackPositive", { nameWith: withName(candidate), name: characterName(candidate) }));
  if (scores.relationship <= -0.7) reasons.push(t("recommender.reason.feedbackNegative", { nameWith: withName(candidate), name: characterName(candidate) }));

  if (scores.killPressure > 0 && isBacklineDealer(candidate)) {
    if (candidate.damage === "basic") {
      reasons.push(t("recommender.reason.normalAttackDealer"));
    } else if (candidate.damage === "skill") {
      reasons.push(t("recommender.reason.skillDealer"));
    }
  }

  if (scores.weaponBalance > 0.5) {
    const weaponRangeKey = candidate.tags.includes("short_range_dealer")
      ? "recommender.reason.weaponRangeShort"
      : candidate.weaponRange === "ranged"
        ? "recommender.reason.weaponRangeRanged"
        : "recommender.reason.weaponRangeMelee";
    reasons.push(t(weaponRangeKey, { weapon: weaponLabel(candidate) }));
  }

  if (candidate.tags.includes("short_range_dealer")) {
    const hasFrontline = selectedRoles.some((role) => role === "frontline" || role === "bruiser");
    const hasControl = currentTags.has("cc") || currentTags.has("initiate") || teamCcPower(selected) >= 2.0;
    if (hasFrontline && hasControl) {
      reasons.push(t("recommender.reason.infighterInGoodTeam", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    } else if (selected.length >= 2) {
      reasons.push(t("recommender.reason.infighterNoSupport", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
    }
  }

  if (scores.synergy >= 1.4) reasons.push(t("recommender.reason.synergyHigh", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.tournamentComposition >= 0.8) reasons.push(t("recommender.reason.tournamentComboFull"));
  if (scores.tournamentComposition >= 0.25 && scores.tournamentComposition < 0.8) reasons.push(t("recommender.reason.tournamentComboPair"));
  if (scores.tournamentComposition <= -0.45) reasons.push(t("recommender.reason.tournamentComboNegative"));
  if (scores.tournamentArchetype >= 0.45) reasons.push(t("recommender.reason.tournamentArchetypePositive"));
  if (scores.tournamentArchetype <= -0.35) reasons.push(t("recommender.reason.tournamentArchetypeNegative"));
  if (scores.dakComposition >= 1.1) reasons.push(t("recommender.reason.dakCompositionPositive", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.dakComposition <= -0.8) reasons.push(t("recommender.reason.dakCompositionNegative", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.dakTier >= 0.8) reasons.push(t("recommender.reason.dakTierHigh", { name: characterName(candidate) }));
  if (scores.dakStatistics >= 0.55) reasons.push(t("recommender.reason.dakStatsPositive", { name: characterName(candidate) }));
  if (scores.dakStatistics <= -0.45) reasons.push(t("recommender.reason.dakStatsNegative", { name: characterName(candidate) }));
  if (scores.dakRealtime >= 0.65) {
    const stats = realtimeStatsFor(candidate);
    reasons.push(t("recommender.reason.realtimeStatsPositive", { weapon: weaponLabel(candidate), name: characterName(candidate), winRate: stats.winRate.toFixed(1), top3Rate: stats.top3Rate.toFixed(1), damage: stats.damage.toLocaleString() }));
  }
  if (scores.dakRealtime <= -0.55) {
    const stats = realtimeStatsFor(candidate);
    reasons.push(t("recommender.reason.realtimeStatsNegative", { weapon: weaponLabel(candidate), name: characterName(candidate), winRate: stats.winRate.toFixed(1), top3Rate: stats.top3Rate.toFixed(1), damage: stats.damage.toLocaleString() }));
  }
  if (scores.conflict <= -2) reasons.push(t("recommender.reason.roleConflict", { nameObject: objectName(candidate), name: characterName(candidate) }));
  if (selected.length === 0) reasons.push(t("recommender.reason.firstPickFlexible", { identity, job }));
  if (reasons.length === 0 && candidate.tags.includes("cc")) reasons.push(t("recommender.reason.ccFallback", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (reasons.length === 0 && candidate.tags.includes("sustained")) reasons.push(t("recommender.reason.sustainedFallback", { nameSubject: subjectName(candidate), name: characterName(candidate), role: damageLabel(candidate) }));
  if (reasons.length === 0 && candidate.tags.includes("poke")) reasons.push(t("recommender.reason.pokeFallback", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (reasons.length === 0) reasons.push(t("recommender.reason.genericFallback", { identity }));
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
    scores.tournamentComposition * 0.5 +
    scores.tournamentArchetype * 0.4 +
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
