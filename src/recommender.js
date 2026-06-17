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
import {
  officialCandidateStatsByTier as _bundledCandidateStats,
  officialCompositionStatsByTier as _bundledCompositionStats,
  officialPairStatsByTier as _bundledPairStats,
  officialCombatStatsByTier as _bundledCombatStats,
  officialTraitBuildStatsByTier as _bundledTraitBuildStats,
  officialEmpiricalVectorStatsByTier as _bundledEmpiricalVectorStats,
  OFFICIAL_V2_WEIGHTS as _bundledWeights,
  BAYESIAN_ALPHA as _bundledAlpha,
} from "./officialMatchStats.js";
import { coreRowForVariant, normalizeCoreName, normalizeTraitBuildRows } from "./traitMeta.js";

// Mutable references — can be overridden at runtime via updateOfficialStats()
let officialCandidateStatsByTier  = _bundledCandidateStats;
let officialCompositionStatsByTier = _bundledCompositionStats;
let officialPairStatsByTier       = _bundledPairStats;
let officialCombatStatsByTier     = _bundledCombatStats;
let officialTraitBuildStatsByTier = _bundledTraitBuildStats;
let officialEmpiricalVectorStatsByTier = _bundledEmpiricalVectorStats;
let OFFICIAL_V2_WEIGHTS           = _bundledWeights;
let BAYESIAN_ALPHA                = _bundledAlpha;
let _officialCompositionByTierCandidate = buildOfficialCompositionIndex(officialCompositionStatsByTier);
let _officialTierAverageCache = new Map();

function buildOfficialCompositionIndex(statsByTier = {}) {
  const index = new Map();
  for (const [bucket, rows] of Object.entries(statsByTier ?? {})) {
    const bucketMap = new Map();
    for (const row of rows ?? []) {
      const key = row.candidate;
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key).push(row);
    }
    index.set(bucket, bucketMap);
  }
  return index;
}

function officialStatsBucketForTier(tier = "all") {
  const bucketMap = {
    all: "all",
    iron_gold: "iron_gold",
    iron_bronze: "iron_gold",
    silver_gold: "iron_gold",
    platinum_diamond: "platinum_diamond",
    meteor_mithril: "meteor_mithril",
    demigod_eternity: "demigod_eternity",
    diamond: "platinum_diamond",
    mithril_plus: "meteor_mithril",
  };
  const preferred = bucketMap[tier] ?? tier ?? "all";
  const hasPreferred =
    officialCandidateStatsByTier?.[preferred] ||
    officialCompositionStatsByTier?.[preferred] ||
    officialPairStatsByTier?.[preferred] ||
    officialCombatStatsByTier?.[preferred];
  return hasPreferred ? preferred : "all";
}

/**
 * Override bundled stats with data fetched from remote (officialMatchStats.json).
 * Call this once on app startup after a successful fetch.
 */
export function updateOfficialStats(remote) {
  if (!remote) return;
  if (remote.officialCandidateStatsByTier)  officialCandidateStatsByTier  = remote.officialCandidateStatsByTier;
  if (remote.officialCompositionStatsByTier) officialCompositionStatsByTier = remote.officialCompositionStatsByTier;
  if (remote.officialPairStatsByTier)       officialPairStatsByTier       = remote.officialPairStatsByTier;
  if (remote.officialCombatStatsByTier)     officialCombatStatsByTier     = remote.officialCombatStatsByTier;
  if (remote.officialTraitBuildStatsByTier) officialTraitBuildStatsByTier = remote.officialTraitBuildStatsByTier;
  if (remote.officialEmpiricalVectorStatsByTier) officialEmpiricalVectorStatsByTier = remote.officialEmpiricalVectorStatsByTier;
  if (remote.weights)                       OFFICIAL_V2_WEIGHTS           = remote.weights;
  if (remote.alpha)                         BAYESIAN_ALPHA                = remote.alpha;
  _officialCompositionByTierCandidate = buildOfficialCompositionIndex(officialCompositionStatsByTier);
  _officialTierAverageCache = new Map();
  _coreMetricAverageCache = new Map();
  _effectiveCoreProfileCache = new Map();
  _variantCoreBaselineCache = new Map();
}
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

function isLeni(character) {
  return character?.characterId === "leni";
}

function hasLeniSustainPlan(team) {
  if (!team.some(isLeni)) return false;
  const shape = teamShape(team);
  const { total } = teamMetricProfile(team);
  const hasFrontAnchor = shape.tanks >= 1 || shape.melee >= 1;
  const hasSetup = total.crowdControl >= 6 || teamCcPower(team) >= 2.0 || team.some((character) => (
    character.tags.includes("initiate") ||
    character.tags.includes("cc")
  ));
  const hasUtility = total.utility >= 8 || team.some((character) => (
    isLeni(character) ||
    character.tags.includes("peel") ||
    character.tags.includes("shield")
  ));
  return hasFrontAnchor && hasSetup && hasUtility;
}

function leniSustainRelief(team) {
  if (!hasLeniSustainPlan(team)) return 0;
  const shape = teamShape(team);
  const { total } = teamMetricProfile(team);
  if (shape.lowDamageContributors >= 2 || total.damage <= 9) {
    return shape.reliableDps >= 1 ? 1 : 0.55;
  }
  return 0;
}

function leniFrontballRelief(team) {
  if (!hasLeniSustainPlan(team)) return 0;
  const shape = teamShape(team);
  const { total } = teamMetricProfile(team);
  if (
    shape.backline === 0 &&
    shape.tanks + shape.melee >= 2 &&
    (shape.highDamageContributors <= 1 || total.damage <= 10)
  ) {
    return 1;
  }
  return 0;
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
  if (hasLeniSustainPlan(team)) {
    return t("recommender.reason.teamFeatureLeniSustain", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  if (shape.supports >= 1 && shape.melee >= 2) {
    return t("recommender.reason.teamFeatureSupportMelee", { nameObject: objectName(candidate), name: characterName(candidate) });
  }
  return t("recommender.reason.teamFeatureDefault", { nameObject: objectName(candidate), name: characterName(candidate) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Continuous role representation (연속화 1단계 — 실험 계층)
//
// 목표: 이산 role + 부울 술어를 6축 연속 벡터로 *표현*한다. 이번 단계는 표현 계층만
// 추가하고, 기존 isTank/teamShape/술어는 그대로 둔다. 점수 함수 중 teamShapeScore
// 하나만 플래그로 벡터 버전을 실험 연결한다.
//
// 중요 원칙:
//  - characterVector는 raw character를 직접 해석하지 않는다. 반드시
//    applyCoreRoleProfile()로 만든 effective character를 기반으로 한다.
//  - inferredCoreRoleOverride / applyCoreRoleProfile 로직은 재구현하지 않는다.
//    effective character가 이미 들고 있는 role/frontDamage/backlineDamage/tags 와
//    effectiveCore.profile(= corePlaystyle 결과)을 *읽어* 매핑만 한다.
//  - 교전 타이밍/사거리(코어 무관 고정)는 벡터에 흡수하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

const VECTOR_SCORING_FLAGS = {
  enableCharacterVector: true,
  useVectorTeamShapeScore: true,
  useVectorRoleBalanceScore: true,
  useVectorDamageBalanceScore: true,
  useVectorMetricBalanceScore: true,
  useVectorCompositionGuideScore: true,
  useEmpiricalVectorBlend: true,
  empiricalVectorBlend: 0.70,
  replaceBooleanPredicates: false,
};

const VECTOR_AXES = ["frontline", "damage", "durability", "cc", "support", "tempo"];
const VECTOR_CORE_BLEND = 0.30; // corePlaystyle 혼합 가중치 (역할 시드를 압도하지 않게)

// 역할 시드 벡터 (각 축 0..~1). 튜닝 대상.
const ROLE_SEED_VECTORS = {
  frontline: { frontline: 1.00, damage: 0.20, durability: 0.90, cc: 0.45, support: 0.20, tempo: 0.20 },
  bruiser:   { frontline: 0.85, damage: 0.60, durability: 0.60, cc: 0.35, support: 0.10, tempo: 0.40 },
  assassin:  { frontline: 0.55, damage: 0.85, durability: 0.25, cc: 0.20, support: 0.05, tempo: 0.85 },
  ranged:    { frontline: 0.15, damage: 0.85, durability: 0.20, cc: 0.20, support: 0.10, tempo: 0.30 },
  mage:      { frontline: 0.15, damage: 0.80, durability: 0.20, cc: 0.50, support: 0.15, tempo: 0.30 },
  support:   { frontline: 0.20, damage: 0.25, durability: 0.45, cc: 0.45, support: 0.90, tempo: 0.30 },
};

const DAMAGE_BUCKET_SCALE = { low: 0.65, medium: 1.00, high: 1.30 };

// 태그 → 축 보정 (가산). effective 캐릭터의 tags는 코어 override를 이미 반영함.
const TAG_VECTOR_MODS = {
  focus:     { damage: 0.12 },
  burst:     { damage: 0.12, tempo: 0.05 },
  sustained: { damage: 0.08, durability: 0.05 },
  durable:   { durability: 0.15 },
  sustain:   { durability: 0.10, support: 0.06 },
  peel:      { support: 0.15, durability: 0.06 },
  shield:    { support: 0.14, durability: 0.06 },
  healing:   { support: 0.18 },
  cc:        { cc: 0.15 },
  initiate:  { cc: 0.10, tempo: 0.10, frontline: 0.05 },
  dive:      { tempo: 0.15, frontline: 0.05 },
  mobility:  { tempo: 0.15 },
  range:     { damage: 0.05 },
  utility:   { support: 0.10, cc: 0.05 },
};

function emptyVector() {
  return { frontline: 0, damage: 0, durability: 0, cc: 0, support: 0, tempo: 0 };
}

function empiricalVectorRow(character, core, tier = "all") {
  if (!character || !officialEmpiricalVectorStatsByTier) return undefined;
  const bucket = officialStatsBucketForTier(tier);
  const rows = officialEmpiricalVectorStatsByTier?.[bucket] ?? officialEmpiricalVectorStatsByTier?.all ?? {};
  const coreCodeValue = coreCode(core);
  return (coreCodeValue ? rows[`${character.variantId}#${coreCodeValue}`] : undefined)
    ?? rows[character.variantId];
}

function blendEmpiricalVector(manual, character, core, tier = "all") {
  if (!VECTOR_SCORING_FLAGS.useEmpiricalVectorBlend) return manual;
  const blend = clamp(Number(VECTOR_SCORING_FLAGS.empiricalVectorBlend ?? 0), 0, 1);
  if (blend <= 0) return manual;

  const row = empiricalVectorRow(character, core, tier);
  const empirical = row?.vector ?? row;
  if (!empirical) return manual;

  const out = { ...manual };
  for (const axis of VECTOR_AXES) {
    if (!Number.isFinite(Number(empirical[axis]))) continue;
    out[axis] = clamp(manual[axis] * (1 - blend) + Number(empirical[axis]) * blend, 0, 1.3);
  }
  return out;
}

// 순수 매핑: 이미 effective인 캐릭터(applyCoreRoleProfile 결과)를 6축 벡터로.
// 재적용/재추론 없음 — effective의 role/damage 버킷/tags/effectiveCore.profile만 읽는다.
function characterVectorFromEffective(eff) {
  const seed = ROLE_SEED_VECTORS[eff.role] ?? ROLE_SEED_VECTORS.bruiser;
  const v = { ...seed };

  // 위치(전열/후열)에 맞는 damage 버킷으로 damage 축 스케일.
  const isFrontPositioned = eff.role === "frontline" || eff.role === "bruiser" || eff.role === "assassin";
  const bucket = isFrontPositioned ? eff.frontDamage : eff.backlineDamage;
  v.damage *= DAMAGE_BUCKET_SCALE[bucket] ?? 1;

  // 태그 보정.
  for (const tag of eff.tags ?? []) {
    const mod = TAG_VECTOR_MODS[tag];
    if (!mod) continue;
    for (const [axis, delta] of Object.entries(mod)) v[axis] += delta;
  }

  // 경험적 CC 질량(ccProfile 가중합)을 cc 축에 반영 — 태그보다 신뢰도 높음.
  const ccMass = ccPower(eff); // 대략 0..3
  v.cc = Math.max(v.cc, Math.min(1.0, ccMass * 0.42));

  // 코어 플레이스타일 혼합 (effective가 이미 들고 있음 — 재계산 안 함).
  const cp = eff.effectiveCore?.profile;
  if (cp) {
    v.damage     += (cp.damage     ?? 0) * VECTOR_CORE_BLEND;
    v.durability += (cp.durability ?? 0) * VECTOR_CORE_BLEND;
    v.support    += (cp.support    ?? 0) * VECTOR_CORE_BLEND;
    v.cc         += (cp.cc         ?? 0) * VECTOR_CORE_BLEND;
    v.tempo      += (cp.tempo      ?? 0) * VECTOR_CORE_BLEND;
  }

  for (const axis of VECTOR_AXES) v[axis] = clamp(v[axis], 0, 1.3);
  return blendEmpiricalVector(v, eff, eff.effectiveCore?.core, eff.effectiveTier ?? "all");
}

// 공개 API: raw character + core + tier → effective 적용 후 벡터.
function characterVector(character, core, tier = "all") {
  if (!character) return emptyVector();
  const eff = applyCoreRoleProfile(character, core, tier);
  return characterVectorFromEffective(eff);
}

function aggregateVectors(memberVectors) {
  const sum = emptyVector();
  const max = emptyVector();
  for (const v of memberVectors) {
    for (const axis of VECTOR_AXES) {
      sum[axis] += v[axis];
      if (v[axis] > max[axis]) max[axis] = v[axis];
    }
  }
  const n = memberVectors.length || 1;
  const avg = emptyVector();
  for (const axis of VECTOR_AXES) avg[axis] = sum[axis] / n;
  return { sum, avg, max, members: memberVectors };
}

// 이미 effective인 팀에 대한 집계 (재적용 회피 — 점수 함수 내부에서 사용).
function teamVectorFromEffective(effTeam) {
  return aggregateVectors(effTeam.map(characterVectorFromEffective));
}

// 공개 API: raw team + coreMap + tier → {sum, avg, max, members}.
function teamVector(team, coreMap = {}, tier = "all") {
  return aggregateVectors(team.map((c) => characterVector(c, coreMap?.[c.variantId], tier)));
}

// 실험용 vector 기반 teamShapeScore. legacy의 의도를 연속 질량으로 근사한다
// (정확 재현이 목적이 아니라, 연속화가 추천을 어떻게 바꾸는지 관찰하기 위함).
// 출력 범위는 legacy와 동일하게 [-5.4, 3.0]로 클램프.
function vectorTeamShapeScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;

  const { sum } = teamVectorFromEffective(team);
  const utility = sum.cc + sum.support;
  let score = 0;

  // (1) 딜 충분성. 결핍(→충족) 전환은 보상하되, 이미 충분한 팀에 딜이 더 쌓일 때는
  //     추가 보너스를 saturating(체감 감쇠)시켜 Category ④(딜 축 중복 가점)를 억제한다.
  //     결핍 패널티는 유지 → 진짜 저댐 조합 감지 + Leni+Markus류 구제(전환 보상) 보존.
  if (sum.damage < 1.5) {
    score -= (1.5 - sum.damage) * 2.6;
  } else {
    // 상한 ~0.48, 대부분의 이득이 damage≈1.5~2.0 구간에서 실현되고 그 이상은 거의 평탄.
    score += 0.5 * (1 - Math.exp(-(sum.damage - 1.5) / 0.45));
  }

  // (2) 전열 질량 과다 + 딜 부족 — legacy: 2+탱 저댐 → 패널티.
  if (sum.frontline >= 2.3 && sum.damage < 1.5) score -= 1.5;

  // (3) 전열+서포터인데 딜 얇음 — legacy: 탱+서포터 딜 부족 패널티.
  if (sum.frontline >= 0.9 && sum.support >= 0.7 && sum.damage < 1.6) score -= 1.4;

  // (4) 전/후열 균형 + 유틸 충분 — legacy 양호 조합 보너스.
  if (sum.frontline >= 0.8 && sum.damage >= 1.6 && utility >= 0.9) score += 0.9;

  // (5) 후방 위주 조합은 제어/피어가 있어야 가치 — legacy 3원 분기 근사.
  if (sum.frontline < 0.7) {
    if (utility >= 1.0 && sum.damage >= 1.8) score += 0.5;
    else if (utility < 0.7) score -= 0.6;
  }

  // (6) 다이브/템포 + CC 셋업 시너지.
  if (sum.tempo >= 1.2 && sum.cc >= 0.8) score += 0.4;

  return Math.max(-5.4, Math.min(3.0, score));
}

// vector 점수를 legacy에 섞는 비율. final = legacy + BLEND * (vector - legacy).
// 0 이면 완전 legacy, 1 이면 완전 vector. 우선 0.30(=70% legacy / 30% vector).
const VECTOR_TEAM_SHAPE_BLEND = 0.30;

// 디스패처: 플래그가 꺼져 있으면 legacy 단독. 켜져 있으면 legacy와 vector를 hybrid 블렌딩
// (vector를 100% 대체하지 않고 legacy 대비 편차의 일부만 반영).
function teamShapeScore(candidate, selected) {
  const legacy = legacyTeamShapeScore(candidate, selected);
  if (!(VECTOR_SCORING_FLAGS.enableCharacterVector && VECTOR_SCORING_FLAGS.useVectorTeamShapeScore)) {
    return legacy;
  }
  const vector = vectorTeamShapeScore(candidate, selected);
  return legacy + VECTOR_TEAM_SHAPE_BLEND * (vector - legacy);
}

function legacyTeamShapeScore(candidate, selected) {
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
  score += leniSustainRelief(team) * 1.1 + leniFrontballRelief(team) * 1.35;
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

// ─────────────────────────────────────────────────────────────────────────────
// Full vector scoring experiment (실험 브랜치)
//
// 주요 점수 함수의 vector 기반 실험 버전 + hybrid 디스패처.
//  - legacy 함수는 보존(legacy* 로 개명), 플래그 off 면 legacy 단독.
//  - 디스패처: final = legacy + BLEND * (vector − legacy)   (0.20~0.35)
//  - compositionGuide 만 "보조 적용": final = legacy + AUX_BLEND * aux (가산형).
//  - vector 함수는 teamVector(frontline/damage/durability/cc/support/tempo) 사용.
//  - boolean predicate(isTank 등)는 게이팅 용도로 읽기만 하고 교체하지 않음.
// ─────────────────────────────────────────────────────────────────────────────

const VECTOR_ROLE_BALANCE_BLEND      = 0.25;
const VECTOR_DAMAGE_BALANCE_BLEND    = 0.25; // front/backline 공용
const VECTOR_METRIC_BALANCE_BLEND    = 0.25;
const VECTOR_COMPOSITION_GUIDE_AUX_BLEND = 0.20; // 가산형 보조 가중

// 부족한 축을 채우는 후보를 보상, 과잉 축 중복을 감점.
function vectorRoleBalanceScore(candidate, selected) {
  if (selected.length === 0) return 1;
  const selSum = teamVectorFromEffective(selected).sum;
  const cv = characterVectorFromEffective(candidate);
  let score = 0;
  if (selSum.frontline < 0.8) score += cv.frontline * 1.1;   // 전열 부족 보강
  if (selSum.damage < 1.3)    score += cv.damage * 0.8;      // 딜 부족 보강
  if (selSum.support < 0.4)   score += cv.support * 0.7;     // 유틸 부재 보강
  if (selSum.frontline >= 1.6 && cv.frontline >= 0.8 && cv.damage < 0.5) score -= 0.7; // 전열 과잉
  if (selSum.support >= 0.8 && cv.support >= 0.8) score -= 0.5;                         // 서포터 중복
  if (selSum.damage >= 2.0 && cv.damage >= 0.85 && cv.frontline < 0.3 && cv.support < 0.3) score -= 0.3; // 순딜 포화
  return Math.max(-1.4, Math.min(1.35, score));
}

// 전열 포지션 후보의 딜 기여를 vector damage 축으로 평가 (게이팅은 기존 predicate 유지).
function vectorFrontDamageScore(candidate, selected) {
  if (!isFrontRole(candidate) || selected.length === 0) return 0;
  const cv = characterVectorFromEffective(candidate);
  const selSum = teamVectorFromEffective(selected).sum;
  let score = 0;
  if (cv.damage >= 0.8) {
    if (selSum.damage < 1.3) score += 0.7;          // 딜 부족 팀에 고댐 전열
    score += (cv.damage - 0.8) * 0.6;
  }
  if (cv.damage <= 0.45 && selSum.damage < 1.3) score -= 0.9; // 딜 부족인데 저댐 전열
  return Math.max(-1.6, Math.min(1.4, score));
}

// 후방 딜러 후보의 딜 기여를 vector damage 축으로 평가.
function vectorBacklineDamageScore(candidate, selected) {
  if (!isBacklineDealer(candidate) || selected.length === 0) return 0;
  const cv = characterVectorFromEffective(candidate);
  const selSum = teamVectorFromEffective(selected).sum;
  let score = 0;
  if (cv.damage >= 0.85) {
    if (selSum.damage < 1.3) score += 0.85;          // 딜 부족 팀에 고댐 후방
    if (selSum.frontline >= 0.8) score += 0.3;       // 전열 보유 시 후방 캐리 가치↑
    score += (cv.damage - 0.85) * 0.5;
  }
  if (cv.damage <= 0.5 && selSum.damage < 1.3) score -= 0.9;
  return Math.max(-1.5, Math.min(1.6, score));
}

// 팀 전체 균형을 vector sum 축(딜/내구/CC/유틸/템포)으로 평가.
function vectorMetricBalanceScore(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;
  const sum = teamVectorFromEffective(team).sum;
  let score = 0;
  if (sum.damage <= 1.4) score -= 1.0;
  else if (sum.damage >= 2.4) score += 0.25; // 0.5→0.25: 이미 충분한 딜에 추가 보너스 축소(④ 억제)
  if (sum.durability <= 1.0) score -= 0.6;
  else if (sum.durability >= 1.8) score += 0.3;
  if (sum.cc <= 0.8) score -= 0.55;
  else if (sum.cc >= 1.8) score += 0.45;
  if (sum.support >= 1.0 && sum.damage >= 2.0) score += 0.25;
  if (sum.support >= 1.0 && sum.damage <= 1.6) score -= 0.35;
  if (sum.tempo >= 1.4 && sum.cc >= 1.2) score += 0.3;
  return Math.max(-1.6, Math.min(1.25, score));
}

// 보조 신호: 축 균형(딜/내구/CC 결핍 개수)으로 작은 가산/감산. legacy의 교전·정체성
// 로직을 대체하지 않고 위에 얹기만 함.
function vectorCompositionGuideAux(candidate, selected) {
  const team = [...selected, candidate];
  if (team.length < 3) return 0;
  const sum = teamVectorFromEffective(team).sum;
  let aux = 0;
  const deficits = [sum.damage < 1.5, sum.durability < 0.9, sum.cc < 0.8].filter(Boolean).length;
  if (deficits === 0) {
    // 상수처럼 붙던 균형 보너스를 0.6→0.4로 약화. 추가로, 딜만 과하고 내구/CC가
    // 빠듯한 "딜로 떠받친 가짜 균형"(④ 성격)은 보너스를 더 깎는다. 진짜 균형
    // (예: Leni+Markus류 고CC·peel + 적정 딜)은 영향 없음.
    aux += 0.4;
    if (sum.damage >= 2.6 && (sum.durability < 1.2 || sum.cc < 1.2)) aux -= 0.2;
  } else {
    aux -= deficits * 0.4;
  }
  if (sum.frontline < 0.6 && sum.cc < 1.0) aux -= 0.4; // 전열 전무 + 제어 부족
  return Math.max(-1.5, Math.min(1.0, aux));
}

// ── hybrid 디스패처 ──
function roleBalanceScore(candidate, selected) {
  const legacy = legacyRoleBalanceScore(candidate, selected);
  if (!(VECTOR_SCORING_FLAGS.enableCharacterVector && VECTOR_SCORING_FLAGS.useVectorRoleBalanceScore)) return legacy;
  const vector = vectorRoleBalanceScore(candidate, selected);
  return legacy + VECTOR_ROLE_BALANCE_BLEND * (vector - legacy);
}

function frontDamageScore(candidate, selected) {
  const legacy = legacyFrontDamageScore(candidate, selected);
  if (!(VECTOR_SCORING_FLAGS.enableCharacterVector && VECTOR_SCORING_FLAGS.useVectorDamageBalanceScore)) return legacy;
  const vector = vectorFrontDamageScore(candidate, selected);
  return legacy + VECTOR_DAMAGE_BALANCE_BLEND * (vector - legacy);
}

function backlineDamageScore(candidate, selected) {
  const legacy = legacyBacklineDamageScore(candidate, selected);
  if (!(VECTOR_SCORING_FLAGS.enableCharacterVector && VECTOR_SCORING_FLAGS.useVectorDamageBalanceScore)) return legacy;
  const vector = vectorBacklineDamageScore(candidate, selected);
  return legacy + VECTOR_DAMAGE_BALANCE_BLEND * (vector - legacy);
}

function metricBalanceScore(candidate, selected) {
  const legacy = legacyMetricBalanceScore(candidate, selected);
  if (!(VECTOR_SCORING_FLAGS.enableCharacterVector && VECTOR_SCORING_FLAGS.useVectorMetricBalanceScore)) return legacy;
  const vector = vectorMetricBalanceScore(candidate, selected);
  return legacy + VECTOR_METRIC_BALANCE_BLEND * (vector - legacy);
}

function legacyRoleBalanceScore(candidate, selected) {
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

function legacyFrontDamageScore(candidate, selected) {
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

function legacyBacklineDamageScore(candidate, selected) {
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
  score += leniSustainRelief(team) * 0.75 + leniFrontballRelief(team) * 0.85;

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

function legacyMetricBalanceScore(candidate, selected) {
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

// 보조 적용: legacy 교전/정체성 로직을 유지하고 vector 균형 신호를 가산만 한다.
function compositionGuideScore(candidate, selected) {
  const legacy = legacyCompositionGuideScore(candidate, selected);
  if (!(VECTOR_SCORING_FLAGS.enableCharacterVector && VECTOR_SCORING_FLAGS.useVectorCompositionGuideScore)) return legacy;
  const aux = vectorCompositionGuideAux(candidate, selected);
  return legacy + VECTOR_COMPOSITION_GUIDE_AUX_BLEND * aux;
}

function legacyCompositionGuideScore(candidate, selected) {
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
    score += leniSustainRelief(team) * 0.85 + leniFrontballRelief(team) * 0.95;
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

function officialBucketRows(bucket, candidateId) {
  const bucketMap = _officialCompositionByTierCandidate.get(bucket);
  return bucketMap?.get(candidateId) ?? [];
}


// ── Bayesian smoothing helpers ────────────────────────────────────────────────

function bayesianRate(wins, games, alpha, globalRate) {
  if (!games && !alpha) return globalRate ?? 0;
  return (wins + alpha * (globalRate ?? 0.5)) / (games + alpha);
}

function globalWinRate(tier) {
  const bucket = officialStatsBucketForTier(tier);
  const stats = officialCandidateStatsByTier?.[bucket] ?? officialCandidateStatsByTier?.all ?? {};
  const entries = Object.values(stats);
  if (!entries.length) return 0.5;
  const totalGames = entries.reduce((s, e) => s + (e.games ?? 0), 0);
  const totalWins  = entries.reduce((s, e) => s + (e.games ?? 0) * (e.winRate ?? 0), 0);
  return totalGames > 0 ? totalWins / totalGames : 0.5;
}

// ── Official v2 scoring ───────────────────────────────────────────────────────

function officialCandidateStats(candidate, tier) {
  const bucket = officialStatsBucketForTier(tier);
  return officialStatByIds(officialCandidateStatsByTier?.[bucket], candidate) ??
    officialStatByIds(officialCandidateStatsByTier?.all, candidate);
}

function officialStatIds(character) {
  return [character.variantId, character.characterId].filter(Boolean);
}

function officialStatByIds(stats, character) {
  for (const id of officialStatIds(character)) {
    if (stats?.[id]) return stats[id];
  }
  return undefined;
}

function officialPairStat(pairStats, a, b) {
  for (const idA of officialStatIds(a)) {
    for (const idB of officialStatIds(b)) {
      const key = [idA, idB].sort().join("|");
      if (pairStats?.[key]) return pairStats[key];
    }
  }
  return undefined;
}

function officialCharacterForStatId(statId) {
  return characterVariants.find((item) => item.variantId === statId) ??
    characterVariants.find((item) => item.characterId === statId);
}

function officialMetaDamageGroup(character) {
  if (isSupport(character)) return "support";
  if (isFrontRole(character) || character.role === "assassin") return "front";
  if (character.role === "ranged" || character.role === "mage") return "backline";
  return "all";
}

function officialStatConfidence(stats, fullConfidenceGames = 260) {
  const games = stats?.games ?? 0;
  if (games <= 0) return 0;
  return clamp(Math.log10(games + 1) / Math.log10(fullConfidenceGames + 1), 0, 1);
}

function officialTierAverages(tier, damageGroup = "all") {
  const bucket = officialStatsBucketForTier(tier);
  const cacheKey = `${bucket}:${damageGroup}`;
  const cached = _officialTierAverageCache.get(cacheKey);
  if (cached) return cached;

  const statsByCharacter = officialCandidateStatsByTier?.[bucket] ?? officialCandidateStatsByTier?.all ?? {};
  const rows = Object.entries(statsByCharacter)
    .map(([statId, stats]) => ({
      character: officialCharacterForStatId(statId),
      stats,
    }))
    .filter(({ character, stats }) => character && stats?.games > 0);

  const groupedRows = damageGroup === "all"
    ? rows
    : rows.filter(({ character }) => officialMetaDamageGroup(character) === damageGroup);
  const sourceRows = groupedRows.length >= 8 ? groupedRows : rows;

  const totals = sourceRows.reduce((state, { stats }) => {
    const games = stats.games ?? 0;
    state.games += games;
    state.winRate += (stats.winRate ?? 0) * games;
    state.top3Rate += (stats.top3Rate ?? 0) * games;
    state.avgPlacement += (stats.avgPlacement ?? 4.5) * games;
    state.avgDamageToPlayer += (stats.avgDamageToPlayer ?? 0) * games;
    state.avgDamageFromPlayer += (stats.avgDamageFromPlayer ?? 0) * games;
    return state;
  }, {
    games: 0,
    winRate: 0,
    top3Rate: 0,
    avgPlacement: 0,
    avgDamageToPlayer: 0,
    avgDamageFromPlayer: 0,
  });

  const averages = totals.games > 0 ? {
    games: totals.games,
    winRate: totals.winRate / totals.games,
    top3Rate: totals.top3Rate / totals.games,
    avgPlacement: totals.avgPlacement / totals.games,
    avgDamageToPlayer: totals.avgDamageToPlayer / totals.games,
    avgDamageFromPlayer: totals.avgDamageFromPlayer / totals.games,
  } : {
    games: 0,
    winRate: 0.14,
    top3Rate: 0.42,
    avgPlacement: 4.5,
    avgDamageToPlayer: 14000,
    avgDamageFromPlayer: 14000,
  };

  _officialTierAverageCache.set(cacheKey, averages);
  return averages;
}

function officialMetaScore(candidate, tier) {
  const stats = officialCandidateStats(candidate, tier);
  if (!stats || (stats.games ?? 0) < 10) return 0;

  const averages = officialTierAverages(tier, officialMetaDamageGroup(candidate));
  const confidence = officialStatConfidence(stats);
  const resultScore =
    ((stats.winRate ?? averages.winRate) - averages.winRate) * 2.2 +
    ((stats.top3Rate ?? averages.top3Rate) - averages.top3Rate) * 1.35 +
    ((averages.avgPlacement ?? 4.5) - (stats.avgPlacement ?? averages.avgPlacement)) * 0.36;
  const damageBase = averages.avgDamageToPlayer > 0 ? averages.avgDamageToPlayer : 14000;
  const damageScore = stats.avgDamageToPlayer
    ? clamp((stats.avgDamageToPlayer / damageBase - 1) * 0.62, -0.32, 0.42)
    : 0;
  const durabilityBase = averages.avgDamageFromPlayer > 0 ? averages.avgDamageFromPlayer : 14000;
  const durabilityScore = isFrontRole(candidate) && stats.avgDamageFromPlayer
    ? clamp((stats.avgDamageFromPlayer / durabilityBase - 1) * 0.28, -0.12, 0.22)
    : 0;

  return clamp((resultScore + damageScore + durabilityScore) * confidence, -1.05, 1.15);
}

function officialCompositionScore(candidate, selected, tier) {
  if (selected.length === 0) return 0;

  const bucket = officialStatsBucketForTier(tier);
  const selectedCharacters = new Set(selected.flatMap(officialStatIds));
  const rows = [
    ...officialStatIds(candidate).flatMap((id) => officialBucketRows(bucket, id)),
    ...(bucket === "all" ? [] : officialStatIds(candidate).flatMap((id) => officialBucketRows("all", id))),
  ];
  if (rows.length === 0) return 0;

  const aggregate = rows.reduce((state, row) => {
    const teammates = row.teammates ?? [];
    const matchedCount = teammates.filter((characterId) => selectedCharacters.has(characterId)).length;
    if (matchedCount === 0) return state;

    const exactMatch = matchedCount === selectedCharacters.size;
    const matchWeight = exactMatch ? 1.25 : 0.42;
    const sampleWeight = Math.min(1.1, Math.log2((row.games ?? 0) + 1) / 4);
    const weight = matchedCount * matchWeight * sampleWeight;
    state.score += placementScore(row) * weight;
    state.weight += weight;
    return state;
  }, { score: 0, weight: 0 });

  if (aggregate.weight === 0) return 0;
  return clamp((aggregate.score / aggregate.weight) * 1.25, -1.4, 1.5);
}

function officialCandidateScore(candidate, tier) {
  const stats = officialCandidateStats(candidate, tier);
  if (!stats) return 0;

  const confidence = Math.min(1, Math.log10((stats.games ?? 0) + 1) / 2.2);
  const damageSignal = stats.avgDamageToPlayer ? clamp((stats.avgDamageToPlayer - 18000) / 22000, -0.35, 0.45) : 0;
  return clamp((placementScore(stats) * 0.75 + damageSignal * 0.35) * confidence, -0.95, 1.05);
}


function officialCharacterPowerScore(candidate, tier) {
  const stats = officialCandidateStats(candidate, tier);
  if (!stats || !stats.games) return 0;
  const alpha = BAYESIAN_ALPHA?.character ?? 100;
  const global = globalWinRate(tier);
  const adjWr = bayesianRate(stats.wins ?? stats.winRate * stats.games, stats.games, alpha, global);
  const confidence = Math.min(1, Math.log10(stats.games + 1) / 2.5);
  return clamp((adjWr - global) * 4 * confidence, -1.0, 1.2);
}

function officialPairSynergyScore(candidate, selected, tier) {
  if (!selected.length) return 0;
  const bucket = officialStatsBucketForTier(tier);
  const pairStats = officialPairStatsByTier?.[bucket] ?? officialPairStatsByTier?.all;
  if (!pairStats) return 0;

  const alpha = BAYESIAN_ALPHA?.pair ?? 80;
  const global = globalWinRate(tier);
  let totalSynergy = 0;
  let count = 0;

  for (const teammate of selected) {
    const pair = officialPairStat(pairStats, candidate, teammate);
    const pairGames = pair?.games ?? 0;
    const pairWins  = pairGames * (pair?.winRate ?? 0);

    // individual adjusted rates
    const csA = officialCandidateStats(candidate, tier);
    const csB = officialCandidateStats(teammate, tier);
    const wrA = csA?.games ? bayesianRate(csA.winRate * csA.games, csA.games, alpha, global) : global;
    const wrB = csB?.games ? bayesianRate(csB.winRate * csB.games, csB.games, alpha, global) : global;
    const expected = 0.5 * (wrA + wrB);

    const adjPairWr = bayesianRate(pairWins, pairGames, alpha, expected);
    totalSynergy += adjPairWr - expected;
    count++;
  }

  if (!count) return 0;
  return clamp((totalSynergy / count) * 5, -1.0, 1.2);
}

function officialCombatSignalScore(candidate, tier) {
  const bucket = officialStatsBucketForTier(tier);
  const combatStats = officialCombatStatsByTier?.[bucket] ?? officialCombatStatsByTier?.all;
  const cs = officialStatByIds(combatStats, candidate);
  if (!cs || !cs.games) return 0;

  const alpha = BAYESIAN_ALPHA?.combat ?? 80;
  // normalize combat score: kills+assists per game vs typical value
  const kda = (cs.avgKills ?? 0) + (cs.avgAssists ?? 0) * 0.5 + (cs.avgTeamKills ?? 0) * 0.3;
  const dmgNorm = clamp(((cs.avgDamage ?? 0) - 15000) / 20000, -0.5, 0.6);
  const rawScore = clamp(kda / 6, -0.5, 0.7) + dmgNorm * 0.4;
  const confidence = Math.min(1, Math.log10(cs.games + 1) / 2.5);
  return clamp(rawScore * confidence, -0.8, 1.0);
}

function officialV2Score(candidate, selected, tier) {
  const W = OFFICIAL_V2_WEIGHTS ?? { characterPower: 0.30, pairSynergy: 0.35, combatScore: 0.15, roleBalance: 0.20 };
  const charPower  = officialCharacterPowerScore(candidate, tier);
  const pairSyn    = officialPairSynergyScore(candidate, selected, tier);
  const combat     = officialCombatSignalScore(candidate, tier);
  // roleBalance is computed externally; pass 0 here and combine in evaluateCandidate
  return clamp(
    W.characterPower * charPower +
    W.pairSynergy    * pairSyn   +
    W.combatScore    * combat,
    -1.5, 1.8
  );
}

function officialMatchScore(candidate, selected, tier) {
  // depth-3 (exact 3-person composition) stats disabled until data volume is sufficient
  // const composition = officialCompositionScore(candidate, selected, tier);
  const candidateScore = officialCandidateScore(candidate, tier);
  return clamp(candidateScore * 0.45, -1.5, 1.65);
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

function legacyDakMetaScore(candidate, tier) {
  const legacyScore =
    dakTierScore(candidate, tier) * 0.35 +
    dakStatisticsScore(candidate, tier) * 0.35 +
    dakRealtimeScore(candidate) * 0.30;
  return clamp(legacyScore, -0.95, 1.05);
}

function combinedMetaScore(candidate, tier) {
  const officialScore = officialMetaScore(candidate, tier);
  const legacyScore = legacyDakMetaScore(candidate, tier);
  const officialConfidence = officialStatConfidence(officialCandidateStats(candidate, tier), 420);

  const officialWeight = clamp(officialConfidence, 0, 0.78);
  const legacyWeight = 0.58 - officialWeight * 0.42;
  return clamp(officialScore * officialWeight + legacyScore * legacyWeight, -1.1, 1.25);
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

  // This penalty is about adding an *engager* to Lenox's counter-attack comp, so gate it on the
  // candidate actually being an engager/melee dealer — not merely on the team's melee count
  // (which a teammate's core-role flip could inflate). Counter/ranged picks never trigger it.
  if (
    nextShape.guardOnly >= 1 &&
    candidate.characterId !== "lenox" &&
    (isFirstEngageStyle(candidate) || isMeleeDealer(candidate)) &&
    !isCounterOnlyRanged(candidate)
  ) {
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
  if (scores.dakComposition >= 1.8) reasons.push(t("recommender.reason.dakCompositionPositive", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.dakComposition <= -1.1) reasons.push(t("recommender.reason.dakCompositionNegative", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.officialMatch >= 0.75) reasons.push(t("recommender.reason.officialMatchPositive", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.officialMatch <= -0.65) reasons.push(t("recommender.reason.officialMatchNegative", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.officialCoreRoleShift >= 0.45) reasons.push(t("recommender.reason.coreRolePositive", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.officialCoreFit >= 0.35) reasons.push(t("recommender.reason.coreFitPositive", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.officialCoreRoleShift <= -0.45 || scores.officialCoreFit <= -0.35) reasons.push(t("recommender.reason.coreFitNegative", { nameSubject: subjectName(candidate), name: characterName(candidate) }));
  if (scores.dakTier >= 1.1) reasons.push(t("recommender.reason.dakTierHigh", { name: characterName(candidate) }));
  if (scores.dakStatistics >= 0.8) reasons.push(t("recommender.reason.dakStatsPositive", { name: characterName(candidate) }));
  if (scores.dakStatistics <= -0.75) reasons.push(t("recommender.reason.dakStatsNegative", { name: characterName(candidate) }));
  if (scores.dakRealtime >= 0.9) {
    const stats = realtimeStatsFor(candidate);
    reasons.push(t("recommender.reason.realtimeStatsPositive", { weapon: weaponLabel(candidate), name: characterName(candidate), winRate: stats.winRate.toFixed(1), top3Rate: stats.top3Rate.toFixed(1), damage: stats.damage.toLocaleString() }));
  }
  if (scores.dakRealtime <= -0.85) {
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

// ── Per-core (trait) scoring ───────────────────────────────────────────────────
function traitBuildRowsFor(variantId, tier) {
  const bucket = officialStatsBucketForTier(tier);
  const rows = officialTraitBuildStatsByTier?.[bucket]?.[variantId]
    ?? officialTraitBuildStatsByTier?.all?.[variantId]
    ?? [];
  return normalizeTraitBuildRows(variantId, rows);
}

function coreRowFor(variantId, core, tier) {
  const rows = traitBuildRowsFor(variantId, tier);
  return coreRowForVariant(variantId, rows, core);
}

function candidateCoreOptions(variantId, tier, cores = {}) {
  if (cores[variantId]) return [cores[variantId]];

  const rows = traitBuildRowsFor(variantId, tier);
  if (!rows.length) return [null];

  const topGames = rows[0]?.games ?? 0;
  const threshold = Math.max(40, topGames * 0.12);
  const options = rows
    .filter((row, index) => index === 0 || (row.games ?? 0) >= threshold)
    .slice(0, 3)
    .map((row) => row.core)
    .filter(Boolean);

  return options.length ? options : [null];
}

let _effectiveCoreProfileCache = new Map();
let _variantCoreBaselineCache = new Map();

function coreCode(rowOrCore) {
  if (!rowOrCore) return "";
  if (typeof rowOrCore === "object") return String(rowOrCore.core ?? "");
  return String(rowOrCore);
}

function mergeTags(baseTags = [], addTags = [], removeTags = []) {
  const removed = new Set(removeTags);
  const merged = new Set(baseTags.filter((tag) => !removed.has(tag)));
  addTags.forEach((tag) => merged.add(tag));
  return [...merged];
}

function variantCoreBaseline(variantId, tier) {
  const bucket = officialStatsBucketForTier(tier);
  const key = `${bucket}|${variantId}`;
  const cached = _variantCoreBaselineCache.get(key);
  if (cached) return cached;

  const rows = traitBuildRowsFor(variantId, tier).filter((row) => (row.games ?? 0) > 0);
  const totals = rows.reduce((state, row) => {
    const games = row.games ?? 0;
    state.games += games;
    state.damage += (row.avgDamageToPlayer ?? 0) * games;
    state.taken += (row.avgDamageFromPlayer ?? 0) * games;
    state.cc += (row.avgCcTime ?? 0) * games;
    state.basic += (row.basicDamageShare ?? 0) * games;
    state.skill += (row.skillDamageShare ?? 0) * games;
    return state;
  }, { games: 0, damage: 0, taken: 0, cc: 0, basic: 0, skill: 0 });

  const fallback = coreMetricAverages(tier);
  const baseline = totals.games > 0
    ? {
        games: totals.games,
        damage: totals.damage / totals.games,
        taken: totals.taken / totals.games,
        cc: totals.cc / totals.games,
        basic: totals.basic / totals.games,
        skill: totals.skill / totals.games,
        coreCount: rows.length,
      }
    : {
        games: 0,
        damage: fallback.damage,
        taken: fallback.taken,
        cc: fallback.cc,
        basic: 0,
        skill: 0,
        coreCount: 0,
      };

  _variantCoreBaselineCache.set(key, baseline);
  return baseline;
}

function ratio(value, baseline, fallback = 1) {
  return Number.isFinite(value) && Number.isFinite(baseline) && baseline > 0 ? value / baseline : fallback;
}

function inferredCoreRoleOverride(character, row, profile, tier) {
  if (!row || !row.games) return {};

  const games = row.games ?? 0;
  const baseline = variantCoreBaseline(character.variantId, tier);
  if (games < 25 || baseline.coreCount < 2) return {};

  const global = coreMetricAverages(tier);
  const damageVsSelf = ratio(row.avgDamageToPlayer, baseline.damage);
  const takenVsSelf = ratio(row.avgDamageFromPlayer, baseline.taken);
  const ccVsSelf = ratio(row.avgCcTime, baseline.cc);
  const damageVsField = ratio(row.avgDamageToPlayer, global.damage);
  const takenVsField = ratio(row.avgDamageFromPlayer, global.taken);
  const basicShare = row.basicDamageShare ?? baseline.basic ?? 0;
  const skillShare = row.skillDamageShare ?? baseline.skill ?? 0;
  const canBecomeFront = isFrontRole(character) || character.role === "assassin";
  const isBackline = isBacklineDealer(character);
  const baseIsTank = isTank(character);
  const baseIsDamageFront = character.role === "bruiser" || character.role === "assassin";
  const defensiveLean =
    takenVsSelf >= 1.10 ||
    (takenVsField >= 1.06 && damageVsSelf <= 1.02) ||
    (ccVsSelf >= 1.16 && damageVsSelf <= 0.98);
  const damageLean =
    damageVsSelf >= 1.12 ||
    (damageVsField >= 0.98 && damageVsSelf >= 1.05) ||
    (character.frontDamage === "high" && damageVsSelf >= 1.04 && damageVsField >= 0.86) ||
    (basicShare >= 0.58 && damageVsSelf >= 1.03);
  const lowDamageLean = damageVsSelf <= 0.90 || damageVsField <= 0.82;

  // A role *reclassification* (tank<->bruiser) is the strongest structural lever, so it
  // must be corroborated by the core's own intrinsic playstyle and a solid sample — not a
  // single noisy damage ratio. This prevents, e.g., a support/heal core (high profile.support)
  // from being read as a damage bruiser just because its damage row edged above the character's
  // own average. Characters whose combat identity is fixed (guard-only anchors, counter-only
  // ranged, cannot-start-engage) never reclassify; their core only tunes damage/utility tags.
  const identityFixed = isGuardOnly(character) || isCounterOnlyRanged(character) || cannotStartEngage(character);
  // Compare the core's offensive vs defensive mass RELATIVE to itself rather than against an
  // absolute cut. Cores like 응징 sit near-neutral (offense ≈ defense), so they force neither
  // direction — the character's own match stats (strong*Evidence below) decide. Only clearly
  // offensive cores (취약/벽력...) or clearly defensive cores (치유드론/금강...) lean hard.
  const coreOffenseMass = profile.damage + profile.tempo * 0.3;
  const coreDefenseMass = profile.durability + profile.support;
  const coreLeansOffense = coreOffenseMass - coreDefenseMass >= 0.12 && profile.support < 0.45;
  const coreLeansDefense = coreDefenseMass - coreOffenseMass >= 0.12;
  const strongDamageEvidence = games >= 60 && (damageVsSelf >= 1.18 || (damageVsSelf >= 1.10 && damageVsField >= 0.97));
  const strongDefenseEvidence = games >= 60 && (takenVsSelf >= 1.16 || (takenVsField >= 1.06 && damageVsSelf <= 1.00));

  if (isBackline) {
    const survivalLean =
      takenVsSelf >= 1.12 ||
      (takenVsField >= 0.78 && damageVsSelf >= 1.04) ||
      (profile.durability >= 0.35 && damageVsSelf >= 1.03);
    const utilityLean = ccVsSelf >= 1.14 || profile.support >= 0.45 || profile.cc >= 0.45;

    if (survivalLean || damageLean || utilityLean) {
      return {
        role: character.role,
        damage: basicShare >= 0.58 ? "basic" : skillShare >= 0.70 ? "skill" : character.damage,
        backlineDamage: damageVsSelf >= 1.08 || damageVsField >= 0.95 ? "high" : character.backlineDamage,
        addTags: [
          ...(damageLean ? ["focus"] : []),
          ...(basicShare >= 0.58 ? ["sustained"] : []),
          ...(survivalLean ? ["durable", "sustain"] : []),
          ...(utilityLean ? ["utility"] : []),
          ...(ccVsSelf >= 1.14 ? ["cc"] : []),
        ],
        removeTags: [],
      };
    }

    return {};
  }

  if (!canBecomeFront) return {};

  // Already an offensive front (bruiser/assassin): no role change, just fine-tune the
  // damage emphasis. Safe because the base role already matches the lean.
  if (baseIsDamageFront && damageLean) {
    const heavyDamageLean = damageVsSelf >= 1.08 || damageVsField >= 0.95;
    return {
      role: character.role,
      damage: basicShare >= 0.58 ? "basic" : skillShare >= 0.70 ? "skill" : character.damage,
      frontDamage: heavyDamageLean ? "high" : character.frontDamage,
      addTags: [
        "focus",
        ...(basicShare >= 0.58 || damageVsSelf >= 1.12 ? ["sustained"] : []),
        ...(profile.tempo >= 0.45 ? ["mobility"] : []),
        ...(takenVsSelf >= 1.10 ? ["durable"] : []),
      ],
      removeTags: [],
    };
  }

  // Tank -> bruiser is a genuine reclassification: require strong, corroborated evidence
  // AND an offensive core. Support/heal/heavy-tank cores can never trigger this.
  if (baseIsTank && !identityFixed && damageLean && coreLeansOffense && strongDamageEvidence) {
    const heavyDamageLean = damageVsSelf >= 1.18 || damageVsField >= 0.97;
    return {
      role: "bruiser",
      damage: basicShare >= 0.58 ? "basic" : skillShare >= 0.70 ? "skill" : character.damage,
      frontDamage: heavyDamageLean ? "high" : "medium",
      addTags: [
        "focus",
        ...(basicShare >= 0.58 || damageVsSelf >= 1.12 ? ["sustained"] : []),
        ...(profile.tempo >= 0.45 ? ["mobility"] : []),
        ...(takenVsSelf >= 1.10 ? ["durable"] : []),
      ],
      removeTags: heavyDamageLean ? ["peel", "healing"] : [],
    };
  }

  // Defensive read. The tank vs. "tanky bruiser" boundary is genuinely fuzzy in this game
  // (items and tactical skills also shift it), so a base tank just reinforces durability here.
  if (defensiveLean && coreLeansDefense && baseIsTank) {
    return {
      role: character.role,
      damage: lowDamageLean && character.damage === "basic" ? "hybrid" : character.damage,
      frontDamage: lowDamageLean ? "low" : "medium",
      addTags: [
        "durable",
        ...(ccVsSelf >= 1.12 ? ["cc"] : []),
        ...(profile.support >= 0.48 || takenVsSelf >= 1.16 ? ["peel"] : []),
        ...(profile.support >= 0.60 ? ["healing", "sustain"] : []),
      ],
      removeTags: lowDamageLean ? ["burst", "focus"] : [],
    };
  }

  // Base offensive front (bruiser/assassin) turning defensive. Only a build that has clearly
  // traded away its damage (lowDamageLean) becomes a PURE frontline tank. A build that is
  // sturdier but still dealing damage stays a bruiser — a "tanky bruiser" — and merely gains
  // durability emphasis, so it keeps counting as a melee dealer rather than a tank.
  if (defensiveLean && coreLeansDefense && baseIsDamageFront && !identityFixed && strongDefenseEvidence) {
    if (lowDamageLean) {
      return {
        role: "frontline",
        damage: character.damage === "basic" ? "hybrid" : character.damage,
        frontDamage: "low",
        addTags: [
          "durable",
          ...(ccVsSelf >= 1.12 ? ["cc"] : []),
          ...(profile.support >= 0.48 || takenVsSelf >= 1.16 ? ["peel"] : []),
          ...(profile.support >= 0.60 ? ["healing", "sustain"] : []),
        ],
        removeTags: ["burst", "focus"],
      };
    }
    return {
      role: character.role,
      damage: character.damage,
      frontDamage: "medium",
      addTags: [
        "durable",
        ...(ccVsSelf >= 1.12 ? ["cc"] : []),
        ...(profile.support >= 0.48 || takenVsSelf >= 1.16 ? ["peel"] : []),
      ],
      removeTags: [],
    };
  }

  return {};
}

function applyCoreRoleProfile(character, core, tier) {
  if (!character) return character;
  const row = coreRowFor(character.variantId, core, tier);
  const code = coreCode(row ?? core);
  if (!code) return { ...character, effectiveTier: tier };

  const bucket = officialStatsBucketForTier(tier);
  const key = `${bucket}|${character.variantId}|${code}`;
  const cached = _effectiveCoreProfileCache.get(key);
  if (cached) return cached;

  const profile = corePlaystyle(row, tier);
  const override = inferredCoreRoleOverride(character, row, profile, tier);
  const effective = {
    ...character,
    role: override.role ?? character.role,
    tags: mergeTags(character.tags, override.addTags, override.removeTags),
    damage: override.damage ?? character.damage,
    frontDamage: override.frontDamage ?? character.frontDamage,
    backlineDamage: override.backlineDamage ?? character.backlineDamage,
    effectiveTier: tier,
    effectiveCore: {
      core: code,
      name: normalizeCoreName(row) ?? row?.name ?? null,
      roleOverride: Boolean(override.role || override.frontDamage || override.backlineDamage || override.damage),
      profile,
    },
  };

  _effectiveCoreProfileCache.set(key, effective);
  return effective;
}

function effectiveTeamFor(selected, cores, tier) {
  return selected.map((character) => applyCoreRoleProfile(character, cores[character.variantId], tier));
}

let _coreMetricAverageCache = new Map();

function coreMetricAverages(tier) {
  const bucket = officialStatsBucketForTier(tier);
  const cached = _coreMetricAverageCache.get(bucket);
  if (cached) return cached;

  const byVariant = officialTraitBuildStatsByTier?.[bucket] ?? officialTraitBuildStatsByTier?.all ?? {};
  const totals = {
    games: 0,
    damage: 0,
    taken: 0,
    cc: 0,
  };

  for (const rows of Object.values(byVariant)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const games = row.games ?? 0;
      if (games <= 0) continue;
      totals.games += games;
      totals.damage += (row.avgDamageToPlayer ?? 0) * games;
      totals.taken += (row.avgDamageFromPlayer ?? 0) * games;
      totals.cc += (row.avgCcTime ?? 0) * games;
    }
  }

  const averages = totals.games > 0
    ? {
        damage: totals.damage / totals.games,
        taken: totals.taken / totals.games,
        cc: totals.cc / totals.games,
      }
    : { damage: 14000, taken: 18000, cc: 45 };
  _coreMetricAverageCache.set(bucket, averages);
  return averages;
}

// Point 1: build strength of the chosen/meta core as a candidate signal.
function officialCoreScore(candidate, tier, cores = {}) {
  const row = coreRowFor(candidate.variantId, cores[candidate.variantId], tier);
  if (!row || !row.games) return 0;
  const global = globalWinRate(tier);
  const alpha = BAYESIAN_ALPHA?.character ?? 100;
  const adjWr = bayesianRate((row.winRate ?? 0) * row.games, row.games, alpha, global);
  const conf = Math.min(1, Math.log10(row.games + 1) / 2.5);
  return clamp((adjWr - global) * 4.2 * conf, -1.0, 1.25);
}

function corePlaystyle(row, tier) {
  if (!row) return { damage: 0, durability: 0, support: 0, cc: 0, tempo: 0 };

  const avg = coreMetricAverages(tier);
  const code = coreCode(row);
  const profile = { damage: 0, durability: 0, support: 0, cc: 0, tempo: 0 };
  const add = (values) => {
    for (const [key, value] of Object.entries(values)) profile[key] += value;
  };

  if (["7000201", "7000501", "7000601", "7000701"].includes(code)) add({ damage: 0.70, tempo: 0.35 });
  if (["7000401", "7300301"].includes(code)) add({ damage: 0.42, durability: 0.35, tempo: 0.20 });
  if (["7300101", "7300201"].includes(code)) add({ damage: 0.45, cc: 0.20, tempo: 0.38 });
  if (code === "7100501") add({ damage: 0.36, durability: 0.36, cc: 0.24, tempo: 0.20 });
  if (["7100101", "7100201"].includes(code)) add({ durability: 0.78, cc: 0.12 });
  if (code === "7100401") add({ durability: 0.45, support: 0.42, cc: 0.12 });
  if (code === "7200101") add({ durability: 0.52, support: 0.32 });
  if (code === "7200201") add({ support: 0.50, damage: 0.28, tempo: 0.18 });
  if (["7200301", "7200501"].includes(code)) add({ support: 0.72, durability: 0.28 });

  if ((row.avgDamageToPlayer ?? 0) > 0 && avg.damage > 0) {
    profile.damage += clamp(((row.avgDamageToPlayer / avg.damage) - 1) * 0.75, -0.25, 0.45);
  }
  if ((row.avgDamageFromPlayer ?? 0) > 0 && avg.taken > 0) {
    profile.durability += clamp(((row.avgDamageFromPlayer / avg.taken) - 1) * 0.55, -0.20, 0.40);
  }
  if ((row.avgCcTime ?? 0) > 0 && avg.cc > 0) {
    profile.cc += clamp(((row.avgCcTime / avg.cc) - 1) * 0.45, -0.15, 0.35);
  }
  if ((row.basicDamageShare ?? 0) >= 0.55) profile.tempo += 0.10;
  if ((row.skillDamageShare ?? 0) >= 0.70) profile.damage += 0.08;

  return {
    damage: clamp(profile.damage, -0.35, 1.25),
    durability: clamp(profile.durability, -0.25, 1.20),
    support: clamp(profile.support, 0, 1.20),
    cc: clamp(profile.cc, -0.20, 1.00),
    tempo: clamp(profile.tempo, 0, 1.00),
  };
}

function officialCoreFitScore(candidate, selected, tier, cores = {}) {
  const team = [...selected, candidate];
  if (team.length < 2) return 0;

  const rows = team
    .map((character) => coreRowFor(character.variantId, cores[character.variantId], tier))
    .filter((row) => row && row.games > 0);
  if (rows.length < 2) return 0;

  const avg = coreMetricAverages(tier);
  const total = rows.reduce((state, row) => {
    const conf = Math.min(1, Math.log10((row.games ?? 0) + 1) / 2.5);
    state.conf += conf;
    state.damage += ((row.avgDamageToPlayer ?? avg.damage) / avg.damage - 1) * conf;
    state.taken += ((row.avgDamageFromPlayer ?? avg.taken) / avg.taken - 1) * conf;
    state.cc += ((row.avgCcTime ?? avg.cc) / avg.cc - 1) * conf;
    return state;
  }, { conf: 0, damage: 0, taken: 0, cc: 0 });
  if (total.conf <= 0) return 0;

  const damage = total.damage / total.conf;
  const taken = total.taken / total.conf;
  const cc = total.cc / total.conf;
  let score = 0;

  if (damage < -0.08 && (isHighDamageBackline(candidate) || isHighDamageFront(candidate))) score += 0.35;
  if (damage > 0.10 && (isSupport(candidate) || isLowDamageContributor(candidate))) score += 0.18;
  if (taken > 0.10 && (isSupport(candidate) || isTank(candidate))) score += 0.22;
  if (cc < -0.12 && ccPower(candidate) >= 1.4) score += 0.22;
  if (team.length >= 3 && damage < -0.14) score -= 0.30;

  return clamp(score, -0.55, 0.75);
}

function officialCoreRoleShiftScore(candidate, selected, tier, cores = {}) {
  const row = coreRowFor(candidate.variantId, cores[candidate.variantId], tier);
  if (!row || !row.games) return 0;

  const profile = corePlaystyle(row, tier);
  const selectedCoreProfile = selected.reduce((state, character) => {
    const selectedRow = coreRowFor(character.variantId, cores[character.variantId], tier);
    const selectedProfile = corePlaystyle(selectedRow, tier);
    const conf = selectedRow?.games ? Math.min(1, Math.log10(selectedRow.games + 1) / 2.7) : 0;
    state.damage += selectedProfile.damage * conf;
    state.durability += selectedProfile.durability * conf;
    state.support += selectedProfile.support * conf;
    state.cc += selectedProfile.cc * conf;
    state.tempo += selectedProfile.tempo * conf;
    state.conf += conf;
    return state;
  }, { damage: 0, durability: 0, support: 0, cc: 0, tempo: 0, conf: 0 });
  if (selectedCoreProfile.conf > 0) {
    selectedCoreProfile.damage /= selectedCoreProfile.conf;
    selectedCoreProfile.durability /= selectedCoreProfile.conf;
    selectedCoreProfile.support /= selectedCoreProfile.conf;
    selectedCoreProfile.cc /= selectedCoreProfile.conf;
    selectedCoreProfile.tempo /= selectedCoreProfile.conf;
  }

  const selectedShape = teamShape(selected);
  const selectedDamage = selected.reduce((sum, character) => sum + (isLowDamageContributor(character) ? -0.35 : isHighDamageContributor(character) ? 0.7 : isReliableDps(character) ? 0.45 : 0), 0)
    + selectedCoreProfile.damage * 0.55
    - selectedCoreProfile.support * 0.18;
  const selectedCc = teamCcPower(selected) + selectedCoreProfile.cc * 0.85;
  const selectedHasFront = selected.some((character) => isFrontRole(character) || isTank(character));
  const selectedHasBackline = selected.some(isBacklineDealer);
  const selectedHasSupport = selected.some(isSupport) || selectedCoreProfile.support >= 0.62;
  const candidateIsPrimaryDps = isMeleeDealer(candidate) || isBacklineDealer(candidate);
  const candidateCanFront = isFrontRole(candidate) || isTank(candidate);

  let score = 0;
  const conf = Math.min(1, Math.log10(row.games + 1) / 2.7);

  if (selected.length === 0) {
    score += profile.damage * 0.22 + profile.durability * 0.12 + profile.support * 0.08 + profile.cc * 0.10;
    return clamp(score * conf, -0.45, 0.65);
  }

  const needsDamage = selectedShape.reliableDps < 1 || selectedDamage < 0.35;
  const needsFront = !selectedHasFront && selected.length >= 1;
  const needsPeel = selectedHasBackline && !selectedHasSupport && selectedCc < 2.1;
  const needsCc = selectedCc < 1.6;

  if (needsDamage) {
    score += profile.damage * 0.85;
    if (candidateCanFront && profile.damage >= 0.55) score += 0.28;
    if (isSupport(candidate) && profile.support >= 0.65 && profile.damage < 0.35) score -= 0.42;
  } else if (profile.damage >= 0.70) {
    score += 0.22;
  }

  if (needsFront) {
    score += profile.durability * 0.58;
    if (candidateCanFront) score += 0.18;
    if (!candidateCanFront && profile.durability < 0.35) score -= 0.18;
  }

  if (needsPeel) {
    score += profile.support * 0.55 + profile.cc * 0.25;
    if (isSupport(candidate)) score += 0.20;
  }

  if (needsCc) {
    score += profile.cc * 0.45;
    if (ccPower(candidate) >= 1.4) score += 0.18;
  }

  if (candidateIsPrimaryDps && profile.support >= 0.65 && profile.damage < 0.30 && needsDamage) score -= 0.48;
  if (isTank(candidate) && profile.damage >= 0.60 && selectedShape.reliableDps < 2) score += 0.32;
  if (isSupport(candidate) && profile.damage >= 0.45 && selectedShape.reliableDps < 2) score += 0.30;
  if (profile.tempo >= 0.55 && selected.some((character) => character.tags.includes("dive") || character.tags.includes("initiate"))) score += 0.18;
  if (selectedCoreProfile.damage >= 0.65 && (profile.support >= 0.45 || profile.cc >= 0.45 || profile.durability >= 0.55)) score += 0.20;
  if (selectedCoreProfile.support >= 0.60 && profile.damage >= 0.55) score += 0.22;
  if (selectedCoreProfile.durability >= 0.60 && profile.damage >= 0.55 && !needsDamage) score += 0.14;
  if (selectedCoreProfile.tempo >= 0.55 && profile.tempo >= 0.45) score += 0.12;

  // Continuous interaction: selected teammate cores can change what kind of
  // third pick is valuable, even when the base character role is unchanged.
  const selectedOffense = selectedCoreProfile.damage + selectedCoreProfile.tempo * 0.35;
  const selectedStability = selectedCoreProfile.durability + selectedCoreProfile.support * 0.45 + selectedCoreProfile.cc * 0.25;
  score += (selectedOffense - 0.55) * (profile.support * 0.30 + profile.durability * 0.24 + profile.cc * 0.18 - profile.damage * 0.14);
  score += (selectedCoreProfile.support - 0.28) * profile.damage * 0.35;
  score += (selectedCoreProfile.durability - 0.38) * profile.damage * 0.22;
  score += (selectedCoreProfile.cc - 0.24) * (profile.tempo * 0.18 + profile.damage * 0.10);
  score += (selectedStability - 0.65) * profile.damage * 0.18;

  return clamp(score * conf, -0.95, 1.25);
}

function feedbackCandidateId(candidate, coreRow = null) {
  return coreRow?.core ? `${candidate.variantId}#${coreRow.core}` : candidate.variantId;
}

function buildCandidateInvariantContext(selectedIds, selected, candidate, tier, remoteFeedback, relationshipRows) {
  return {
    selected,
    candidate,
    scores: {
      synergy: pairScore(candidate, selected),
      dakComposition: dakCompositionScore(candidate, selected),
      tournamentComposition: tournamentCompositionScore(candidate, selected),
      tournamentArchetype: tournamentArchetypeScore(candidate, selected),
      dakTier: dakTierScore(candidate, tier),
      dakStatistics: dakStatisticsScore(candidate, tier),
      dakRealtime: dakRealtimeScore(candidate),
      officialMeta: officialMetaScore(candidate, tier),
      legacyMeta: legacyDakMetaScore(candidate, tier),
      meta: combinedMetaScore(candidate, tier),
      officialMatch: officialMatchScore(candidate, selected, tier),
      officialV2: officialV2Score(candidate, selected, tier),
      relationship: relationshipScore(candidate, selected, tier, relationshipRows),
    },
  };
}

export function evaluateCandidate(selectedIds, candidateId, tier = "all", remoteFeedback = {}, relationshipRows = [], cores = {}, invariantContext = null) {
  const selected = invariantContext?.selected ?? selectedCharactersFromIds(selectedIds);
  const candidate = invariantContext?.candidate ?? characterVariants.find((character) => character.variantId === candidateId);
  if (!candidate) return undefined;
  const candidateCoreRow = coreRowFor(candidate.variantId, cores[candidate.variantId], tier);
  const effectiveSelected = effectiveTeamFor(selected, cores, tier);
  const effectiveCandidate = applyCoreRoleProfile(candidate, cores[candidate.variantId], tier);
  const invariantScores = invariantContext?.scores ?? buildCandidateInvariantContext(selectedIds, selected, candidate, tier, remoteFeedback, relationshipRows).scores;
  const candidateFeedbackId = feedbackCandidateId(candidate, candidateCoreRow);
  const feedbackScore = (
    getFeedbackScore(selectedIds, candidateFeedbackId, tier) +
    getFeedbackScore(selectedIds, candidateFeedbackId, tier, remoteFeedback) * 0.7
  );

  const scores = {
    ...invariantScores,
    coverage: coverageScore(effectiveCandidate, effectiveSelected),
    roleBalance: roleBalanceScore(effectiveCandidate, effectiveSelected),
    frontDamage: frontDamageScore(effectiveCandidate, effectiveSelected),
    backlineDamage: backlineDamageScore(effectiveCandidate, effectiveSelected),
    teamDamageBudget: teamDamageBudgetScore(effectiveCandidate, effectiveSelected),
    metricBalance: metricBalanceScore(effectiveCandidate, effectiveSelected),
    killPressure: killPressureScore(effectiveCandidate, effectiveSelected),
    weaponBalance: weaponBalanceScore(effectiveCandidate, effectiveSelected),
    teamShape: teamShapeScore(effectiveCandidate, effectiveSelected),
    conflict: conflictScore(effectiveCandidate, effectiveSelected),
    compositionGuide: compositionGuideScore(effectiveCandidate, effectiveSelected),
    officialCore:  officialCoreScore(candidate, tier, cores),
    officialCoreFit: officialCoreFitScore(effectiveCandidate, effectiveSelected, tier, cores),
    officialCoreRoleShift: officialCoreRoleShiftScore(effectiveCandidate, effectiveSelected, tier, cores),
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
    scores.dakComposition * 0.35 +
    scores.tournamentComposition * 0.5 +
    scores.tournamentArchetype * 0.4 +
    scores.meta +
    scores.officialMatch * 0.35 +
    scores.officialV2 * 0.35 +
    scores.officialCore * 0.35 +
    scores.officialCoreFit * 0.2 +
    scores.officialCoreRoleShift * 0.2 +
    scores.relationship -
    candidate.difficulty * 0.08 +
    feedbackScore;

  return {
    character: candidate,
    score: Number(total.toFixed(1)),
    total: Number(total.toFixed(3)),
    scores,
    feedbackCandidateId: candidateFeedbackId,
    recommendedCore: candidateCoreRow
      ? {
          core: candidateCoreRow.core,
          name: normalizeCoreName(candidateCoreRow) ?? candidateCoreRow.name ?? null,
          games: candidateCoreRow.games ?? 0,
        }
      : null,
    reasons: explain(effectiveCandidate, effectiveSelected, scores),
  };
}

export function debugCoreRoleProfile(selectedIds = [], cores = {}, tier = "all") {
  const selected = selectedCharactersFromIds(selectedIds);
  const effective = effectiveTeamFor(selected, cores, tier);
  return {
    tier,
    characters: effective.map((character) => ({
      variantId: character.variantId,
      role: character.role,
      damage: character.damage,
      frontDamage: character.frontDamage,
      backlineDamage: character.backlineDamage,
      tags: character.tags,
      effectiveCore: character.effectiveCore ?? null,
    })),
    shape: teamShape(effective),
  };
}

// Audit harness: sweep every variant × its plausible cores and report every case where the
// core inference changes the character's role, damage bucket, or tags. Run locally to review
// the full surface of role flips (not just one character) before/after tuning the thresholds.
export function auditCoreRoleFlips(tier = "all", { roleChangesOnly = false } = {}) {
  const flips = [];
  for (const character of characterVariants) {
    const options = candidateCoreOptions(character.variantId, tier, {});
    for (const core of options) {
      if (!core) continue;
      const effective = applyCoreRoleProfile(character, core, tier);
      const roleChanged = effective.role !== character.role;
      const frontChanged = effective.frontDamage !== character.frontDamage;
      const backChanged = effective.backlineDamage !== character.backlineDamage;
      const added = effective.tags.filter((tag) => !character.tags.includes(tag));
      const removed = character.tags.filter((tag) => !effective.tags.includes(tag));
      const tagChanged = added.length > 0 || removed.length > 0;
      if (!roleChanged && !frontChanged && !backChanged && !tagChanged) continue;
      if (roleChangesOnly && !roleChanged) continue;
      flips.push({
        variantId: character.variantId,
        coreName: effective.effectiveCore?.name ?? core,
        baseRole: character.role,
        role: effective.role,
        roleChanged,
        frontDamage: frontChanged ? `${character.frontDamage}->${effective.frontDamage}` : effective.frontDamage,
        backlineDamage: backChanged ? `${character.backlineDamage}->${effective.backlineDamage}` : effective.backlineDamage,
        addedTags: added,
        removedTags: removed,
      });
    }
  }
  return flips.sort((a, b) => Number(b.roleChanged) - Number(a.roleChanged));
}

// 벡터 표현 계층 공개 (진단 스크립트/외부 도구용).
export { characterVector, teamVector, VECTOR_SCORING_FLAGS };

// 진단: 특성(코어)에 따라 역할이 달라질 수 있는 캐릭터들의 core별 effectiveRole + vector 출력.
// filters: characterId / variantId 접두 / 이름 부분일치 중 아무거나.
export function auditCharacterVectors(filters = [], tier = "all") {
  const matches = (character) =>
    filters.length === 0 ||
    filters.some((f) =>
      character.characterId === f ||
      String(character.variantId).startsWith(f) ||
      (character.name && character.name.includes(f)));

  const out = [];
  for (const character of characterVariants) {
    if (!matches(character)) continue;
    const options = candidateCoreOptions(character.variantId, tier, {});
    const cores = [];
    for (const core of options) {
      const eff = applyCoreRoleProfile(character, core, tier);
      const vector = characterVector(character, core, tier);
      cores.push({
        core: eff.effectiveCore?.name ?? core ?? "default",
        code: eff.effectiveCore?.core ?? null,
        baseRole: character.role,
        effectiveRole: eff.role,
        roleChanged: eff.role !== character.role,
        frontDamage: eff.frontDamage ?? null,
        backlineDamage: eff.backlineDamage ?? null,
        vector,
      });
    }
    out.push({ variantId: character.variantId, name: character.name, baseRole: character.role, cores });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 추천 다양성 후처리 (점수식 무수정 — 순위 재배열만)
//
// 문제: full-vector 점수는 변해도 Top12가 하나의 승리 플랜(예: control_mage/backline_dps)
// 으로 쏠린다. 해법: 후보를 recommendation archetype 으로 분류하고, 같은 archetype 이
// 상위권을 과점하지 않도록 soft cap 으로 재배열한다. 단 점수가 크게 낮은 후보를 억지로
// 끌어올리지 않는다(점수차 한도 내에서만 승급).
// ─────────────────────────────────────────────────────────────────────────────

const DIVERSITY_CONFIG = {
  enabled: true,
  top6PerArchetype: 2,          // Top6 내 동일 archetype 최대 2
  top12PerArchetype: 3,         // Top12 내 동일 archetype 최대 3
  maxScoreDropToPromote: 1.5,   // 다양성으로 승급 시 허용하는 최대 점수차(밀려나는 후보 대비)
};

// 후보를 승리 플랜(archetype)으로 분류. 캐릭터 기본 속성만 사용(팀 무관, 결정적).
function recommendationArchetype(character) {
  if (!character) return "backline_dps";
  const tags = character.tags ?? [];
  const has = (t) => tags.includes(t);
  const cc = character.ccProfile ?? {};
  const ccArea = (cc.wide ?? 0) + (cc.medium ?? 0);
  const ccTotal = ccArea + (cc.targeted ?? 0) + (cc.nonTarget ?? 0) + (cc.single ?? 0) + (cc.narrow ?? 0) + (cc.veryNarrow ?? 0);

  // 서포트/유틸
  if (character.role === "support" || has("healing") || has("shield") || has("speedBoost") ||
      (has("peel") && character.role !== "frontline")) return "support_utility";
  // 전열 안정화 (탱커)
  if (character.role === "frontline") return "frontline_stabilizer";
  // 근접 다이브 / 템포
  if (character.role === "assassin" || character.role === "bruiser") {
    return (has("dive") || has("mobility")) ? "third_melee_dive" : "tempo_skirmisher";
  }
  // 후방 (ranged/mage)
  if (isBacklineDealer(character)) {
    if (has("range") && !has("short_range_dealer") && (character.damage === "basic" || has("sustained"))) return "long_range_carry";
    if (character.role === "mage" && (has("cc") || ccArea >= 2 || ccTotal >= 3)) return "control_mage";
    if (has("poke") || has("burst")) return "burst_poke";
    return "backline_dps";
  }
  return "backline_dps";
}

// 정렬된(내림차순) 추천 리스트를 archetype soft-cap 으로 재배열.
// cap 초과 시, 점수차가 maxScoreDropToPromote 이내인 다른 archetype 후보를 우선 승급.
// 적합한 승급 후보가 없으면(=다 너무 낮으면) 원래 후보를 그대로 둠(억지 승급 금지).
function diversifyRecommendations(sortedResults, config = DIVERSITY_CONFIG) {
  if (!config?.enabled || sortedResults.length <= 2) return sortedResults;
  const { top6PerArchetype, top12PerArchetype, maxScoreDropToPromote } = config;
  const capAt = (pos) => (pos < 6 ? top6PerArchetype : pos < 12 ? top12PerArchetype : Infinity);
  const arche = (r) => recommendationArchetype(r.character);

  const pool = [...sortedResults];
  const result = [];
  const counts = {};

  while (pool.length) {
    const pos = result.length;
    const cap = capAt(pos);
    const head = pool[0];
    let pickIdx = 0;

    if ((counts[arche(head)] ?? 0) >= cap) {
      // head 의 archetype 이 cap 초과 → 점수차 한도 내에서 다른 archetype 후보 탐색
      for (let i = 1; i < pool.length; i++) {
        if (head.total - pool[i].total > maxScoreDropToPromote) break; // 더 내려가도 다 너무 낮음
        if ((counts[arche(pool[i])] ?? 0) < cap) { pickIdx = i; break; }
      }
      // 적합한 대안 없으면 pickIdx 0 유지(원래 후보 채택 — 억지로 끌어올리지 않음)
    }

    const [picked] = pool.splice(pickIdx, 1);
    counts[arche(picked)] = (counts[arche(picked)] ?? 0) + 1;
    result.push(picked);
  }
  return result;
}

export { recommendationArchetype, diversifyRecommendations, DIVERSITY_CONFIG };

export function recommend(selectedIds, tier = "all", remoteFeedback = {}, candidateCharacterIds = undefined, relationshipRows = [], cores = {}) {
  const selected = selectedCharactersFromIds(selectedIds);

  const selectedCharacters = new Set(selected.map((character) => character.characterId));
  const candidatePool = candidateCharacterIds?.length ? new Set(candidateCharacterIds) : undefined;
  const candidateUsesVariants = candidateCharacterIds?.some((id) => String(id).includes(":")) ?? false;

  const scored = characterVariants
    .filter((candidate) => !selectedCharacters.has(candidate.characterId))
    .filter((candidate) => !candidatePool || candidatePool.has(candidateUsesVariants ? candidate.variantId : candidate.characterId))
    .flatMap((candidate) => {
      const options = candidateCoreOptions(candidate.variantId, tier, cores);
      const invariantContext = buildCandidateInvariantContext(selectedIds, selected, candidate, tier, remoteFeedback, relationshipRows);
      return options
        .map((core) => evaluateCandidate(
          selectedIds,
          candidate.variantId,
          tier,
          remoteFeedback,
          relationshipRows,
          core ? { ...cores, [candidate.variantId]: core } : cores,
          invariantContext,
        ))
        .filter(Boolean);
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);

  const seen = new Set();
  const deduped = scored.filter((r) => {
    const buildId = `${r.character.variantId}:${r.recommendedCore?.core ?? "default"}`;
    if (seen.has(buildId)) return false;
    seen.add(buildId);
    return true;
  });

  // 점수식은 그대로. 다양성 후처리로 archetype 과점만 완화한 뒤 상위 노출.
  return diversifyRecommendations(deduped).slice(0, 18);
}
