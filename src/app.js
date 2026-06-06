import { characterVariants, roleNames, roles } from "./data.js";
import {
  feedbackWindowKey,
  getFeedbackEntry,
  hasRecentFeedback,
  loadPendingRemoteFeedback,
  markRecentFeedback,
  queueRemoteFeedback,
  recordFeedback,
  recoverLocalFeedbackToPendingQueue,
  removePendingRemoteFeedback,
  updatePendingRemoteFeedback,
} from "./feedback.js";
import { matchesKoreanSearch } from "./koreanSearch.js";
import { rankerCandidateStats, rankerCompositionStats } from "./metaData.js";
import { evaluateCandidate, recommend } from "./recommender.js";
import { teamMetricProfile, teamMetricTags } from "./characterMetrics.js";
import {
  helpsMeleeEngage,
  isCounterOnlyRanged,
  isFirstEngageStyle,
  isGuardOnly,
  isPokeThenEngage,
  likesDiveFollow,
} from "./combatProfiles.js";
import { applyTranslations, hasStoredLanguage, setLanguage, t } from "./i18n/index.js";
import { loadPopularFeedback, loadRemoteFeedback, recordRemoteFeedback, submitContactMessage } from "./supabaseFeedback.js";
import { appVersion, releaseConfig } from "./updateConfig.js";

const selectedIds = new Set();
let activeRole = "all";
let activeRankRole = "all";

const characterGrid = document.querySelector("#character-grid");
const selectedTeam = document.querySelector("#selected-team");
const matchFeedback = document.querySelector("#match-feedback");
const recommendations = document.querySelector("#recommendations");
const recommendTitle = document.querySelector("#recommend-section h2");
const selectedCount = document.querySelector("#selected-count");
const clearButton = document.querySelector("#clear-button");
const searchInput = document.querySelector("#search-input");
const roleFilters = document.querySelector("#role-filters");
const detectedTeam = document.querySelector("#detected-team");
const tierSelect = document.querySelector("#tier-select");
const syncStatus = document.querySelector("#sync-status");
const manualSlots = document.querySelector("#manual-slots");
const themeToggle = document.querySelector("#theme-toggle");
const playableModeButton = document.querySelector("#playable-mode-button");
const clearPlayableButton = document.querySelector("#clear-playable-button");
const playableStatus = document.querySelector("#playable-status");
const presetNameInput = document.querySelector("#playable-preset-name");
const presetSelect = document.querySelector("#playable-preset-select");
const savePresetButton = document.querySelector("#save-playable-preset-button");
const loadPresetButton = document.querySelector("#load-playable-preset-button");
const deletePresetButton = document.querySelector("#delete-playable-preset-button");
const contactOpenButton = document.querySelector("#contact-open-button");
const contactModal = document.querySelector("#contact-modal");
const contactForm = document.querySelector("#contact-form");
const contactReply = document.querySelector("#contact-reply");
const contactMessage = document.querySelector("#contact-message");
const contactStatus = document.querySelector("#contact-status");
const updateCheckButton = document.querySelector("#update-check-button");
const updateStatus = document.querySelector("#update-status");
const appMain = document.querySelector(".app-main");
const sideTabs = document.querySelectorAll("[data-view]");
const topbarEyebrow = document.querySelector(".topbar .eyebrow");
const topbarTitle = document.querySelector(".topbar h1");
const unionPlayerGrid = document.querySelector("#union-player-grid");
const unionCharacterGrid = document.querySelector("#union-character-grid");
const unionRoleFilters = document.querySelector("#union-role-filters");
const unionSearchInput = document.querySelector("#union-search-input");
const unionResults = document.querySelector("#union-results");
const unionSummary = document.querySelector("#union-summary");
const unionClearButton = document.querySelector("#union-clear-button");
const languageGate = document.querySelector("#language-gate");

let activeSlot = null;
let recentlyAssignedVariantId = null;
let remoteFeedback = {};
let popularFeedback = [];
let isRefreshingRemote = false;
let isRefreshingPopular = false;
let isFlushingPendingFeedback = false;
let popularFeedbackLoaded = false;
let lastRemoteFeedbackKey = "";
let lastPromptedUpdateVersion = null;
let chosenPickId = null;
const submittedFeedbackKeys = new Set();
const slotAssignments = [null, null, null];
const savedTheme = localStorage.getItem("er-team-picker-theme");
const legacyPlayableStorageKey = "er-team-picker-playable-characters";
const playableStorageKey = "er-team-picker-playable-variants";
const presetStorageKey = "er-team-picker-playable-presets";
const unionStorageKey = "er-team-picker-union-rosters";
const savedPlayableVariants = JSON.parse(localStorage.getItem(playableStorageKey) ?? "[]");
const savedPlayableCharacters = JSON.parse(localStorage.getItem(legacyPlayableStorageKey) ?? "[]");
const playableVariantIds = new Set(savedPlayableVariants.length > 0
  ? savedPlayableVariants
  : characterVariants
    .filter((character) => savedPlayableCharacters.includes(character.characterId))
    .map((character) => character.variantId));
let playableEditMode = false;
let playablePresets = JSON.parse(localStorage.getItem(presetStorageKey) ?? "[]");
let activeView = appMain?.dataset.view ?? "setup";
let activeUnionPlayer = 0;
let activeUnionRole = "all";
const unionPlayerNames = [1,2,3,4].map(n => t("player.name", { n }));
const unionParticipatingPlayers = new Set([0, 1, 2]);
const savedUnionRosters = JSON.parse(localStorage.getItem(unionStorageKey) ?? "[]");
const unionRosters = Array.from({ length: 4 }, (_, index) => new Set(savedUnionRosters[index] ?? []));

applyTranslations();
if (!hasStoredLanguage()) {
  languageGate.hidden = false;
}

languageGate?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-language-option]");
  if (!button) return;
  setLanguage(button.dataset.languageOption);
  applyTranslations();
  languageGate.hidden = true;
  render();
});

function characterName(characterId) {
  const found = characterVariants.find((c) => c.characterId === characterId);
  return found ? t(`char.${found.id}`) : characterId;
}

function characterById(characterId) {
  return characterVariants.find((character) => character.characterId === characterId);
}

function characterRolesById(characterId) {
  return [...new Set(characterVariants
    .filter((character) => character.characterId === characterId)
    .map((character) => character.role))];
}

function characterBrief(characterId) {
  const character = characterById(characterId);
  if (!character) return { name: characterId, image: "", role: "", weapon: "" };
  return {
    name: t(`char.${character.id}`),
    image: character.image,
    role: t(`role.${character.role}`),
    weapon: t(`weapon.${character.weapon}`),
  };
}

function characterSubtitle(character) {
  return [t(`role.${character.role}`), t(`weapon.${character.weapon}`), character.weaponStyle].filter(Boolean).join(" · ");
}

function compactReasonLabels(reasons = []) {
  const joined = reasons.join(" ");
  const labels = [];
  const add = (label) => {
    if (!labels.includes(label)) labels.push(label);
  };

  if (/앞라인|탱커|진입|받아치/.test(joined)) add(t("compact.frontlineNeeded"));
  if (/마무리|킬캐치|화력|데미지|딜러 자리/.test(joined)) add(/부족|모자|감점/.test(joined) ? t("compact.damageLow") : t("compact.damageNeeded"));
  if (/CC|이니시|교전 시작|진입각/.test(joined)) add(t("compact.initiateNeeded"));
  if (/보호|세이브|받아치|안정/.test(joined)) add(t("compact.peelNeeded"));
  if (/사거리|포킹|대치/.test(joined)) add(t("compact.pokeNeeded"));
  if (/데미지 기여가 충분|화력을 보탤|화력을 채워/.test(joined)) add(t("compact.damageOk"));
  if (/데미지 기여가 부족|화력 총량이 부족|화력이 부족/.test(joined)) add(t("compact.damageCaution"));
  if (/평가 데이터|좋게 기록|랭커|전적/.test(joined)) add(t("compact.dataOk"));
  if (/감점|낮게 잡힐|위험/.test(joined)) add(t("compact.caution"));

  return labels.slice(0, 3);
}

function compactReasonText(reasons = []) {
  const labels = compactReasonLabels(reasons);
  if (labels.length > 0) return labels.join(" · ");
  return t("recommend.stageBody");
}

function recommendationStageNotice() {
  if (selectedIds.size !== 1) return "";

  return `
    <div class="recommendation-stage-notice">
      <strong>${t("recommend.stageTitle")}</strong>
      <span>${t("recommend.stageBody")}</span>
    </div>
  `;
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("er-team-picker-theme", nextTheme);
  themeToggle.textContent = nextTheme === "dark" ? t("button.darkMode") : t("button.lightMode");
  themeToggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
}

setTheme(savedTheme ?? "dark");


function openContactModal() {
  contactModal.hidden = false;
  contactStatus.textContent = "";
  contactMessage.focus();
}

function closeContactModal() {
  contactModal.hidden = true;
  contactStatus.textContent = "";
}

function normalizeVersion(version) {
  return String(version ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function releaseInstallerUrl(release) {
  const asset = release.assets?.find((item) => releaseConfig.installerPattern.test(item.name));
  return asset?.browser_download_url ?? release.html_url;
}

function renderUpdateAvailable(release, latestVersion) {
  const installerUrl = releaseInstallerUrl(release);
  updateStatus.innerHTML = `
    <strong>${t("update.new", { version: latestVersion })}</strong>
    <a href="${installerUrl}" target="_blank" rel="noreferrer">${t("update.install")}</a>
    <small>${t("update.installNote")}</small>
  `;
  return installerUrl;
}

async function checkForUpdates({ prompt = false, silent = false } = {}) {
  if (!silent) {
    updateCheckButton.disabled = true;
    updateStatus.innerHTML = t("update.checking");
  }
  try {
    const release = await fetchLatestRelease();
    const latestVersion = release.tag_name ?? release.name ?? "";
    if (compareVersions(latestVersion, appVersion) <= 0) {
      if (!silent) updateStatus.innerHTML = `${t("update.latest")} <small>v${appVersion}</small>`;
      return false;
    }

    const installerUrl = renderUpdateAvailable(release, latestVersion);
    if (prompt && latestVersion !== lastPromptedUpdateVersion) {
      lastPromptedUpdateVersion = latestVersion;
      const wantsUpdate = window.confirm(t("update.confirm", { current: appVersion, latest: latestVersion }));
      if (wantsUpdate) window.open(installerUrl, "_blank", "noopener,noreferrer");
    }
    return true;
  } catch (error) {
    if (!silent) updateStatus.innerHTML = `${t("update.failed")} <small>${error.message ?? t("update.failedNetwork")}</small>`;
    return false;
  } finally {
    updateCheckButton.disabled = false;
  }
}

async function fetchLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${releaseConfig.owner}/${releaseConfig.repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(t("update.apiError", { status: response.status }));
  return response.json();
}

async function checkForUpdatesOnStartup() {
  await checkForUpdates({ prompt: true, silent: true });
}

function startPeriodicUpdateChecks() {
  window.setInterval(() => {
    checkForUpdates({ prompt: true, silent: true });
  }, 60 * 60 * 1000);
}

function startPeriodicPendingFeedbackSync() {
  window.setInterval(() => {
    flushPendingRemoteFeedback().then((remaining) => {
      if (remaining > 0) {
        syncStatus.textContent = t("sync.pending", { count: remaining });
        syncStatus.dataset.state = "error";
      }
    });
  }, 10 * 60 * 1000);
}
function renderRoleFilters() {
  const filters = [{ id: "all" }, ...roles];
  roleFilters.innerHTML = filters
    .map((role) => {
      const pressed = role.id === activeRole ? "true" : "false";
      return `<button class="filter-button" type="button" data-role="${role.id}" aria-pressed="${pressed}">${t(`role.${role.id}`)}</button>`;
    })
    .join("");
}

function renderCharacters({ preserveScroll = true } = {}) {
  const previousScrollTop = characterGrid.scrollTop;
  const query = searchInput.value.trim().toLowerCase();
  const filtered = characterVariants.filter((character) => {
    const matchesRole = activeRole === "all" || character.role === activeRole;
    const matchesQuery = matchesKoreanSearch(character.name, query) || character.id.toLowerCase().includes(query) || t(`char.${character.id}`).toLowerCase().includes(query);
    return matchesRole && matchesQuery;
  });

  characterGrid.innerHTML = filtered
    .map((character) => {
      const selected = selectedIds.has(character.variantId) || chosenPickId === character.variantId;
      const playable = playableVariantIds.has(character.variantId);
      const popClass = character.variantId === recentlyAssignedVariantId ? " pick-pop" : "";
      return `
        <button class="character-card${popClass}" type="button" data-id="${character.variantId}" data-playable="${playable}" aria-pressed="${selected}">
          <span class="avatar">
            <img src="${character.image}" alt="" loading="lazy" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
            <span hidden>${t(`char.${character.id}`).slice(0, 1)}</span>
          </span>
          <span class="character-info">
            <strong>${t(`char.${character.id}`)}</strong>
            <small>${characterSubtitle(character)}</small>
          </span>
          ${playable ? `<span class="playable-mark">${t("playable.mark")}</span>` : ""}
        </button>
      `;
    })
    .join("");
  if (preserveScroll) characterGrid.scrollTop = previousScrollTop;
}

function markRecentlyAssigned(id) {
  recentlyAssignedVariantId = id;
  window.setTimeout(() => {
    if (recentlyAssignedVariantId === id) {
      recentlyAssignedVariantId = null;
      characterGrid.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.remove("pick-pop");
    }
  }, 260);
}

function toggleDetailsSummary(event) {
  if (!(event.target instanceof Element)) return false;
  const summary = event.target.closest(".recommendation-details summary");
  if (!summary) return false;

  const details = summary.closest("details");
  if (!details) return false;
  event.preventDefault();
  event.stopPropagation();
  details.open = !details.open;
  return true;
}

function renderUnionRoleFilters() {
  const filters = [{ id: "all" }, ...roles];
  unionRoleFilters.innerHTML = filters
    .map((role) => {
      const pressed = role.id === activeUnionRole ? "true" : "false";
      return `<button class="filter-button" type="button" data-union-role="${role.id}" aria-pressed="${pressed}">${t(`role.${role.id}`)}</button>`;
    })
    .join("");
}

function unionRosterLabel(index) {
  const count = unionRosters[index].size;
  return count > 0 ? t("union.rosterCount", { count }) : t("union.rosterEmpty");
}

function saveUnionRosters() {
  localStorage.setItem(unionStorageKey, JSON.stringify(unionRosters.map((roster) => [...roster])));
}

function unionRosterPlayers() {
  return unionPlayerNames.map((_, index) => index).filter((index) => unionRosters[index].size > 0);
}

function activeUnionPlayers() {
  const rosterPlayers = unionRosterPlayers();
  if (rosterPlayers.length <= 3) return rosterPlayers;
  return [...unionParticipatingPlayers]
    .filter((player) => rosterPlayers.includes(player))
    .sort((a, b) => a - b);
}

function normalizeUnionPlayers() {
  const rosterPlayers = unionRosterPlayers();
  if (rosterPlayers.length <= 3) {
    unionParticipatingPlayers.clear();
    rosterPlayers.forEach((player) => unionParticipatingPlayers.add(player));
    return;
  }

  [...unionParticipatingPlayers].forEach((player) => {
    if (!rosterPlayers.includes(player)) unionParticipatingPlayers.delete(player);
  });
  rosterPlayers.forEach((player) => {
    if (unionParticipatingPlayers.size < 3) unionParticipatingPlayers.add(player);
  });
  while (unionParticipatingPlayers.size > 3) {
    unionParticipatingPlayers.delete([...unionParticipatingPlayers].sort((a, b) => b - a)[0]);
  }
}

function renderUnionPlayers() {
  normalizeUnionPlayers();
  const rosterPlayers = unionRosterPlayers();
  const needsSelection = rosterPlayers.length >= 4;
  unionPlayerGrid.dataset.memberCount = "4";
  unionPlayerGrid.innerHTML = unionPlayerNames.map((_, index) => index)
    .map((index) => {
      const name = unionPlayerNames[index];
      const active = activeUnionPlayer === index ? " active" : "";
      const participating = unionParticipatingPlayers.has(index);
      const hasRoster = unionRosters[index].size > 0;
      const participantControl = needsSelection && hasRoster
        ? `
          <label class="union-player-check">
            <input type="checkbox" data-union-participate="${index}" ${participating ? "checked" : ""}>
            <span>${t("union.participate")}</span>
          </label>
        `
        : `<span class="union-player-fixed">${hasRoster ? t("union.autoJoin") : t("union.noMember")}</span>`;
      return `
        <article class="union-player-card${active}${hasRoster ? "" : " empty"}${hasRoster && !participating ? " inactive" : ""}">
          ${participantControl}
          <button class="union-player-select" type="button" data-union-player="${index}">
            <strong>${name}</strong>
            <small>${unionRosterLabel(index)}</small>
          </button>
        </article>
      `;
    })
    .join("");
}

function renderUnionCharacters({ preserveScroll = true } = {}) {
  const previousScrollTop = unionCharacterGrid.scrollTop;
  const query = unionSearchInput.value.trim().toLowerCase();
  const currentRoster = unionRosters[activeUnionPlayer];
  const filtered = characterVariants.filter((character) => {
    const matchesRole = activeUnionRole === "all" || character.role === activeUnionRole;
    const matchesQuery = matchesKoreanSearch(character.name, query) || character.id.toLowerCase().includes(query) || t(`char.${character.id}`).toLowerCase().includes(query);
    return matchesRole && matchesQuery;
  });

  unionCharacterGrid.innerHTML = filtered
    .map((character) => {
      const selected = currentRoster.has(character.variantId);
      return `
        <button class="character-card union-character-card" type="button" data-union-pick="${character.variantId}" aria-pressed="${selected}">
          <span class="avatar">
            <img src="${character.image}" alt="" loading="lazy" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
            <span hidden>${t(`char.${character.id}`).slice(0, 1)}</span>
          </span>
          <span class="character-info">
            <strong>${t(`char.${character.id}`)}</strong>
            <small>${characterSubtitle(character)}</small>
          </span>
        </button>
      `;
    })
    .join("");
  if (preserveScroll) unionCharacterGrid.scrollTop = previousScrollTop;
}

function variantById(variantId) {
  return characterVariants.find((character) => character.variantId === variantId);
}

function unionComboScore(combo) {
  const [first, second, third] = combo;
  const evaluations = [
    evaluateCandidate([second.variantId, third.variantId], first.variantId, tierSelect.value, remoteFeedback, popularFeedback),
    evaluateCandidate([first.variantId, third.variantId], second.variantId, tierSelect.value, remoteFeedback, popularFeedback),
    evaluateCandidate([first.variantId, second.variantId], third.variantId, tierSelect.value, remoteFeedback, popularFeedback),
  ].filter(Boolean);
  const average = evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / evaluations.length;
  return {
    score: Number(average.toFixed(1)),
    reasons: evaluations
      .flatMap((evaluation) => evaluation.reasons)
      .filter((reason, index, reasons) => reasons.indexOf(reason) === index)
      .slice(0, 2),
  };
}

function unionComboReason(combo, reasons) {
  const rolesInCombo = new Set(combo.map((character) => character.role));
  const tags = new Set(combo.flatMap((character) => character.tags));
  const metricTags = teamMetricTags(combo);
  const backlineCount = combo.filter((character) => character.role === "ranged" || character.role === "mage").length;
  const meleeCount = combo.filter((character) => character.role === "bruiser" || character.role === "assassin" || character.role === "frontline").length;
  const hasInitiate = tags.has("initiate");
  const hasCc = tags.has("cc") || metricTags.includes("CC 강함");
  const hasPeel = tags.has("peel") || tags.has("shield") || tags.has("healing") || metricTags.includes("보조 능력 높음");
  const hasDamage = metricTags.includes("화력 충분");

  if (backlineCount === 3 && (hasCc || hasPeel) && hasDamage) {
    return t("union.reason.backlineCC");
  }
  if (meleeCount === 3 && hasInitiate && hasCc && hasDamage) {
    return t("union.reason.meleeInitiate");
  }
  if (rolesInCombo.has("frontline") && (rolesInCombo.has("ranged") || rolesInCombo.has("mage"))) {
    return t("union.reason.frontlineRanged");
  }
  if ((rolesInCombo.has("bruiser") || rolesInCombo.has("assassin")) && tags.has("focus")) {
    return t("union.reason.bruiserFocus");
  }
  if (hasInitiate && hasCc) {
    return t("union.reason.initiateCC");
  }
  if (metricTags.length > 0) {
    return t("union.reason.metricTags", { tags: metricTags.slice(0, 2).join(" · ") });
  }
  return reasons[0] ?? t("union.reason.default");
}
function unionComboPlan(combo) {
  const tags = new Set(combo.flatMap((character) => character.tags));
  const { total, average } = teamMetricProfile(combo);
  const backlineCount = combo.filter((character) => character.role === "ranged" || character.role === "mage").length;
  const meleeCount = combo.filter((character) => character.role === "bruiser" || character.role === "assassin" || character.role === "frontline").length;
  const tankCount = combo.filter((character) => character.role === "frontline").length;
  const supportCount = combo.filter((character) => character.role === "support").length;
  const hasLenox = combo.some((character) => character.characterId === "lenox");
  const hasCoreline = combo.some((character) => character.characterId === "coreline");
  const hasVanya = combo.some((character) => character.characterId === "vanya");
  const hasInitiate = tags.has("initiate") || total.crowdControl >= 9;
  const hasFocus = tags.has("focus") || tags.has("burst");
  const hasPeel = tags.has("peel") || tags.has("shield") || tags.has("healing") || total.utility >= 8;
  const hasZone = tags.has("zone") || tags.has("poke") || tags.has("range");
  const hasDive = tags.has("dive") || tags.has("mobility") || average.mobility >= 3.6;
  const hasObjective = tags.has("objective");
  const firstEngagers = combo.filter(isFirstEngageStyle);
  const rangedHelpers = combo.filter(helpsMeleeEngage);
  const diveFollowers = combo.filter(likesDiveFollow);
  const counterOnly = combo.filter(isCounterOnlyRanged);
  const pokeThenEngage = combo.filter(isPokeThenEngage);
  const guardOnly = combo.filter(isGuardOnly);

  if (firstEngagers.length >= 1 && meleeCount >= 2) {
    return t("union.plan.meleeEngage", { first: t(`char.${firstEngagers[0].id}`) });
  }
  if (firstEngagers.length >= 1 && rangedHelpers.length >= 1) {
    return t("union.plan.engageWithRanged", { first: t(`char.${firstEngagers[0].id}`), ranged: t(`char.${rangedHelpers[0].id}`) });
  }
  if (firstEngagers.length >= 1 && diveFollowers.length >= 1) {
    return t("union.plan.engageWithDive", { first: t(`char.${firstEngagers[0].id}`) });
  }
  if (guardOnly.length >= 1 && backlineCount >= 2) {
    return t("union.plan.guardBackline", { guard: t(`char.${guardOnly[0].id}`) });
  }
  if (counterOnly.length >= 2 || (counterOnly.length >= 1 && pokeThenEngage.length >= 1)) {
    return t("union.plan.counterOnly");
  }

  if (hasLenox && backlineCount >= 2) {
    return t("union.plan.lenoxGuard");
  }
  if (tankCount === 1 && meleeCount === 2 && backlineCount === 0) {
    return t("union.plan.tankMelee");
  }
  if (supportCount >= 1 && total.damage >= 10) {
    return t("union.plan.supportDamage");
  }
  if (hasCoreline && meleeCount >= 1) {
    return t("union.plan.corelineAssist");
  }
  if (hasVanya) {
    return t("union.plan.vanya");
  }
  if (meleeCount >= 2 && hasInitiate && hasFocus) {
    return t("union.plan.meleeInitiateCC");
  }
  if (meleeCount === 3 && hasDive) {
    return t("union.plan.meleeDive");
  }
  if (backlineCount === 3 && hasPeel) {
    return t("union.plan.backlinePeel");
  }
  if (backlineCount >= 2 && hasZone) {
    return t("union.plan.backlineZone");
  }
  if (hasObjective && hasZone) {
    return t("union.plan.objectiveZone");
  }
  if (hasInitiate && total.crowdControl >= 8) {
    return t("union.plan.initiateCC");
  }
  if (hasPeel && total.damage >= 10) {
    return t("union.plan.peelDamage");
  }
  if (average.mobility >= 3.6) {
    return t("union.plan.mobility");
  }
  return t("union.plan.default");
}

function buildUnionCombos() {
  normalizeUnionPlayers();
  const players = activeUnionPlayers();
  if (players.length !== 3) return [];
  if (players.some((player) => unionRosters[player].size === 0)) return [];

  const rosters = players.map((player) => [...unionRosters[player]].map(variantById).filter(Boolean));
  const combos = [];
  let checked = 0;
  const maxChecks = 16000;

  for (const first of rosters[0]) {
    for (const second of rosters[1]) {
      for (const third of rosters[2]) {
        checked += 1;
        if (checked > maxChecks) break;
        const uniqueCharacters = new Set([first.characterId, second.characterId, third.characterId]);
        if (uniqueCharacters.size < 3) continue;
        const scoreInfo = unionComboScore([first, second, third]);
        combos.push({ players, combo: [first, second, third], ...scoreInfo });
      }
      if (checked > maxChecks) break;
    }
    if (checked > maxChecks) break;
  }

  return combos.sort((a, b) => b.score - a.score).slice(0, 24);
}

function renderUnionResults() {
  normalizeUnionPlayers();
  const rosterPlayers = unionRosterPlayers();
  const players = activeUnionPlayers();
  if (rosterPlayers.length < 3) {
    unionSummary.textContent = t("union.registered", { count: rosterPlayers.length });
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("union.minPlayers")}</strong>
        <span>${t("union.minPlayersDesc")}</span>
      </div>
    `;
    return;
  }

  if (players.length !== 3) {
    unionSummary.textContent = t("union.players", { count: players.length });
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("union.selectPlayers")}</strong>
        <span>${t("union.selectPlayersDesc")}</span>
      </div>
    `;
    return;
  }

  const emptyPlayer = players.find((player) => unionRosters[player].size === 0);
  if (emptyPlayer !== undefined) {
    unionSummary.textContent = t("union.waiting");
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("union.emptyRoster", { name: unionPlayerNames[emptyPlayer] })}</strong>
        <span>${t("union.emptyRosterDesc")}</span>
      </div>
    `;
    return;
  }

  const combos = buildUnionCombos();
  unionSummary.textContent = t("union.comboCount", { count: combos.length });
  if (combos.length === 0) {
    unionResults.innerHTML = `<p class="empty-state">${t("union.noCombo")}</p>`;
    return;
  }

  unionResults.innerHTML = combos
    .map((item, index) => {
      const scoreTone = item.score < 0 ? " negative-score" : "";
      return `
        <article class="union-combo-card">
          <div class="combo-card-head">
            <span class="recommendation-rank">${t("union.comboLabel", { index: index + 1 })}</span>
            <strong class="score${scoreTone}">${item.score}</strong>
          </div>
          <div class="union-combo-members">
            ${item.combo
              .map((character, memberIndex) => `
                <span class="combo-face">
                  <img src="${character.image}" alt="">
                  <span>
                    <strong>${t(`char.${character.id}`)}</strong>
                    <small>${t(`weapon.${character.weapon}`)}</small>
                  </span>
                </span>
              `)
              .join("")}
          </div>
          <p>${unionComboPlan(item.combo)}</p>
        </article>
      `;
    })
    .join("");
}

function renderUnion() {
  renderUnionPlayers();
  renderUnionRoleFilters();
  renderUnionCharacters();
  renderUnionResults();
}

function savePlayableCharacters() {
  localStorage.setItem(playableStorageKey, JSON.stringify([...playableVariantIds]));
}

function savePresetsToStorage() {
  localStorage.setItem(presetStorageKey, JSON.stringify(playablePresets));
}

function renderPresetSelect() {
  const currentValue = presetSelect.value;
  // 기존 동적 option만 제거 (value="" 인 기본 option 유지)
  while (presetSelect.options.length > 1) {
    presetSelect.remove(1);
  }
  playablePresets.forEach((preset, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = preset.name;
    presetSelect.appendChild(opt);
  });
  // 이전 선택 복원 시도
  presetSelect.value = currentValue;
  if (presetSelect.value !== currentValue) presetSelect.value = "";
  loadPresetButton.disabled = presetSelect.value === "";
  deletePresetButton.disabled = presetSelect.value === "";
}

function getAutoPresetName() {
  let n = 1;
  const existingNames = new Set(playablePresets.map((p) => p.name));
  while (existingNames.has(t("preset.autoName", { n }))) n++;
  return t("preset.autoName", { n });
}

function savePreset() {
  const rawName = presetNameInput.value.trim();
  const name = rawName || getAutoPresetName();
  const variants = [...playableVariantIds];
  // 동일 이름이 있으면 덮어쓰기
  const existing = playablePresets.findIndex((p) => p.name === name);
  if (existing >= 0) {
    playablePresets[existing].variants = variants;
  } else {
    playablePresets.push({ name, variants });
  }
  savePresetsToStorage();
  presetNameInput.value = "";
  renderPresetSelect();
  // 방금 저장한 프리셋 선택 상태로 설정
  const savedIndex = playablePresets.findIndex((p) => p.name === name);
  if (savedIndex >= 0) presetSelect.value = String(savedIndex);
  loadPresetButton.disabled = presetSelect.value === "";
  deletePresetButton.disabled = presetSelect.value === "";
}

function loadPreset() {
  const index = Number(presetSelect.value);
  const preset = playablePresets[index];
  if (!preset) return;
  playableVariantIds.clear();
  preset.variants.forEach((id) => playableVariantIds.add(id));
  savePlayableCharacters();
  renderPlayableTools();
  renderCharacters();
  renderRecommendations();
}

function deletePreset() {
  const index = Number(presetSelect.value);
  if (!playablePresets[index]) return;
  playablePresets.splice(index, 1);
  savePresetsToStorage();
  presetSelect.value = "";
  renderPresetSelect();
}

function renderPlayableTools() {
  const count = playableVariantIds.size;
  playableModeButton.classList.toggle("active", playableEditMode);
  playableModeButton.textContent = playableEditMode ? t("playable.done") : t("button.playableMode");
  playableModeButton.setAttribute("aria-pressed", String(playableEditMode));
  clearPlayableButton.disabled = count === 0;
  playableStatus.textContent = count > 0 ? t("playable.limited", { count }) : t("playable.status.all");
}

function togglePlayableCharacter(variantId) {
  const variant = characterVariants.find((character) => character.variantId === variantId);
  if (!variant) return;

  if (playableVariantIds.has(variant.variantId)) {
    playableVariantIds.delete(variant.variantId);
  } else {
    playableVariantIds.add(variant.variantId);
  }

  savePlayableCharacters();
  renderCharacters();
  renderPlayableTools();
  renderRecommendations();
}

function syncSelectedFromSlots() {
  selectedIds.clear();
  slotAssignments.slice(1).forEach((variantId) => {
    if (variantId) selectedIds.add(variantId);
  });
  chosenPickId = slotAssignments[0];
}

function assignSlot(slotIndex, id) {
  const characterId = id.split(":")[0];
  for (let index = 0; index < slotAssignments.length; index += 1) {
    if (index === slotIndex) continue;
    if (slotAssignments[index]?.split(":")[0] === characterId) {
      slotAssignments[index] = null;
    }
  }

  slotAssignments[slotIndex] = id;
  syncSelectedFromSlots();
}

function assignNextPick(id) {
  const characterId = id.split(":")[0];
  const existingSlot = slotAssignments.findIndex((variantId) => variantId?.split(":")[0] === characterId);
  if (existingSlot >= 0) {
    slotAssignments[existingSlot] = null;
    syncSelectedFromSlots();
    return;
  }

  const emptySlot = [1, 2, 0].find((slotIndex) => !slotAssignments[slotIndex]);
  assignSlot(emptySlot ?? 0, id);
}

function renderSelectedTeam() {
  const selected = [...selectedIds].map((id) => characterVariants.find((character) => character.variantId === id));
  selectedCount.textContent = selected.length;

  if (selected.length === 0) {
    selectedTeam.innerHTML = `<p class="empty-state">${t("team.emptyHint")}</p>`;
    return;
  }

  selectedTeam.innerHTML = selected
    .map((character) => `<span class="team-chip">${t(`char.${character.id}`)}<small>${[t(`weapon.${character.weapon}`), character.weaponStyle].filter(Boolean).join(" · ")}</small></span>`)
    .join("");
}

function primaryVariantForCharacter(characterId, weapon) {
  return (
    characterVariants.find((character) => character.characterId === characterId && character.weapon === weapon) ??
    characterVariants.find((character) => character.characterId === characterId)
  );
}

function renderDetectedTeam(matches = [], status = "") {
  if (status) {
    detectedTeam.innerHTML = `<p class="detected-status">${status}</p>`;
    return;
  }

  const assigned = slotAssignments
    .map((variantId, slotIndex) => ({
      slotIndex,
      variant: characterVariants.find((character) => character.variantId === variantId),
    }))
    .filter((item) => item.variant);

  if (assigned.length === 0 && matches.length === 0) {
    detectedTeam.innerHTML = `<p class="detected-status">${t("team.autoHint")}</p>`;
    return;
  }

  const manualChips = assigned
    .map(({ slotIndex, variant }) => {
      const slotText = slotIndex === 0 ? t("slot.self") : t(`slot.teammate${slotIndex}`);
      return `
        <span class="detected-chip">
          <img src="${variant.image}" alt="">
          <strong>${t(`char.${variant.id}`)}</strong>
          <small>${slotText} · ${t(`weapon.${variant.weapon}`)}</small>
        </span>
      `;
    })
    .join("");

  const detectedChips = matches.length > 0 && assigned.length === 0
    ? matches
        .map((match) => {
          const percent = Math.round(match.confidence * 100);
          const weaponLabel = match.weapon ? (primaryVariantForCharacter(match.character.id, match.weapon)?.weapon ?? match.weapon) : null;
          const weaponText = weaponLabel ? ` · ${t(`weapon.${weaponLabel}`)}` : "";
          const slotText = match.isSelf ? t("slot.self") : t("slot.detectedTeammate");
          return `
            <span class="detected-chip">
              <img src="${match.character.image}" alt="">
              <strong>${t(`char.${match.character.id}`)}</strong>
              <small>${slotText}${weaponText} · ${percent}%</small>
            </span>
          `;
        })
        .join("")
    : "";

  detectedTeam.innerHTML = manualChips || detectedChips;
}

function popularFeedbackRows(sortMode = "overall") {
  const rows = new Map();
  popularFeedback.forEach((row) => {
    if (!row.team_key || !row.candidate_id) return;
    const key = `${row.team_key}->${row.candidate_id}`;
    const previous = rows.get(key) ?? { teamKey: row.team_key, candidateId: row.candidate_id, likes: 0, dislikes: 0, total: 0, updatedAt: "" };
    previous.likes += row.likes ?? 0;
    previous.dislikes += row.dislikes ?? 0;
    previous.total += row.total ?? 0;
    if (!previous.updatedAt || (row.updated_at ?? "") > previous.updatedAt) previous.updatedAt = row.updated_at ?? "";
    rows.set(key, previous);
  });

  const sorter = sortMode === "recent"
    ? (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.score - a.score || b.likes - a.likes
    : (a, b) => b.score - a.score || b.likes - a.likes || b.total - a.total;

  return [...rows.values()]
    .map((row) => ({ ...row, score: row.likes - row.dislikes }))
    .filter((row) => row.likes > 0)
    .sort(sorter)
    .slice(0, 14);
}

function rankerCompositionRows() {
  return [...rankerCompositionStats]
    .sort((a, b) => {
      const aScore = (a.top3Rate ?? 0) * 4 + (a.winRate ?? 0) * 5 + Math.min(1.5, (a.games ?? 0) / 8) - (a.avgPlacement ?? 5) * 0.18;
      const bScore = (b.top3Rate ?? 0) * 4 + (b.winRate ?? 0) * 5 + Math.min(1.5, (b.games ?? 0) / 8) - (b.avgPlacement ?? 5) * 0.18;
      return bScore - aScore;
    })
    .slice(0, 16);
}

function rankerCharacterRows(role = "all") {
  return Object.entries(rankerCandidateStats)
    .filter(([characterId]) => role === "all" || characterRolesById(characterId).includes(role))
    .map(([characterId, stat]) => ({
      characterId,
      score: (stat.top3Rate ?? 0) * 100 + (stat.winRate ?? 0) * 120 + Math.min(30, stat.games ?? 0) - (stat.avgPlacement ?? 5) * 4,
      games: stat.games ?? 0,
      top3Rate: stat.top3Rate ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
}

function renderRankRoleFilters() {
  const filters = [{ id: "all" }, ...roles];
  return `
    <div class="rank-filter-row" aria-label="${t("rank.filterLabel")}">
      ${filters
        .map((role) => {
          const pressed = role.id === activeRankRole ? "true" : "false";
          return `<button class="filter-button" type="button" data-rank-role="${role.id}" aria-pressed="${pressed}">${t(`role.${role.id}`)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function compositionReason(row, isUserFeedback) {
  const members = row.teamKey ? [...row.teamKey.split("+"), row.candidateId] : [...row.teammates, row.candidate];
  const characters = members.map(characterById).filter(Boolean);
  const roles = new Set(characters.map((character) => character.role));
  const tags = new Set(characters.flatMap((character) => character.tags));
  const ranges = new Set(characters.map((character) => character.weaponRange));

  if (roles.has("frontline") && (roles.has("ranged") || roles.has("mage"))) {
    return t("comp.frontlineRanged");
  }
  if ((roles.has("bruiser") || roles.has("assassin")) && tags.has("focus")) {
    return t("comp.bruiserFocus");
  }
  if (tags.has("initiate") && tags.has("cc")) {
    return t("comp.initiateCC");
  }
  if (tags.has("peel") && (roles.has("ranged") || roles.has("mage"))) {
    return t("comp.peelRanged");
  }
  if (ranges.has("melee") && ranges.has("ranged")) {
    return t("comp.mixedRange");
  }

  const top3 = Math.round((row.top3Rate ?? 0) * 100);
  if (isUserFeedback) return t("comp.userFeedback");
  if (top3 >= 70) return t("comp.rankerTop");
  return t("comp.rankerFrequent");
}

function renderCharacterFace(characterId) {
  const character = characterBrief(characterId);
  return `
    <span class="combo-face">
      ${character.image ? `<img src="${character.image}" alt="">` : ""}
      <span>
        <strong>${character.name}</strong>
        <small>${[character.role, character.weapon].filter(Boolean).join(" · ")}</small>
      </span>
    </span>
  `;
}

function renderHomeDashboard() {
  const overallComps = popularFeedbackRows("overall");
  const recentComps = popularFeedbackRows("recent");
  const fallbackComps = rankerCompositionRows();

  function renderComboCards(rows, titlePrefix, isUserFeedback) {
    return rows
    .map((row, index) => {
      const members = row.teamKey ? [...row.teamKey.split("+"), row.candidateId] : [...row.teammates, row.candidate];
      const detail = row.teamKey ? t("rank.comboDetail", { likes: row.likes, total: row.total }) : t("rank.rankerDetail", { count: row.games, top3: Math.round((row.top3Rate ?? 0) * 100) });
      return `
        <article class="combo-card">
          <div class="combo-card-head">
            <span class="recommendation-rank">${titlePrefix} ${index + 1}</span>
            <strong>${detail}</strong>
          </div>
          <div class="combo-members">${members.map(renderCharacterFace).join("")}</div>
          <p>${compositionReason(row, isUserFeedback)}</p>
        </article>
      `;
    })
    .join("");
  }

  const overallItems = renderComboCards(overallComps.length > 0 ? overallComps : fallbackComps, t("rank.overallPrefix"), overallComps.length > 0);
  const recentItems = renderComboCards(recentComps.length > 0 ? recentComps : fallbackComps.slice(0, 14), t("rank.recentPrefix"), recentComps.length > 0);

  const rankRows = rankerCharacterRows(activeRankRole);
  const rankItems = rankRows
    .map((row, index) => {
      const character = characterBrief(row.characterId);
      return `
        <article class="rank-card">
          <span class="rank-number">${index + 1}</span>
          ${character.image ? `<img src="${character.image}" alt="">` : ""}
          <div>
            <strong>${character.name}</strong>
            <small>${t(`role.${character.role}`)} · ${t("rank.gamesCount", { count: row.games })} · TOP3 ${Math.round(row.top3Rate * 100)}%</small>
          </div>
        </article>
      `;
    })
    .join("");
  const rankRoleLabel = activeRankRole === "all" ? t("rank.allCharacters") : t(`role.${activeRankRole}`);

  recommendations.innerHTML = `
    <div class="recommendation-hub">
      <section class="combo-section">
        <div class="section-title-row">
          <h3>${t("rank.compositionTitle")}</h3>
        <span>${t("rank.compositionBasis")}</span>
        </div>
        <div class="combo-split">
          <div>
            <h4>${t("rank.overallTop")}</h4>
            <div class="combo-grid">${overallItems}</div>
          </div>
          <div>
            <h4>${t("rank.recentTop")}</h4>
            <div class="combo-grid">${recentItems}</div>
          </div>
        </div>
      </section>
      <section class="rank-section">
        <div class="section-title-row">
          <h3>${t("rank.characterTitle")}</h3>
          <span>${t("rank.characterBasis", { label: rankRoleLabel, count: rankRows.length })}</span>
        </div>
        ${renderRankRoleFilters()}
        <div class="rank-grid">${rankItems || `<p class="empty-state">${t("rank.noData")}</p>`}</div>
      </section>
    </div>
  `;
}

function renderRecommendations() {
  if (activeView === "recommendations") {
    renderHomeDashboard();
    return;
  }

  if (selectedIds.size === 0) {
    recommendations.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("recommend.emptyTitle")}</strong>
        <span>${t("recommend.emptyBody")}</span>
      </div>
    `;
    return;
  }

  const playablePool = playableVariantIds.size > 0 ? [...playableVariantIds] : undefined;
  const results = recommend([...selectedIds], tierSelect.value, remoteFeedback, playablePool, popularFeedback);
  if (results.length === 0) {
    recommendations.innerHTML = `<p class="empty-state">${t("recommend.noPlayable")}</p>`;
    return;
  }
  recommendations.innerHTML = recommendationStageNotice() + results
    .map((result, index) => {
      const reasonList = result.reasons.map((reason) => `<li>${reason}</li>`).join("");
      const compactLabels = compactReasonLabels(result.reasons)
        .map((label) => `<span>${label}</span>`)
        .join("");
      const compactText = compactReasonText(result.reasons);
      const scoreTone = result.score < 0 ? " negative-score" : "";
      return `
        <article class="recommendation-card">
          <div class="recommendation-avatar">
            <img src="${result.character.image}" alt="" loading="lazy" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
            <span hidden>${t(`char.${result.character.id}`).slice(0, 1)}</span>
          </div>
          <div class="recommendation-main">
            <div class="recommendation-title">
              <span class="recommendation-rank">${t("recommend.rank", { index: index + 1 })}</span>
              <h3>${t(`char.${result.character.id}`)}</h3>
              <span>${characterSubtitle(result.character)}</span>
            </div>
            <p class="recommendation-summary">${compactText}</p>
            <div class="recommendation-tags">${compactLabels}</div>
            <details class="recommendation-details">
              <summary>${t("recommend.details")}</summary>
              <ul>${reasonList}</ul>
            </details>
            <div class="feedback-row">
              <button class="feedback-button" type="button" data-choose-pick="${result.character.variantId}">${t("recommend.choosePick")}</button>
            </div>
          </div>
          <strong class="score${scoreTone}">${result.score}</strong>
        </article>
      `;
    })
    .join("");
}

function renderMatchFeedback() {
  const chosen = characterVariants.find((character) => character.variantId === chosenPickId);
  if (!chosen) {
    matchFeedback.innerHTML = `<p class="empty-state">${t("feedback.emptyHint")}</p>`;
    return;
  }

  const evaluation = evaluateCandidate([...selectedIds], chosen.variantId, tierSelect.value, remoteFeedback, popularFeedback);
  const reasonList = evaluation?.reasons.map((reason) => `<li>${reason}</li>`).join("") ?? "";
  const compactLabels = compactReasonLabels(evaluation?.reasons ?? [])
    .map((label) => `<span>${label}</span>`)
    .join("");
  const compactText = compactReasonText(evaluation?.reasons ?? []);
  const scoreTone = (evaluation?.score ?? 0) < 0 ? " negative-score" : "";
  const score = selectedIds.size > 0 ? `<strong class="chosen-score${scoreTone}">${evaluation?.score ?? "-"}</strong>` : "";
  const currentFeedbackKey = feedbackWindowKey([...selectedIds], chosen.variantId, tierSelect.value);
  const hasSubmittedFeedback =
    submittedFeedbackKeys.has(currentFeedbackKey) ||
    hasRecentFeedback([...selectedIds], chosen.variantId, tierSelect.value);
  const doneText = t("feedback.done");
  const feedbackControls = hasSubmittedFeedback
    ? `
      <div class="chosen-feedback-done" aria-live="polite">
        <strong>${doneText}</strong>
      </div>
      <button class="icon-button clear-pick-button" type="button" data-clear-pick aria-label="${t('slot.clearAriaLabel')}" title="${t('slot.clearAriaLabel')}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m18 6-12 12"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
    `
    : `
      <div class="chosen-actions" aria-label="${t('feedback.ariaLabel')}">
        <button class="icon-button feedback-like" type="button" data-match-feedback="1" aria-label="${t('feedback.likeLabel')}" title="${t('feedback.likeLabel')}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Z"></path>
            <path d="M7 11 11 2a3 3 0 0 1 3 3v4h5a3 3 0 0 1 3 3l-2 7a3 3 0 0 1-3 3H7V11Z"></path>
          </svg>
        </button>
        <button class="icon-button feedback-dislike" type="button" data-match-feedback="-1" aria-label="${t('feedback.dislikeLabel')}" title="${t('feedback.dislikeLabel')}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3V2Z"></path>
            <path d="M17 13 13 22a3 3 0 0 1-3-3v-4H5a3 3 0 0 1-3-3l2-7a3 3 0 0 1 3-3h10v11Z"></path>
          </svg>
        </button>
        <button class="icon-button clear-pick-button" type="button" data-clear-pick aria-label="${t('slot.clearAriaLabel')}" title="${t('slot.clearAriaLabel')}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m18 6-12 12"></path>
            <path d="m6 6 12 12"></path>
          </svg>
        </button>
      </div>
    `;

  matchFeedback.innerHTML = `
    <div class="chosen-pick">
      <img src="${chosen.image}" alt="">
      <div>
        <strong>${t(`char.${chosen.id}`)}</strong>
        <small>${[t(`weapon.${chosen.weapon}`), chosen.weaponStyle, feedbackLabel(chosen.variantId)].filter(Boolean).join(" · ")}</small>
      </div>
      ${score}
      ${feedbackControls}
    </div>
    <div class="combo-evaluation">
      <div>
        <strong>${t("feedback.diagnosis")}</strong>
        <p>${compactText}</p>
      </div>
      <div class="recommendation-tags">${compactLabels}</div>
      <details class="recommendation-details">
        <summary>${t("recommend.details")}</summary>
        <ul>${reasonList}</ul>
      </details>
    </div>
  `;
}

function feedbackLabel(candidateId) {
  const entry = getFeedbackEntry([...selectedIds], candidateId, tierSelect.value);
  const total = entry.likes + entry.dislikes;
  if (total === 0) return t("feedback.none");
  return t("feedback.score", { likes: entry.likes, dislikes: entry.dislikes });
}

function remoteFeedbackKey() {
  return [tierSelect.value, [...selectedIds].sort().join("|")].join("::");
}

function refreshRemoteFeedbackIfNeeded() {
  if (selectedIds.size === 0) {
    remoteFeedback = {};
    lastRemoteFeedbackKey = "";
    return;
  }

  const nextKey = remoteFeedbackKey();
  if (nextKey === lastRemoteFeedbackKey) return;
  lastRemoteFeedbackKey = nextKey;
  refreshRemoteFeedback();
}

async function refreshRemoteFeedback() {
  if (isRefreshingRemote) return;
  isRefreshingRemote = true;
  try {
    syncStatus.textContent = t("sync.checking");
    syncStatus.dataset.state = "loading";
    remoteFeedback = await loadRemoteFeedback([...selectedIds], tierSelect.value);
    const remaining = await flushPendingRemoteFeedback();
    syncStatus.textContent = remaining > 0 ? t("sync.connectedPending", { count: remaining }) : t("sync.connected");
    syncStatus.dataset.state = "ok";
  } catch {
    remoteFeedback = {};
    const pendingCount = loadPendingRemoteFeedback().length;
    syncStatus.textContent = pendingCount > 0 ? t("sync.failedPending", { count: pendingCount }) : t("sync.failed");
    syncStatus.dataset.state = "error";
  } finally {
    isRefreshingRemote = false;
  }
  if (activeView !== "recommendations") {
    renderRecommendations();
  }
}

async function flushPendingRemoteFeedback() {
  if (isFlushingPendingFeedback) return loadPendingRemoteFeedback().length;
  const pending = loadPendingRemoteFeedback();
  if (pending.length === 0) return 0;

  isFlushingPendingFeedback = true;
  try {
    for (const item of pending) {
      try {
        await recordRemoteFeedback(item.selectedIds, item.candidateId, item.value, item.tier);
        removePendingRemoteFeedback(item.id);
      } catch (error) {
        updatePendingRemoteFeedback(item.id, {
          attempts: (item.attempts ?? 0) + 1,
          lastError: error.message ?? "server failed",
        });
      }
    }
  } finally {
    isFlushingPendingFeedback = false;
  }
  return loadPendingRemoteFeedback().length;
}
async function refreshPopularFeedback() {
  if (isRefreshingPopular || popularFeedbackLoaded) return;
  isRefreshingPopular = true;
  try {
    popularFeedback = await loadPopularFeedback();
  } catch {
    popularFeedback = [];
  } finally {
    isRefreshingPopular = false;
    popularFeedbackLoaded = true;
  }
  if (selectedIds.size === 0) renderRecommendations();
}

function render() {
  appMain.dataset.view = activeView;
  applyTranslations();
  recommendTitle.textContent = activeView === "recommendations" ? t("nav.recommendations") : t("section.recommendation.title");
  sideTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeView);
  });
  renderRoleFilters();
  renderCharacters();
  renderPlayableTools();
  renderSelectedTeam();
  renderMatchFeedback();
  renderRecommendations();
  renderUnion();
  renderManualSlots();

  if (activeView === "union") {
    topbarEyebrow.textContent = "Union Draft";
    topbarTitle.textContent = t("topbar.title.union");
    selectedCount.textContent = unionParticipatingPlayers.size;
    selectedCount.nextElementSibling.textContent = t("topbar.unionSuffix");
  } else {
    topbarEyebrow.textContent = activeView === "recommendations" ? "Meta Dashboard" : "Squad Draft Assistant";
    topbarTitle.textContent = activeView === "recommendations" ? t("topbar.title.recommendations") : t("topbar.title.setup");
    selectedCount.nextElementSibling.textContent = t("topbar.selectedSuffix");
  }
  refreshRemoteFeedbackIfNeeded();
  refreshPopularFeedback();
}

function renderManualSlots() {
  manualSlots.querySelectorAll("[data-manual-slot]").forEach((button) => {
    const slotIndex = Number(button.dataset.manualSlot);
    const variant = characterVariants.find((character) => character.variantId === slotAssignments[slotIndex]);
    button.classList.toggle("active", activeSlot === slotIndex);
    button.classList.toggle("filled", Boolean(variant));
    const slotLabel = slotIndex === 0 ? t("slot.self") : t(`slot.teammate${slotIndex}`);
    button.textContent = variant ? `${slotLabel} · ${t(`char.${variant.id}`)}` : slotLabel;
  });
}

characterGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  const id = card.dataset.id;

  if (playableEditMode) {
    togglePlayableCharacter(id);
    return;
  }

  if (activeSlot !== null) {
    markRecentlyAssigned(id);
    assignSlot(activeSlot, id);
    activeSlot = null;
    renderDetectedTeam();
    render();
    return;
  }

  markRecentlyAssigned(id);
  assignNextPick(id);
  renderDetectedTeam();
  render();
});

roleFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  activeRole = button.dataset.role;
  characterGrid.scrollTop = 0;
  render();
});

clearButton.addEventListener("click", () => {
  selectedIds.clear();
  slotAssignments.fill(null);
  activeSlot = null;
  chosenPickId = null;
  renderDetectedTeam();
  render();
});

sideTabs.forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.view;
    render();
  });
});

contactOpenButton.addEventListener("click", openContactModal);
updateCheckButton.addEventListener("click", () => checkForUpdates());

contactModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-contact-close]")) closeContactModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !contactModal.hidden) closeContactModal();
});


contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const replyTo = contactReply.value.trim();
  const message = contactMessage.value.trim();
  if (!replyTo) {
    contactStatus.textContent = t("contact.validationEmail");
    contactReply.focus();
    return;
  }
  if (!message) {
    contactStatus.textContent = t("contact.validationMessage");
    contactMessage.focus();
    return;
  }

  contactStatus.textContent = t("contact.sending");
  submitContactMessage({
    replyTo,
    message,
    appVersion: "desktop",
  })
    .then(() => {
      contactStatus.textContent = t("contact.sent");
      contactForm.reset();
      setTimeout(closeContactModal, 900);
    })
    .catch((error) => {
      contactStatus.textContent = error.message ? t("contact.sendFailedReason", { reason: error.message }) : t("contact.sendFailed");
    });
});

searchInput.addEventListener("input", () => renderCharacters({ preserveScroll: false }));
playableModeButton.addEventListener("click", () => {
  playableEditMode = !playableEditMode;
  renderPlayableTools();
  renderCharacters();
});
clearPlayableButton.addEventListener("click", () => {
  playableVariantIds.clear();
  savePlayableCharacters();
  renderPlayableTools();
  renderCharacters();
  renderRecommendations();
});

savePresetButton.addEventListener("click", savePreset);
loadPresetButton.addEventListener("click", loadPreset);
deletePresetButton.addEventListener("click", deletePreset);
presetSelect.addEventListener("change", () => {
  loadPresetButton.disabled = presetSelect.value === "";
  deletePresetButton.disabled = presetSelect.value === "";
});
renderPresetSelect();
tierSelect.addEventListener("change", () => {
  renderRecommendations();
  refreshRemoteFeedbackIfNeeded();
});

recommendations.addEventListener("click", (event) => {
  if (toggleDetailsSummary(event)) return;

  const rankRoleButton = event.target.closest("[data-rank-role]");
  if (rankRoleButton) {
    activeRankRole = rankRoleButton.dataset.rankRole;
    renderRecommendations();
    return;
  }

  // 랭킹 탭에서는 추천 픽 선택 로직을 실행하지 않음 (빈 영역 클릭 시 스크롤 초기화 방지)
  if (activeView === "recommendations") return;

  const button = event.target.closest("[data-choose-pick]");
  if (!button) return;

  chosenPickId = button.dataset.choosePick;
  slotAssignments[0] = chosenPickId;
  renderDetectedTeam();
  render();
});

matchFeedback.addEventListener("click", (event) => {
  if (toggleDetailsSummary(event)) return;

  const clearPickButton = event.target.closest("[data-clear-pick]");
  if (clearPickButton) {
    chosenPickId = null;
    slotAssignments[0] = null;
    renderDetectedTeam();
    render();
    return;
  }

  const button = event.target.closest("[data-match-feedback]");
  if (!button || !chosenPickId) return;

  const currentFeedbackKey = feedbackWindowKey([...selectedIds], chosenPickId, tierSelect.value);
  if (submittedFeedbackKeys.has(currentFeedbackKey)) return;

  button.classList.add(Number(button.dataset.matchFeedback) > 0 ? "feedback-pop-like" : "feedback-pop-dislike");
  button.closest(".chosen-actions")?.querySelectorAll("[data-match-feedback]").forEach((item) => {
    item.disabled = true;
  });


  submittedFeedbackKeys.add(currentFeedbackKey);
  const feedbackValue = Number(button.dataset.matchFeedback);
  const pendingItem = queueRemoteFeedback([...selectedIds], chosenPickId, feedbackValue, tierSelect.value, "new-feedback");
  recordFeedback([...selectedIds], chosenPickId, feedbackValue, tierSelect.value);
  markRecentFeedback([...selectedIds], chosenPickId, tierSelect.value);
  syncStatus.textContent = t("sync.saving");
  syncStatus.dataset.state = "loading";
  recordRemoteFeedback([...selectedIds], chosenPickId, feedbackValue, tierSelect.value)
    .then(() => {
      removePendingRemoteFeedback(pendingItem.id);
      popularFeedbackLoaded = false;
      return Promise.all([refreshRemoteFeedback(), refreshPopularFeedback()]);
    })
    .then(() => {
      renderRecommendations();
    })
    .catch((error) => {
      updatePendingRemoteFeedback(pendingItem.id, {
        attempts: (pendingItem.attempts ?? 0) + 1,
        lastError: error.message ?? "server failed",
      });
      syncStatus.textContent = t("sync.saveFailed");
      syncStatus.dataset.state = "error";
    });
  window.setTimeout(() => {
    renderMatchFeedback();
    renderRecommendations();
  }, 420);
});

manualSlots.addEventListener("click", (event) => {
  const button = event.target.closest("[data-manual-slot]");
  if (!button) return;
  const slotIndex = Number(button.dataset.manualSlot);
  const slotLabel = slotIndex === 0 ? t("slot.self") : t(`slot.teammate${slotIndex}`);

  if (slotAssignments[slotIndex]) {
    slotAssignments[slotIndex] = null;
    activeSlot = null;
    syncSelectedFromSlots();
    renderDetectedTeam([], t("slot.deselect", { slot: slotLabel }));
    render();
    return;
  }

  if (activeSlot === slotIndex) {
    activeSlot = null;
    renderDetectedTeam([], t("slot.cancelEdit"));
    renderManualSlots();
    return;
  }

  activeSlot = slotIndex;
  renderDetectedTeam([], t("slot.editMode", { slot: slotLabel }));
  renderManualSlots();
});

unionPlayerGrid.addEventListener("click", (event) => {
  const check = event.target.closest("[data-union-participate]");
  if (check) {
    const player = Number(check.dataset.unionParticipate);
    if (check.checked) {
      if (unionParticipatingPlayers.size >= 3) {
        check.checked = false;
        unionResults.innerHTML = `
          <div class="setup-recommendation-empty">
            <strong>${t("union.maxPlayers")}</strong>
            <span>${t("union.maxPlayersDesc")}</span>
          </div>
        `;
        return;
      }
      unionParticipatingPlayers.add(player);
    } else {
      unionParticipatingPlayers.delete(player);
    }
    normalizeUnionPlayers();
    render();
    return;
  }

  const button = event.target.closest("[data-union-player]");
  if (!button) return;
  activeUnionPlayer = Number(button.dataset.unionPlayer);
  unionCharacterGrid.scrollTop = 0;
  renderUnion();
});

unionCharacterGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-union-pick]");
  if (!card) return;
  const roster = unionRosters[activeUnionPlayer];
  const variantId = card.dataset.unionPick;
  if (roster.has(variantId)) {
    roster.delete(variantId);
  } else {
    if (roster.size >= 15) {
      card.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 200 });
      return;
    }
    roster.add(variantId);
  }
  saveUnionRosters();
  normalizeUnionPlayers();
  renderUnion();
});

unionRoleFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-union-role]");
  if (!button) return;
  activeUnionRole = button.dataset.unionRole;
  unionCharacterGrid.scrollTop = 0;
  renderUnion();
});

unionSearchInput.addEventListener("input", () => renderUnionCharacters({ preserveScroll: false }));

unionClearButton.addEventListener("click", () => {
  unionRosters.forEach((roster) => roster.clear());
  unionParticipatingPlayers.clear();
  unionParticipatingPlayers.add(0);
  unionParticipatingPlayers.add(1);
  unionParticipatingPlayers.add(2);
  activeUnionPlayer = 0;
  saveUnionRosters();
  normalizeUnionPlayers();
  renderUnion();
});

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

const recoveredFeedbackCount = recoverLocalFeedbackToPendingQueue();
if (recoveredFeedbackCount > 0) {
  syncStatus.textContent = t("sync.localPending", { count: recoveredFeedbackCount });
  syncStatus.dataset.state = "loading";
}

render();
setTimeout(checkForUpdatesOnStartup, 1200);
startPeriodicUpdateChecks();
startPeriodicPendingFeedbackSync();
