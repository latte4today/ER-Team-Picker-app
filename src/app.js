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
import { applyTranslations, getLanguage, hasStoredLanguage, setLanguage, t } from "./i18n/index.js";
import { loadPopularFeedback, loadRemoteFeedback, recordRemoteFeedback, submitContactMessage } from "./supabaseFeedback.js";
import { appVersion, releaseConfig } from "./updateConfig.js";

const isElectron = /electron/i.test(navigator.userAgent);

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
const settingsOpenButton = document.querySelector("#settings-open-button");
const settingsModal = document.querySelector("#settings-modal");
const settingsThemeToggle = document.querySelector("#settings-theme-toggle");
const settingsContactButton = document.querySelector("#settings-contact-button");
const playableModeButton = document.querySelector("#playable-mode-button");
const clearPlayableButton = document.querySelector("#clear-playable-button");
const playableStatus = document.querySelector("#playable-status");
const presetNameInput = document.querySelector("#playable-preset-name");
const presetSelect = document.querySelector("#playable-preset-select");
const savePresetButton = document.querySelector("#save-playable-preset-button");
const loadPresetButton = document.querySelector("#load-playable-preset-button");
const deletePresetButton = document.querySelector("#delete-playable-preset-button");
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
const unionConfirmButton = document.querySelector("#union-confirm-button");
const unionPresetPanel = document.querySelector("#union-preset-panel");
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
const unionPresetStorageKey = "er-team-picker-union-presets";
const savedPlayableVariants = JSON.parse(localStorage.getItem(playableStorageKey) ?? "[]");
const savedPlayableCharacters = JSON.parse(localStorage.getItem(legacyPlayableStorageKey) ?? "[]");
const playableVariantIds = new Set(savedPlayableVariants.length > 0
  ? savedPlayableVariants
  : characterVariants
    .filter((character) => savedPlayableCharacters.includes(character.characterId))
    .map((character) => character.variantId));
let playableEditMode = false;
let playablePresets = JSON.parse(localStorage.getItem(presetStorageKey) ?? "[]");
// unionPresets: Array<{ name: string, variants: string[] }>
let unionPresets = normalizeUnionPresetStorage(JSON.parse(localStorage.getItem(unionPresetStorageKey) ?? "[]"));
let activeView = appMain?.dataset.view ?? "setup";
let activeUnionPlayer = 0;
let activeUnionRole = "all";
let isUnionCalculating = false;
let recommendLimit = 5;
let fullTeamLimit = 5;
let unionComboLimit = 5;

// Lazy computation caches
let _fullTeamState = { status: "idle", compositions: [], anchorId: null };
let _unionComboCache = [];
const unionParticipatingPlayers = new Set([0, 1, 2]);
const savedUnionRosters = JSON.parse(localStorage.getItem(unionStorageKey) ?? "[]");
const unionRosters = Array.from({ length: 4 }, (_, index) => new Set(savedUnionRosters[index] ?? []));

applyTranslations();
const splashEl = document.getElementById("splash-screen");
splashEl.classList.add("hidden");
setTimeout(() => { splashEl.hidden = true; }, 380);
document.getElementById("app-shell").style.opacity = "1";
if (!isElectron) {
  updateCheckButton.hidden = true;
  updateStatus.innerHTML = `
    <a class="web-download-btn" href="https://github.com/${releaseConfig.owner}/${releaseConfig.repo}/releases/latest" target="_blank" rel="noopener noreferrer">${t("web.downloadApp")}</a>
    <small>v${appVersion} · web</small>
  `;
}
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

function roleLabel(roleId) {
  const normalized = {
    tank: "frontline",
    tanker: "frontline",
    "탱커": "frontline",
    "브루저": "bruiser",
    dealer: "ranged",
    ranged_dealer: "ranged",
    "원거리 딜러": "ranged",
    assassin: "assassin",
    "암살자": "assassin",
    skill_dealer: "mage",
    skillDealer: "mage",
    "skill dealer": "mage",
    "스킬 딜러": "mage",
    mage: "mage",
    support: "support",
    supporter: "support",
    "서포터": "support",
  }[roleId] ?? roleId;
  const label = t(`role.${normalized}`);
  return label === `role.${normalized}` ? String(roleId ?? "") : label;
}

function unionPlayerName(index) {
  return t("player.name", { n: index + 1 });
}

function characterBrief(characterId) {
  const character = characterById(characterId);
  if (!character) return { name: characterId, image: "", role: "", weapon: "" };
  return {
    name: t(`char.${character.id}`),
    image: character.image,
    role: roleLabel(character.role),
    weapon: t(`weapon.${character.weapon}`),
  };
}

function characterSubtitle(character) {
  return [roleLabel(character.role), t(`weapon.${character.weapon}`), character.weaponStyle].filter(Boolean).join(" · ");
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

function feedbackCTABanner() {
  if (!chosenPickId) return "";
  const feedbackTeamIds = slotAssignments.slice(1).filter(Boolean);
  if (!canSubmitMatchFeedback(feedbackTeamIds, chosenPickId)) return "";
  const key = feedbackWindowKey(feedbackTeamIds, chosenPickId, tierSelect.value);
  const alreadyDone =
    submittedFeedbackKeys.has(key) ||
    hasRecentFeedback(feedbackTeamIds, chosenPickId, tierSelect.value);
  if (alreadyDone) return "";
  return `
    <button class="feedback-cta-banner" type="button" data-feedback-cta-goto>
      <span>${t("feedback.ctaBanner")}</span>
      <strong>${t("feedback.ctaGoTo")} →</strong>
    </button>
  `;
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
  settingsThemeToggle.textContent = nextTheme === "dark" ? t("button.darkMode") : t("button.lightMode");
  settingsThemeToggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
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

function updateSettingsLanguageCards() {
  const current = getLanguage();
  settingsModal.querySelectorAll("[data-language-option]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.languageOption === current));
  });
}

function openSettingsModal() {
  settingsModal.hidden = false;
  setTheme(document.documentElement.dataset.theme);
  updateSettingsLanguageCards();
}

function closeSettingsModal() {
  settingsModal.hidden = true;
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

// ── electron-updater (packaged build) ──────────────────────
let _manualUpdateCheck = false;

function setupErUpdater() {
  if (!window.erUpdater) return;
  window.erUpdater.onStatus((payload) => {
    const manual = _manualUpdateCheck;
    switch (payload.type) {
      case "checking":
        if (manual) updateStatus.innerHTML = t("update.checking");
        break;
      case "not-available":
        if (manual) updateStatus.innerHTML = `${t("update.latest")} <small>v${appVersion}</small>`;
        _manualUpdateCheck = false;
        updateCheckButton.disabled = false;
        break;
      case "available":
        updateStatus.innerHTML = t("update.downloading", { percent: 0 });
        break;
      case "progress":
        updateStatus.innerHTML = t("update.downloading", { percent: payload.percent });
        break;
      case "downloaded":
        updateStatus.innerHTML = `
          <strong>${t("update.new", { version: payload.version })}</strong>
          <button class="ghost-button" type="button" id="update-restart-btn">${t("update.restartNow")}</button>
          <small>${t("update.restartNote")}</small>
        `;
        _manualUpdateCheck = false;
        updateCheckButton.disabled = false;
        break;
      case "error":
        if (manual) updateStatus.innerHTML = `${t("update.failed")} <small>${payload.message ?? t("update.failedNetwork")}</small>`;
        _manualUpdateCheck = false;
        updateCheckButton.disabled = false;
        break;
      case "dev":
      case "unavailable":
        // dev 환경이거나 모듈 없음 → GitHub API fallback
        if (manual) {
          checkForUpdatesFallback({ silent: false }).finally(() => { _manualUpdateCheck = false; });
        } else {
          checkForUpdatesFallback({ silent: true });
        }
        break;
    }
  });
}

async function triggerErUpdate({ manual = false } = {}) {
  if (!window.erUpdater) {
    if (manual) checkForUpdatesFallback({ silent: false });
    else checkForUpdatesFallback({ silent: true });
    return;
  }
  _manualUpdateCheck = manual;
  if (manual) {
    updateCheckButton.disabled = true;
    updateStatus.innerHTML = t("update.checking");
  }
  try {
    await window.erUpdater.check();
  } catch (_) {
    if (manual) {
      updateStatus.innerHTML = t("update.failed");
      updateCheckButton.disabled = false;
    }
    _manualUpdateCheck = false;
  }
}

updateStatus.addEventListener("click", (event) => {
  if (event.target.closest("#update-restart-btn")) {
    window.erUpdater?.install();
  }
});

// ── GitHub API fallback (dev / no updater) ──────────────────
async function checkForUpdatesFallback({ silent = false } = {}) {
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
    if (!silent && latestVersion !== lastPromptedUpdateVersion) {
      lastPromptedUpdateVersion = latestVersion;
      const wantsUpdate = window.confirm(t("update.confirm", { current: appVersion, latest: latestVersion }));
      if (wantsUpdate) window.open(installerUrl, "_blank", "noopener,noreferrer");
    }
    return true;
  } catch (error) {
    if (!silent) updateStatus.innerHTML = `${t("update.failed")} <small>${error.message ?? t("update.failedNetwork")}</small>`;
    return false;
  } finally {
    if (!silent) updateCheckButton.disabled = false;
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
  await triggerErUpdate({ manual: false });
}

function startPeriodicUpdateChecks() {
  window.setInterval(() => {
    triggerErUpdate({ manual: false });
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
      return `<button class="filter-button" type="button" data-role="${role.id}" aria-pressed="${pressed}">${roleLabel(role.id)}</button>`;
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

function isTextSelectionActive() {
  const selection = window.getSelection?.();
  return Boolean(selection && selection.type === "Range" && selection.toString().trim());
}

function shouldIgnoreSelectionClick(event) {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest(".recommendation-details summary")) return false;

  return isTextSelectionActive() &&
    Boolean(event.target.closest(".recommendation-summary, .recommendation-details ul, .union-combo-card p, .helper-text, .guide-strip span, .empty-state, .setup-recommendation-empty, .recommendation-stage-notice"));
}

let detailsSummaryPointerStart = null;

function trackDetailsSummaryPointer(event) {
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest(".recommendation-details summary")) {
    detailsSummaryPointerStart = null;
    return;
  }
  detailsSummaryPointerStart = { x: event.clientX, y: event.clientY };
}

function handleDetailsSummaryClick(event) {
  if (!(event.target instanceof Element)) return;
  const summary = event.target.closest(".recommendation-details summary");
  if (!summary) return;

  const moved = detailsSummaryPointerStart &&
    (Math.abs(event.clientX - detailsSummaryPointerStart.x) > 5 ||
      Math.abs(event.clientY - detailsSummaryPointerStart.y) > 5);
  detailsSummaryPointerStart = null;

  event.preventDefault();
  event.stopPropagation();

  if (moved) return;

  const details = summary.closest("details");
  if (details) details.open = !details.open;
}

function renderUnionRoleFilters() {
  const filters = [{ id: "all" }, ...roles];
  unionRoleFilters.innerHTML = filters
    .map((role) => {
      const pressed = role.id === activeUnionRole ? "true" : "false";
      return `<button class="filter-button" type="button" data-union-role="${role.id}" aria-pressed="${pressed}">${roleLabel(role.id)}</button>`;
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
  return Array.from({ length: 4 }, (_, index) => index).filter((index) => unionRosters[index].size > 0);
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
  unionPlayerGrid.innerHTML = Array.from({ length: 4 }, (_, index) => index)
    .map((index) => {
      const name = unionPlayerName(index);
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

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function updateUnionCalculateButton() {
  if (!unionConfirmButton) return;
  unionConfirmButton.disabled = isUnionCalculating;
  unionConfirmButton.setAttribute("aria-busy", String(isUnionCalculating));
  unionConfirmButton.textContent = isUnionCalculating ? t("button.unionCalculating") : t("button.unionConfirm");
}

async function buildUnionCombos(players, rosters) {
  // Pre-rank each player's roster by individual score (solo evaluate), keep top 12
  const tier = tierSelect.value;
  const ranked = rosters.map((roster) => {
    if (roster.length <= 12) return roster;
    const scored = roster.map((character) => {
      const ev = evaluateCandidate([], character.variantId, tier, remoteFeedback, popularFeedback);
      return { character, score: ev?.score ?? 0 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12).map((x) => x.character);
  });

  const combos = [];
  let checked = 0;

  for (const first of ranked[0]) {
    for (const second of ranked[1]) {
      for (const third of ranked[2]) {
        checked += 1;
        if (checked % 200 === 0) await yieldToUi();
        const uniqueCharacters = new Set([first.characterId, second.characterId, third.characterId]);
        if (uniqueCharacters.size < 3) continue;
        const scoreInfo = unionComboScore([first, second, third]);
        combos.push({ players, combo: [first, second, third], ...scoreInfo });
      }
    }
  }

  return combos.sort((a, b) => b.score - a.score).slice(0, 24);
}

function renderUnionComboResults() {
  const combos = _unionComboCache;
  unionSummary.removeAttribute("data-state");
  unionSummary.textContent = "";
  if (combos.length === 0) {
    unionResults.innerHTML = `<p class="empty-state">${t("union.noCombo")}</p>`;
    return;
  }

  const visible = combos.slice(0, unionComboLimit);
  const hasMore = combos.length > unionComboLimit;

  const cards = visible
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
              .map((character) => `
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

  const showMoreBtn = hasMore
    ? `<button class="show-more-button" type="button" data-show-more-union>${t("recommend.showMore", { remaining: combos.length - unionComboLimit })}</button>`
    : "";

  unionResults.innerHTML = cards + showMoreBtn;
}

function renderUnionResultPrecheck() {
  normalizeUnionPlayers();
  const rosterPlayers = unionRosterPlayers();
  const players = activeUnionPlayers();
  unionSummary.removeAttribute("data-state");
  if (rosterPlayers.length < 3) {
    unionSummary.textContent = t("union.registered", { count: rosterPlayers.length });
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("union.minPlayers")}</strong>
        <span>${t("union.minPlayersDesc")}</span>
      </div>
    `;
    return false;
  }

  if (players.length !== 3) {
    unionSummary.textContent = t("union.players", { count: players.length });
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("union.selectPlayers")}</strong>
        <span>${t("union.selectPlayersDesc")}</span>
      </div>
    `;
    return false;
  }

  const emptyPlayer = players.find((player) => unionRosters[player].size === 0);
  if (emptyPlayer !== undefined) {
    unionSummary.textContent = t("union.waiting");
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${t("union.emptyRoster", { name: unionPlayerName(emptyPlayer) })}</strong>
        <span>${t("union.emptyRosterDesc")}</span>
      </div>
    `;
    return false;
  }

  return true;
}

async function renderUnionResults() {
  if (isUnionCalculating) return;
  if (!renderUnionResultPrecheck()) return;

  const players = activeUnionPlayers();
  const rosters = players.map((player) => [...unionRosters[player]].map(variantById).filter(Boolean));

  isUnionCalculating = true;
  unionComboLimit = 5;
  _unionComboCache = [];
  updateUnionCalculateButton();
  unionSummary.dataset.state = "loading";
  unionSummary.textContent = t("union.calculating");
  unionResults.innerHTML = `<div class="union-loading" role="status">${t("union.calculatingDesc")}</div>`;

  try {
    await yieldToUi();
    _unionComboCache = await buildUnionCombos(players, rosters);
    renderUnionComboResults();
  } finally {
    isUnionCalculating = false;
    updateUnionCalculateButton();
  }
}

function renderUnion() {
  renderUnionPlayers();
  renderUnionRoleFilters();
  renderUnionCharacters();
}

function savePlayableCharacters() {
  localStorage.setItem(playableStorageKey, JSON.stringify([...playableVariantIds]));
}

function savePresetsToStorage() {
  localStorage.setItem(presetStorageKey, JSON.stringify(playablePresets));
}

// ── Union presets ──────────────────────────────────────────
let _unionPresetSaveTimer = null;

function normalizeUnionPresetStorage(value) {
  const source = Array.isArray(value)
    ? value
    : Object.values(value ?? {}).flat();
  const byName = new Map();
  source.forEach((preset) => {
    if (!preset?.name || !Array.isArray(preset.variants)) return;
    const variants = [...new Set(preset.variants)];
    const samePreset = [...byName.values()].some((saved) =>
      saved.name === preset.name &&
      saved.variants.length === variants.length &&
      saved.variants.every((id, index) => id === variants[index])
    );
    if (samePreset) return;

    let name = preset.name;
    let suffix = 2;
    while (byName.has(name)) {
      name = `${preset.name} ${suffix}`;
      suffix += 1;
    }
    byName.set(name, { name, variants });
  });
  return [...byName.values()];
}

function saveUnionPresetsToStorage() {
  localStorage.setItem(unionPresetStorageKey, JSON.stringify(unionPresets));
}

function getUnionAutoPresetName() {
  let n = 1;
  const existingNames = new Set(unionPresets.map((p) => p.name));
  while (existingNames.has(t("preset.autoName", { n }))) n++;
  return t("preset.autoName", { n });
}

function buildUnionPresetDropdownHTML() {
  const items = unionPresets.map((p, i) => `<button class="updd-item" type="button" data-preset-index="${i}">${p.name}</button>`).join("");
  const isEmpty = unionPresets.length === 0;
  const displayText = isEmpty ? t("preset.empty") : t("preset.selectPlaceholder");
  return `
    <div class="union-preset-dropdown${isEmpty ? " updd-empty" : ""}" data-selected-index="">
      <button class="updd-trigger ghost-button" type="button" aria-expanded="false"${isEmpty ? " disabled" : ""}>
        <span class="updd-value">${displayText}</span>
        <span class="updd-arrow">v</span>
      </button>
      <div class="updd-list">${items}</div>
    </div>
  `;
}

function renderUnionPresetPanel() {
  const previousName = unionPresetPanel.querySelector("#union-preset-name-input")?.value ?? "";
  const playerRows = Array.from({ length: 4 }, (_, playerIndex) => `
    <div class="union-preset-row" data-preset-player="${playerIndex}">
      <span class="union-preset-row-label">${unionPlayerName(playerIndex)}</span>
      ${buildUnionPresetDropdownHTML()}
      <button class="ghost-button union-preset-load-btn" type="button" disabled>${t("button.load")}</button>
      <button class="ghost-button union-preset-delete-btn" type="button" disabled>${t("button.delete")}</button>
    </div>
  `).join("");

  unionPresetPanel.innerHTML = `
    <div class="union-preset-save-row">
      <input id="union-preset-name-input" type="text" maxlength="18" placeholder="${t("preset.namePlaceholder")}">
      <button class="ghost-button union-preset-save-btn" type="button">${t("button.save")}</button>
      <span class="union-preset-saved-msg" id="union-preset-saved-msg" aria-live="polite"></span>
    </div>
    ${playerRows}
  `;
  const nameInput = unionPresetPanel.querySelector("#union-preset-name-input");
  if (nameInput) nameInput.value = previousName;
}

function ensureUnionPresetPanel() {
  if (!unionPresetPanel.querySelector("#union-preset-name-input")) {
    renderUnionPresetPanel();
    return;
  }
  updateUnionPresetDropdowns();
}

function updateUnionPresetDropdowns() {
  const nameInput = unionPresetPanel.querySelector("#union-preset-name-input");
  if (nameInput) nameInput.placeholder = t("preset.namePlaceholder");
  unionPresetPanel.querySelector(".union-preset-save-btn")?.replaceChildren(document.createTextNode(t("button.save")));

  unionPresetPanel.querySelectorAll("[data-preset-player]").forEach((row) => {
    const playerIndex = Number(row.dataset.presetPlayer ?? 0);
    const label = row.querySelector(".union-preset-row-label");
    if (label) label.textContent = unionPlayerName(playerIndex);
    row.querySelector(".union-preset-load-btn")?.replaceChildren(document.createTextNode(t("button.load")));
    row.querySelector(".union-preset-delete-btn")?.replaceChildren(document.createTextNode(t("button.delete")));

    const dropdown = row.querySelector(".union-preset-dropdown");
    const loadBtn = row.querySelector(".union-preset-load-btn");
    const deleteBtn = row.querySelector(".union-preset-delete-btn");
    if (!dropdown) return;

    const prevIndex = dropdown.dataset.selectedIndex;
    const list = dropdown.querySelector(".updd-list");
    list.innerHTML = unionPresets.map((p, i) => `<button class="updd-item" type="button" data-preset-index="${i}">${p.name}</button>`).join("");

    const trigger = dropdown.querySelector(".updd-trigger");
    const valueEl = dropdown.querySelector(".updd-value");
    const validPrev = prevIndex !== "" && unionPresets[Number(prevIndex)];
    if (validPrev) {
      dropdown.dataset.selectedIndex = prevIndex;
      valueEl.textContent = unionPresets[Number(prevIndex)].name;
      list.querySelectorAll(".updd-item").forEach((btn) => {
        btn.classList.toggle("selected", btn.dataset.presetIndex === prevIndex);
      });
    } else {
      dropdown.dataset.selectedIndex = "";
      valueEl.textContent = unionPresets.length === 0 ? t("preset.empty") : t("preset.selectPlaceholder");
      list.querySelectorAll(".updd-item").forEach((btn) => btn.classList.remove("selected"));
    }

    const empty = unionPresets.length === 0;
    dropdown.classList.toggle("updd-empty", empty);
    trigger.disabled = empty;
    if (loadBtn) loadBtn.disabled = empty || dropdown.dataset.selectedIndex === "";
    if (deleteBtn) deleteBtn.disabled = empty || dropdown.dataset.selectedIndex === "";
  });
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
  recommendLimit = 5;
  fullTeamLimit = 5;
  _fullTeamState = { status: "idle", compositions: [], anchorId: null };
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
          return `<button class="filter-button" type="button" data-rank-role="${role.id}" aria-pressed="${pressed}">${roleLabel(role.id)}</button>`;
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
            <small>${roleLabel(character.role)} · ${t("rank.gamesCount", { count: row.games })} · TOP3 ${Math.round(row.top3Rate * 100)}%</small>
          </div>
        </article>
      `;
    })
    .join("");
  const rankRoleLabel = activeRankRole === "all" ? t("rank.allCharacters") : roleLabel(activeRankRole);

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

async function renderFullTeamRecommendations() {
  const anchorId = chosenPickId;

  // Re-use cache: same anchor already computing or done — just re-render
  if (_fullTeamState.anchorId === anchorId && _fullTeamState.status !== "idle") {
    _renderFullTeamCards();
    return;
  }

  // Fresh computation
  _fullTeamState = { status: "computing", compositions: [], anchorId };
  _renderFullTeamCards();
  await yieldToUi();

  const playablePool = playableVariantIds.size > 0 ? [...playableVariantIds] : undefined;
  const tier = tierSelect.value;
  const slot1Results = recommend([anchorId], tier, remoteFeedback, playablePool, popularFeedback).slice(0, 8);
  const seen = new Set();

  for (const r1 of slot1Results) {
    await yieldToUi();
    if (_fullTeamState.anchorId !== anchorId) return; // anchor changed — abort

    const slot2Results = recommend([anchorId, r1.character.variantId], tier, remoteFeedback, playablePool, popularFeedback).slice(0, 3);
    for (const r2 of slot2Results) {
      const pairKey = [r1.character.characterId, r2.character.characterId].sort().join("+");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      _fullTeamState.compositions.push({
        teammate1: r1,
        teammate2: r2,
        combinedScore: parseFloat((r1.score + r2.score).toFixed(1)),
      });
    }
    _fullTeamState.compositions.sort((a, b) => b.combinedScore - a.combinedScore);
    _renderFullTeamCards(); // stream results as they arrive
  }

  _fullTeamState.status = "done";
  _renderFullTeamCards();
}

function _renderFullTeamCards() {
  const { compositions, status } = _fullTeamState;
  const header = `
    <div class="full-team-section-header">
      <h3>${t("fullTeam.title")}</h3>
      <span>${t("fullTeam.subtitle")}</span>
    </div>
  `;

  if (compositions.length === 0) {
    recommendations.innerHTML = header + (
      status === "computing"
        ? `<div class="show-more-loading"><span class="show-more-spinner"></span>${t("fullTeam.calculating")}</div>`
        : `<p class="empty-state">${t("recommend.noPlayable")}</p>`
    );
    return;
  }

  const all = compositions; // already sorted, no hard cap — "더 보기" pages through them
  const visible = all.slice(0, fullTeamLimit);
  const moreReady = all.length > fullTeamLimit;

  const cards = visible.map(({ teammate1, teammate2, combinedScore }, index) => {
    const c1 = teammate1.character;
    const c2 = teammate2.character;
    const reasons1 = compactReasonLabels(teammate1.reasons).slice(0, 2).map((l) => `<span>${l}</span>`).join("");
    const reasons2 = compactReasonLabels(teammate2.reasons).slice(0, 2).map((l) => `<span>${l}</span>`).join("");
    const detailList1 = teammate1.reasons.map((r) => `<li>${r}</li>`).join("");
    const detailList2 = teammate2.reasons.map((r) => `<li>${r}</li>`).join("");
    return `
      <article class="full-team-card">
        <div class="full-team-header">
          <span class="recommendation-rank">${t("fullTeam.rank", { index: index + 1 })}</span>
          <span class="full-team-score">${combinedScore}</span>
        </div>
        <div class="full-team-members">
          <div class="full-team-member">
            <div class="recommendation-avatar">
              <img src="${c1.image}" alt="" loading="lazy" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
              <span hidden>${t(`char.${c1.id}`).slice(0, 1)}</span>
            </div>
            <div class="full-team-member-info">
              <strong>${t(`char.${c1.id}`)}</strong>
              <small>${characterSubtitle(c1)}</small>
              <div class="recommendation-tags">${reasons1}</div>
            </div>
          </div>
          <div class="full-team-member">
            <div class="recommendation-avatar">
              <img src="${c2.image}" alt="" loading="lazy" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
              <span hidden>${t(`char.${c2.id}`).slice(0, 1)}</span>
            </div>
            <div class="full-team-member-info">
              <strong>${t(`char.${c2.id}`)}</strong>
              <small>${characterSubtitle(c2)}</small>
              <div class="recommendation-tags">${reasons2}</div>
            </div>
          </div>
        </div>
        <details class="recommendation-details full-team-details">
          <summary>${t("recommend.details")}</summary>
          <div class="full-team-detail-body">
            <p class="full-team-detail-name">${t(`char.${c1.id}`)}</p>
            <ul>${detailList1}</ul>
            <p class="full-team-detail-name">${t(`char.${c2.id}`)}</p>
            <ul>${detailList2}</ul>
          </div>
        </details>
        <div class="full-team-actions">
          <button class="feedback-button" type="button"
            data-apply-combo="${teammate1.character.variantId}|${teammate2.character.variantId}">
            ${t("fullTeam.applyCombo")}
          </button>
        </div>
      </article>
    `;
  }).join("");

  let footer = "";
  if (moreReady) {
    footer = `<button class="show-more-button" type="button" data-show-more-full-team>${t("recommend.showMore", { remaining: all.length - fullTeamLimit })}</button>`;
  } else if (status === "computing") {
    footer = `<div class="show-more-loading"><span class="show-more-spinner"></span>${t("fullTeam.calculating")}</div>`;
  }

  recommendations.innerHTML = feedbackCTABanner() + header + cards + footer;
}

function renderRecommendations() {
  if (activeView === "recommendations") {
    renderHomeDashboard();
    return;
  }

  if (selectedIds.size === 0) {
    if (chosenPickId) {
      renderFullTeamRecommendations();
      return;
    }
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
  const visible = results.slice(0, recommendLimit);
  const hasMore = results.length > recommendLimit;
  const cards = visible
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
  const showMoreBtn = hasMore
    ? `<button class="show-more-button" type="button" data-show-more-recommendations>${t("recommend.showMore", { remaining: results.length - recommendLimit })}</button>`
    : "";
  recommendations.innerHTML = feedbackCTABanner() + recommendationStageNotice() + cards + showMoreBtn;
}

function renderMatchFeedback() {
  const chosen = characterVariants.find((character) => character.variantId === chosenPickId);
  if (!chosen) {
    matchFeedback.dataset.needsRating = "false";
    matchFeedback.innerHTML = `<p class="empty-state">${t("feedback.emptyHint")}</p>`;
    return;
  }

  const feedbackTeamIds = slotAssignments.slice(1).filter(Boolean);
  const canRateMatch = canSubmitMatchFeedback(feedbackTeamIds, chosen.variantId);
  const evaluation = evaluateCandidate([...selectedIds], chosen.variantId, tierSelect.value, remoteFeedback, popularFeedback);
  const reasonList = evaluation?.reasons.map((reason) => `<li>${reason}</li>`).join("") ?? "";
  const compactLabels = compactReasonLabels(evaluation?.reasons ?? [])
    .map((label) => `<span>${label}</span>`)
    .join("");
  const compactText = compactReasonText(evaluation?.reasons ?? []);
  const scoreTone = (evaluation?.score ?? 0) < 0 ? " negative-score" : "";
  const score = canRateMatch ? `<strong class="chosen-score${scoreTone}">${evaluation?.score ?? "-"}</strong>` : "";
  const currentFeedbackKey = canRateMatch ? feedbackWindowKey(feedbackTeamIds, chosen.variantId, tierSelect.value) : "";
  const hasSubmittedFeedback =
    canRateMatch &&
    (submittedFeedbackKeys.has(currentFeedbackKey) ||
      hasRecentFeedback(feedbackTeamIds, chosen.variantId, tierSelect.value));
  const doneText = t("feedback.done");
  const feedbackControls = !canRateMatch
    ? `
      <div class="chosen-feedback-done" aria-live="polite">
        <strong>팀원 2명과 내 픽까지 총 3명을 선택하면 평가할 수 있습니다.</strong>
      </div>
      <button class="icon-button clear-pick-button" type="button" data-clear-pick aria-label="${t('slot.clearAriaLabel')}" title="${t('slot.clearAriaLabel')}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m18 6-12 12"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
    `
    : hasSubmittedFeedback
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

  // 4번: 팀 완성 + 미평가 시 하이라이트 (탭 전환/앱 재진입 포함)
  const needsRating = canRateMatch && !hasSubmittedFeedback;
  matchFeedback.dataset.needsRating = String(needsRating);

  // 5초 후 버튼 무한 바운스 시작
  clearTimeout(_feedbackAttentionTimer);
  matchFeedback.classList.remove("feedback-attention");
  if (needsRating) {
    _feedbackAttentionTimer = setTimeout(() => {
      matchFeedback.classList.add("feedback-attention");
    }, 5000);
  }

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

function isKnownFeedbackId(id) {
  const normalized = String(id ?? "").trim();
  if (!normalized || ["empty", "null", "undefined", "none"].includes(normalized.toLowerCase())) return false;
  return characterVariants.some((character) => character.variantId === normalized || character.id === normalized);
}

function canSubmitMatchFeedback(teamIds, candidateId) {
  return teamIds.length === 2 && teamIds.every(isKnownFeedbackId) && isKnownFeedbackId(candidateId);
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
  if (activeView === "union") {
    renderUnion();
    ensureUnionPresetPanel();
  }
  renderManualSlots();
  updateUnionCalculateButton();

  if (activeView === "union") {
    topbarEyebrow.textContent = t("section.union.kicker");
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

// ── Post-clear feedback toast ──────────────────────────────────
let _feedbackToastEl = null;
let _feedbackToastTimer = null;
let _feedbackAttentionTimer = null;

function dismissFeedbackToast(animate = true) {
  clearTimeout(_feedbackToastTimer);
  if (!_feedbackToastEl) return;
  if (animate) {
    _feedbackToastEl.classList.add("feedback-toast-out");
    setTimeout(() => { _feedbackToastEl?.remove(); _feedbackToastEl = null; }, 300);
  } else {
    _feedbackToastEl.remove();
    _feedbackToastEl = null;
  }
}

function showPostClearFeedbackToast({ teamIds, candidateId, tier, feedbackKey, character }) {
  dismissFeedbackToast(false);

  const el = document.createElement("div");
  el.className = "feedback-toast";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <img src="${character.image}" alt="" class="feedback-toast-avatar" onerror="this.hidden=true">
    <span class="feedback-toast-text">${t("feedback.ctaBanner")}</span>
    <div class="feedback-toast-actions">
      <button class="icon-button feedback-like" type="button" data-toast-fb="1" aria-label="${t("feedback.likeLabel")}" title="${t("feedback.likeLabel")}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Z"></path>
          <path d="M7 11 11 2a3 3 0 0 1 3 3v4h5a3 3 0 0 1 3 3l-2 7a3 3 0 0 1-3 3H7V11Z"></path>
        </svg>
      </button>
      <button class="icon-button feedback-dislike" type="button" data-toast-fb="-1" aria-label="${t("feedback.dislikeLabel")}" title="${t("feedback.dislikeLabel")}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3V2Z"></path>
          <path d="M17 13 13 22a3 3 0 0 1-3-3v-4H5a3 3 0 0 1-3-3l2-7a3 3 0 0 1 3-3h10v11Z"></path>
        </svg>
      </button>
      <button class="icon-button feedback-toast-close" type="button" data-toast-dismiss aria-label="${t("button.cancel")}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
      </button>
    </div>
  `;

  el.addEventListener("click", (event) => {
    if (event.target.closest("[data-toast-dismiss]")) {
      dismissFeedbackToast();
      return;
    }
    const fbBtn = event.target.closest("[data-toast-fb]");
    if (!fbBtn) return;
    const value = Number(fbBtn.dataset.toastFb);
    const pendingItem = queueRemoteFeedback(teamIds, candidateId, value, tier, "new-feedback");
    if (pendingItem) {
      submittedFeedbackKeys.add(feedbackKey);
      recordFeedback(teamIds, candidateId, value, tier);
      markRecentFeedback(teamIds, candidateId, tier);
      syncStatus.textContent = t("sync.saving");
      syncStatus.dataset.state = "loading";
      recordRemoteFeedback(teamIds, candidateId, value, tier)
        .then(() => {
          removePendingRemoteFeedback(pendingItem.id);
          popularFeedbackLoaded = false;
          return refreshPopularFeedback();
        })
        .catch((error) => {
          updatePendingRemoteFeedback(pendingItem.id, {
            attempts: (pendingItem.attempts ?? 0) + 1,
            lastError: error.message ?? "server failed",
          });
          syncStatus.textContent = t("sync.saveFailed");
          syncStatus.dataset.state = "error";
        });
    }
    dismissFeedbackToast();
  });

  // 마우스 올리면 타이머 일시정지, 내리면 재시작
  el.addEventListener("mouseenter", () => clearTimeout(_feedbackToastTimer));
  el.addEventListener("mouseleave", () => {
    _feedbackToastTimer = setTimeout(() => dismissFeedbackToast(), 4000);
  });

  document.body.appendChild(el);
  _feedbackToastEl = el;
  _feedbackToastTimer = setTimeout(() => dismissFeedbackToast(), 8000);
}

clearButton.addEventListener("click", () => {
  // Save context before clearing
  const feedbackTeamIds = slotAssignments.slice(1).filter(Boolean);
  const pendingCandidateId = chosenPickId;
  const pendingTier = tierSelect.value;
  const hasPending = pendingCandidateId && canSubmitMatchFeedback(feedbackTeamIds, pendingCandidateId);
  const feedbackKey = hasPending ? feedbackWindowKey(feedbackTeamIds, pendingCandidateId, pendingTier) : null;
  const alreadyDone = feedbackKey && (
    submittedFeedbackKeys.has(feedbackKey) ||
    hasRecentFeedback(feedbackTeamIds, pendingCandidateId, pendingTier)
  );

  selectedIds.clear();
  slotAssignments.fill(null);
  activeSlot = null;
  chosenPickId = null;
  renderDetectedTeam();
  render();

  if (hasPending && !alreadyDone) {
    const character = characterVariants.find((c) => c.variantId === pendingCandidateId);
    if (character) {
      showPostClearFeedbackToast({ teamIds: feedbackTeamIds, candidateId: pendingCandidateId, tier: pendingTier, feedbackKey, character });
    }
  }
});

sideTabs.forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.view;
    render();
  });
});

settingsOpenButton.addEventListener("click", openSettingsModal);
updateCheckButton.addEventListener("click", () => triggerErUpdate({ manual: true }));

settingsModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-settings-close]")) closeSettingsModal();
});

settingsModal.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-language-option]");
  if (!btn) return;
  setLanguage(btn.dataset.languageOption);
  applyTranslations();
  setTheme(document.documentElement.dataset.theme);
  updateSettingsLanguageCards();
  render();
});

settingsThemeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

settingsContactButton.addEventListener("click", () => {
  closeSettingsModal();
  openContactModal();
});

contactModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-contact-close]")) closeContactModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!contactModal.hidden) closeContactModal();
    else if (!settingsModal.hidden) closeSettingsModal();
  }
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
  if (shouldIgnoreSelectionClick(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const ctaButton = event.target.closest("[data-feedback-cta-goto]");
  if (ctaButton) {
    matchFeedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
    matchFeedback.classList.add("feedback-highlight-pulse");
    setTimeout(() => matchFeedback.classList.remove("feedback-highlight-pulse"), 1400);
    return;
  }

  const rankRoleButton = event.target.closest("[data-rank-role]");
  if (rankRoleButton) {
    activeRankRole = rankRoleButton.dataset.rankRole;
    renderRecommendations();
    return;
  }

  const showMoreButton = event.target.closest("[data-show-more-recommendations]");
  if (showMoreButton) {
    recommendLimit += 5;
    renderRecommendations();
    return;
  }

  const showMoreFullTeam = event.target.closest("[data-show-more-full-team]");
  if (showMoreFullTeam) {
    fullTeamLimit += 5;
    _renderFullTeamCards();
    return;
  }

  // 랭킹 탭에서는 추천 픽 선택 로직을 실행하지 않음 (빈 영역 클릭 시 스크롤 초기화 방지)
  if (activeView === "recommendations") return;

  const applyComboButton = event.target.closest("[data-apply-combo]");
  if (applyComboButton) {
    const [v1, v2] = applyComboButton.dataset.applyCombo.split("|");
    assignSlot(1, v1);
    assignSlot(2, v2);
    renderDetectedTeam();
    render();
    return;
  }

  const button = event.target.closest("[data-choose-pick]");
  if (!button) return;

  chosenPickId = button.dataset.choosePick;
  slotAssignments[0] = chosenPickId;
  renderDetectedTeam();
  render();
});
recommendations.addEventListener("pointerdown", trackDetailsSummaryPointer, true);
recommendations.addEventListener("click", handleDetailsSummaryClick, true);

matchFeedback.addEventListener("click", (event) => {
  if (shouldIgnoreSelectionClick(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

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

  const feedbackTeamIds = slotAssignments.slice(1).filter(Boolean);
  if (!canSubmitMatchFeedback(feedbackTeamIds, chosenPickId)) return;

  const currentFeedbackKey = feedbackWindowKey(feedbackTeamIds, chosenPickId, tierSelect.value);
  if (submittedFeedbackKeys.has(currentFeedbackKey)) return;

  const feedbackValue = Number(button.dataset.matchFeedback);
  const pendingItem = queueRemoteFeedback(feedbackTeamIds, chosenPickId, feedbackValue, tierSelect.value, "new-feedback");
  if (!pendingItem) return;

  button.classList.add(Number(button.dataset.matchFeedback) > 0 ? "feedback-pop-like" : "feedback-pop-dislike");
  button.closest(".chosen-actions")?.querySelectorAll("[data-match-feedback]").forEach((item) => {
    item.disabled = true;
  });


  submittedFeedbackKeys.add(currentFeedbackKey);
  recordFeedback(feedbackTeamIds, chosenPickId, feedbackValue, tierSelect.value);
  markRecentFeedback(feedbackTeamIds, chosenPickId, tierSelect.value);
  syncStatus.textContent = t("sync.saving");
  syncStatus.dataset.state = "loading";
  recordRemoteFeedback(feedbackTeamIds, chosenPickId, feedbackValue, tierSelect.value)
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
matchFeedback.addEventListener("pointerdown", trackDetailsSummaryPointer, true);
matchFeedback.addEventListener("click", handleDetailsSummaryClick, true);

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
  // Update active class on player cards without full rebuild
  unionPlayerGrid.querySelectorAll(".union-player-card").forEach((card, i) => {
    card.classList.toggle("active", i === activeUnionPlayer);
  });
  unionPlayerGrid.querySelectorAll("[data-union-player]").forEach((btn) => {
    const idx = Number(btn.dataset.unionPlayer);
    btn.closest(".union-player-card")?.classList.toggle("active", idx === activeUnionPlayer);
  });
  unionCharacterGrid.scrollTop = 0;
  renderUnionCharacters({ preserveScroll: false });
  // 저장 행 레이블만 업데이트 (패널 전체 재렌더 없음)
  const saveLabel = unionPresetPanel.querySelector(".union-preset-save-label");
  if (saveLabel) saveLabel.textContent = unionPlayerName(activeUnionPlayer);
});

unionCharacterGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-union-pick]");
  if (!card) return;
  const roster = unionRosters[activeUnionPlayer];
  const variantId = card.dataset.unionPick;
  if (roster.has(variantId)) {
    roster.delete(variantId);
    card.setAttribute("aria-pressed", "false");
  } else {
    if (roster.size >= 15) {
      card.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 200 });
      return;
    }
    roster.add(variantId);
    card.setAttribute("aria-pressed", "true");
  }
  saveUnionRosters();
  normalizeUnionPlayers();
  renderUnionPlayers();
});

unionConfirmButton.addEventListener("click", () => {
  renderUnionResults();
});

unionResults.addEventListener("click", (event) => {
  if (event.target.closest("[data-show-more-union]")) {
    unionComboLimit += 5;
    renderUnionComboResults();
  }
});

unionRoleFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-union-role]");
  if (!button) return;
  activeUnionRole = button.dataset.unionRole;
  // Update aria-pressed without full rebuild
  unionRoleFilters.querySelectorAll("[data-union-role]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn === button ? "true" : "false");
  });
  unionCharacterGrid.scrollTop = 0;
  renderUnionCharacters({ preserveScroll: false });
});

unionSearchInput.addEventListener("input", () => {
  renderUnionCharacters({ preserveScroll: false });
});

// Custom dropdown: close all open dropdowns except the given one
function closeUnionPresetDropdowns(except = null) {
  unionPresetPanel.querySelectorAll(".union-preset-dropdown").forEach((dd) => {
    if (dd === except) return;
    const list = dd.querySelector(".updd-list");
    const trigger = dd.querySelector(".updd-trigger");
    if (list) list.classList.remove("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    dd.classList.remove("updd-open");
  });
}

function closeUnionPresetDropdown(dropdown) {
  if (!dropdown) return;
  const list = dropdown.querySelector(".updd-list");
  const trigger = dropdown.querySelector(".updd-trigger");
  if (list) list.classList.remove("is-open");
  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
    trigger.blur();
  }
  dropdown.classList.remove("updd-open");
}

// Close dropdowns when clicking outside the panel
document.addEventListener("click", (event) => {
  if (!unionPresetPanel.contains(event.target)) {
    closeUnionPresetDropdowns();
  }
});

["pointerdown", "mousedown", "click"].forEach((eventName) => {
  unionPresetPanel.addEventListener(eventName, (event) => {
    const input = event.target.closest("#union-preset-name-input");
    if (!input) return;
    closeUnionPresetDropdowns();
    event.stopImmediatePropagation();
    if (eventName !== "click") {
      window.setTimeout(() => input.focus(), 0);
    }
  });
});

unionPresetPanel.addEventListener("click", (event) => {
  if (event.target.closest(".union-preset-save-btn")) {
  // 저장 버튼 — 공유 입력란 사용, 현재 활성 플레이어에 저장
    const nameInput = unionPresetPanel.querySelector("#union-preset-name-input");
    const rawName = nameInput ? nameInput.value.trim() : "";
    const name = rawName || getUnionAutoPresetName();
    const variants = [...unionRosters[activeUnionPlayer]];
    if (variants.length === 0) {
      const msgEl = unionPresetPanel.querySelector("#union-preset-saved-msg");
      if (msgEl) {
        msgEl.textContent = t("union.presetEmpty");
        clearTimeout(_unionPresetSaveTimer);
        _unionPresetSaveTimer = setTimeout(() => { msgEl.textContent = ""; }, 2000);
      }
      return;
    }
    const idx = unionPresets.findIndex((p) => p.name === name);
    if (idx >= 0) {
      unionPresets[idx].variants = variants;
    } else {
      unionPresets.push({ name, variants });
    }
    saveUnionPresetsToStorage();
    if (nameInput) nameInput.value = "";
    updateUnionPresetDropdowns();
    // 저장 완료 메시지
    const msgEl = unionPresetPanel.querySelector("#union-preset-saved-msg");
    if (msgEl) {
      msgEl.textContent = t("union.presetSaved", { name });
      clearTimeout(_unionPresetSaveTimer);
      _unionPresetSaveTimer = setTimeout(() => { msgEl.textContent = ""; }, 2000);
    }
    return;
  }

  // 커스텀 드롭다운 트리거 클릭 → 열기/닫기
  const triggerBtn = event.target.closest(".updd-trigger");
  if (triggerBtn) {
    const dropdown = triggerBtn.closest(".union-preset-dropdown");
    const list = dropdown.querySelector(".updd-list");
    const isOpen = list.classList.contains("is-open");
    closeUnionPresetDropdowns(dropdown);
    list.classList.toggle("is-open", !isOpen);
    dropdown.classList.toggle("updd-open", !isOpen);
    triggerBtn.setAttribute("aria-expanded", String(!isOpen));
    return;
  }

  // 커스텀 드롭다운 아이템 선택
  const item = event.target.closest(".updd-item");
  if (item) {
    const dropdown = item.closest(".union-preset-dropdown");
    const list = dropdown.querySelector(".updd-list");
    const valueEl = dropdown.querySelector(".updd-value");
    const row = dropdown.closest("[data-preset-player]");
    const loadBtn = row ? row.querySelector(".union-preset-load-btn") : null;
    const deleteBtn = row ? row.querySelector(".union-preset-delete-btn") : null;
    const idx = item.dataset.presetIndex;
    const playerIndex = Number(row?.dataset.presetPlayer ?? 0);
    const presets = unionPresets;
    dropdown.dataset.selectedIndex = idx;
    valueEl.textContent = presets[Number(idx)]?.name ?? t("preset.empty");
    list.querySelectorAll(".updd-item").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.presetIndex === idx);
    });
    closeUnionPresetDropdown(dropdown);
    if (loadBtn) loadBtn.disabled = false;
    if (deleteBtn) deleteBtn.disabled = false;
    return;
  }

  // 불러오기 버튼 — 해당 플레이어에만 적용, 패널 전체 재렌더 없음
  const row = event.target.closest("[data-preset-player]");
  if (!row) return;
  if (event.target.closest(".union-preset-delete-btn")) {
    const dropdown = row.querySelector(".union-preset-dropdown");
    const selectedIndex = dropdown?.dataset.selectedIndex;
    if (selectedIndex === "" || selectedIndex === undefined) return;
    const index = Number(selectedIndex);
    const preset = unionPresets[index];
    if (!preset) return;
    unionPresets.splice(index, 1);
    saveUnionPresetsToStorage();
    updateUnionPresetDropdowns();
    closeUnionPresetDropdowns();
    const msgEl = unionPresetPanel.querySelector("#union-preset-saved-msg");
    if (msgEl) {
      msgEl.textContent = t("union.presetDeleted", { name: preset.name });
      clearTimeout(_unionPresetSaveTimer);
      _unionPresetSaveTimer = setTimeout(() => { msgEl.textContent = ""; }, 2000);
    }
    return;
  }

  if (event.target.closest(".union-preset-load-btn")) {
    const playerIndex = Number(row.dataset.presetPlayer);
    const dropdown = row.querySelector(".union-preset-dropdown");
    const selectedIndex = dropdown?.dataset.selectedIndex;
    if (selectedIndex === "" || selectedIndex === undefined) return;
    const index = Number(selectedIndex);
    const preset = unionPresets[index];
    if (!preset) return;
    unionRosters[playerIndex].clear();
    preset.variants.forEach((id) => unionRosters[playerIndex].add(id));
    saveUnionRosters();
    // 활성 플레이어가 방금 로드한 플레이어일 때만 캐릭터 그리드 갱신
    if (playerIndex === activeUnionPlayer) {
      renderUnionCharacters();
    }
    renderUnionPlayers();
    closeUnionPresetDropdown(dropdown);
  }
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

const recoveredFeedbackCount = recoverLocalFeedbackToPendingQueue();
if (recoveredFeedbackCount > 0) {
  syncStatus.textContent = t("sync.localPending", { count: recoveredFeedbackCount });
  syncStatus.dataset.state = "loading";
}

setupErUpdater();
render();
if (isElectron) {
  setTimeout(checkForUpdatesOnStartup, 1200);
  startPeriodicUpdateChecks();
}
startPeriodicPendingFeedbackSync();
