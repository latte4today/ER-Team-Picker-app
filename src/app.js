import { characterVariants, roleNames, roles } from "./data.js";
import { feedbackWindowKey, getFeedbackEntry, hasRecentFeedback, markRecentFeedback, recordFeedback } from "./feedback.js";
import { matchesKoreanSearch } from "./koreanSearch.js";
import { rankerCandidateStats, rankerCompositionStats } from "./metaData.js";
import { evaluateCandidate, recommend } from "./recommender.js";
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
const tutorialModal = document.querySelector("#tutorial-modal");
const tutorialStartButton = document.querySelector("#tutorial-start-button");
const tutorialBanner = document.querySelector("#tutorial-banner");
const tutorialEndButton = document.querySelector("#tutorial-end-button");

let activeSlot = null;
let recentlyAssignedVariantId = null;
let remoteFeedback = {};
let popularFeedback = [];
let isRefreshingRemote = false;
let isRefreshingPopular = false;
let popularFeedbackLoaded = false;
let chosenPickId = null;
const submittedFeedbackKeys = new Set();
const slotAssignments = [null, null, null];
const savedTheme = localStorage.getItem("er-team-picker-theme");
const tutorialStorageKey = "er-team-picker-tutorial-seen";
const legacyPlayableStorageKey = "er-team-picker-playable-characters";
const playableStorageKey = "er-team-picker-playable-variants";
const unionStorageKey = "er-team-picker-union-rosters";
const savedPlayableVariants = JSON.parse(localStorage.getItem(playableStorageKey) ?? "[]");
const savedPlayableCharacters = JSON.parse(localStorage.getItem(legacyPlayableStorageKey) ?? "[]");
const playableVariantIds = new Set(savedPlayableVariants.length > 0
  ? savedPlayableVariants
  : characterVariants
    .filter((character) => savedPlayableCharacters.includes(character.characterId))
    .map((character) => character.variantId));
let playableEditMode = false;
let activeView = appMain?.dataset.view ?? "setup";
let activeUnionPlayer = 0;
let activeUnionRole = "all";
const unionPlayerNames = ["플레이어 1", "플레이어 2", "플레이어 3", "플레이어 4"];
const unionParticipatingPlayers = new Set([0, 1, 2]);
const savedUnionRosters = JSON.parse(localStorage.getItem(unionStorageKey) ?? "[]");
const unionRosters = Array.from({ length: 4 }, (_, index) => new Set(savedUnionRosters[index] ?? []));
let tutorialMode = false;
let tutorialFeedbackSubmitted = false;

function characterName(characterId) {
  return characterVariants.find((character) => character.characterId === characterId)?.name ?? characterId;
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
    name: character.name,
    image: character.image,
    role: roleNames[character.role] ?? character.role,
    weapon: character.weaponLabel,
  };
}

function characterSubtitle(character) {
  return [roleNames[character.role], character.weaponLabel, character.weaponStyle].filter(Boolean).join(" · ");
}

function compactReasonLabels(reasons = []) {
  const joined = reasons.join(" ");
  const labels = [];
  const add = (label) => {
    if (!labels.includes(label)) labels.push(label);
  };

  if (/앞라인|탱커|진입|받아치/.test(joined)) add("앞라인 보완");
  if (/마무리|킬캐치|화력|데미지|딜러 자리/.test(joined)) add(/부족|모자|감점/.test(joined) ? "마무리 화력 부족" : "마무리 화력 보완");
  if (/CC|이니시|교전 시작|진입각/.test(joined)) add("교전 시작 보완");
  if (/보호|세이브|받아치|안정/.test(joined)) add("아군 보호 보완");
  if (/사거리|포킹|대치/.test(joined)) add("대치 구도 보완");
  if (/데미지 기여가 충분|화력을 보탤|화력을 채워/.test(joined)) add("데미지 충분");
  if (/데미지 기여가 부족|화력 총량이 부족|화력이 부족/.test(joined)) add("데미지 부족 주의");
  if (/평가 데이터|좋게 기록|랭커|전적/.test(joined)) add("데이터상 양호");
  if (/감점|낮게 잡힐|위험/.test(joined)) add("주의 필요");

  return labels.slice(0, 3);
}

function compactReasonText(reasons = []) {
  const labels = compactReasonLabels(reasons);
  if (labels.length > 0) return labels.join(" · ");
  return "현재 조합에서 부족한 부분을 보완합니다.";
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("er-team-picker-theme", nextTheme);
  themeToggle.textContent = nextTheme === "dark" ? "다크 모드" : "라이트 모드";
  themeToggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
}

setTheme(savedTheme ?? "dark");

function closeTutorialModal(markSeen = true) {
  if (tutorialModal) tutorialModal.hidden = true;
  if (markSeen) localStorage.setItem(tutorialStorageKey, "1");
}

function showTutorialModalIfNeeded() {
  if (!tutorialModal || localStorage.getItem(tutorialStorageKey) === "1") return;
  tutorialModal.hidden = false;
}

function setTutorialBannerVisible(visible) {
  if (tutorialBanner) tutorialBanner.hidden = !visible;
}

function startTutorial() {
  tutorialMode = true;
  tutorialFeedbackSubmitted = false;
  activeView = "setup";
  activeSlot = null;
  playableEditMode = false;
  slotAssignments[0] = null;
  slotAssignments[1] = "arda:arcana";
  slotAssignments[2] = "piolo:nunchaku";
  syncSelectedFromSlots();
  closeTutorialModal(true);
  setTutorialBannerVisible(true);
  renderDetectedTeam([], "샘플 팀원 2명을 넣었습니다. 오른쪽 추천 후보에서 내 픽을 하나 기록해보세요.");
  render();
}

function endTutorial({ clearSample = true } = {}) {
  tutorialMode = false;
  tutorialFeedbackSubmitted = false;
  setTutorialBannerVisible(false);
  localStorage.setItem(tutorialStorageKey, "1");
  if (clearSample) {
    slotAssignments.fill(null);
    selectedIds.clear();
    chosenPickId = null;
    activeSlot = null;
    renderDetectedTeam([], "튜토리얼을 종료했습니다.");
  }
  render();
}

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

async function checkForUpdates() {
  updateCheckButton.disabled = true;
  updateStatus.innerHTML = "최신 버전 확인 중";
  try {
    const release = await fetchLatestRelease();
    const latestVersion = release.tag_name ?? release.name ?? "";
    if (compareVersions(latestVersion, appVersion) <= 0) {
      updateStatus.innerHTML = `현재 최신 버전입니다. <small>v${appVersion}</small>`;
      return;
    }

    const installerUrl = releaseInstallerUrl(release);
    updateStatus.innerHTML = `
      <strong>새 버전 ${latestVersion}</strong>
      <a href="${installerUrl}" target="_blank" rel="noreferrer">설치 파일 열기</a>
      <small>설치 전 앱을 종료해주세요.</small>
    `;
  } catch (error) {
    updateStatus.innerHTML = `업데이트 확인 실패 <small>${error.message ?? "네트워크를 확인해주세요."}</small>`;
  } finally {
    updateCheckButton.disabled = false;
  }
}

async function fetchLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${releaseConfig.owner}/${releaseConfig.repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub 응답 오류 ${response.status}`);
  return response.json();
}

async function checkForUpdatesOnStartup() {
  try {
    const release = await fetchLatestRelease();
    const latestVersion = release.tag_name ?? release.name ?? "";
    if (compareVersions(latestVersion, appVersion) <= 0) return;

    const installerUrl = releaseInstallerUrl(release);
    updateStatus.innerHTML = `
      <strong>새 버전 ${latestVersion}</strong>
      <a href="${installerUrl}" target="_blank" rel="noreferrer">설치 파일 열기</a>
      <small>설치 전 앱을 종료해주세요.</small>
    `;

    const wantsUpdate = window.confirm(`새로운 업데이트가 있습니다.\n\n현재 버전: v${appVersion}\n최신 버전: ${latestVersion}\n\n업데이트를 받으시겠습니까?`);
    if (wantsUpdate) window.open(installerUrl, "_blank", "noopener,noreferrer");
  } catch {
    // 시작할 때 네트워크가 막혀 있어도 앱 사용은 계속 가능해야 합니다.
  }
}

function renderRoleFilters() {
  const filters = [{ id: "all", label: "전체" }, ...roles];
  roleFilters.innerHTML = filters
    .map((role) => {
      const pressed = role.id === activeRole ? "true" : "false";
      return `<button class="filter-button" type="button" data-role="${role.id}" aria-pressed="${pressed}">${role.label}</button>`;
    })
    .join("");
}

function renderCharacters({ preserveScroll = true } = {}) {
  const previousScrollTop = characterGrid.scrollTop;
  const query = searchInput.value.trim().toLowerCase();
  const filtered = characterVariants.filter((character) => {
    const matchesRole = activeRole === "all" || character.role === activeRole;
    const matchesQuery = matchesKoreanSearch(character.name, query);
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
            <span hidden>${character.name.slice(0, 1)}</span>
          </span>
          <span class="character-info">
            <strong>${character.name}</strong>
            <small>${characterSubtitle(character)}</small>
          </span>
          ${playable ? `<span class="playable-mark">가능</span>` : ""}
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
  const filters = [{ id: "all", label: "전체" }, ...roles];
  unionRoleFilters.innerHTML = filters
    .map((role) => {
      const pressed = role.id === activeUnionRole ? "true" : "false";
      return `<button class="filter-button" type="button" data-union-role="${role.id}" aria-pressed="${pressed}">${role.label}</button>`;
    })
    .join("");
}

function unionRosterLabel(index) {
  const count = unionRosters[index].size;
  return count > 0 ? `${count}개 픽 등록` : "실험체 폭 없음";
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
            <span>출전</span>
          </label>
        `
        : `<span class="union-player-fixed">${hasRoster ? "자동 참여" : "멤버 없음"}</span>`;
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
    const matchesQuery = matchesKoreanSearch(character.name, query);
    return matchesRole && matchesQuery;
  });

  unionCharacterGrid.innerHTML = filtered
    .map((character) => {
      const selected = currentRoster.has(character.variantId);
      return `
        <button class="character-card union-character-card" type="button" data-union-pick="${character.variantId}" aria-pressed="${selected}">
          <span class="avatar">
            <img src="${character.image}" alt="" loading="lazy" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
            <span hidden>${character.name.slice(0, 1)}</span>
          </span>
          <span class="character-info">
            <strong>${character.name}</strong>
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
  if (rolesInCombo.has("frontline") && (rolesInCombo.has("ranged") || rolesInCombo.has("mage"))) {
    return "앞라인과 후방 딜러가 함께 있어 교전 구조가 안정적입니다.";
  }
  if ((rolesInCombo.has("bruiser") || rolesInCombo.has("assassin")) && tags.has("focus")) {
    return "진입 후 한 대상을 빠르게 몰아치는 포커싱이 좋습니다.";
  }
  if (tags.has("initiate") && tags.has("cc")) {
    return "이니쉬와 CC가 있어 먼저 싸움을 열기 좋습니다.";
  }
  return reasons[0] ?? "세 플레이어의 실험체 폭 안에서 점수가 높은 조합입니다.";
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
    unionSummary.textContent = `${rosterPlayers.length}명 등록`;
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>최소 3명의 실험체 폭을 등록해주세요.</strong>
        <span>멤버가 없는 칸은 비워두면 계산에서 자동 제외됩니다.</span>
      </div>
    `;
    return;
  }

  if (players.length !== 3) {
    unionSummary.textContent = `${players.length}명 출전`;
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>출전할 플레이어 3명을 선택해주세요.</strong>
        <span>실험체 폭이 있는 멤버가 4명이면 그중 실제 출전할 3명을 체크해야 합니다.</span>
      </div>
    `;
    return;
  }

  const emptyPlayer = players.find((player) => unionRosters[player].size === 0);
  if (emptyPlayer !== undefined) {
    unionSummary.textContent = "대기 중";
    unionResults.innerHTML = `
      <div class="setup-recommendation-empty">
        <strong>${unionPlayerNames[emptyPlayer]}의 실험체 폭을 등록해주세요.</strong>
        <span>각 플레이어 카드로 이동한 뒤 가능한 실험체를 여러 개 선택하면 됩니다.</span>
      </div>
    `;
    return;
  }

  const combos = buildUnionCombos();
  unionSummary.textContent = `${combos.length}개 조합`;
  if (combos.length === 0) {
    unionResults.innerHTML = `<p class="empty-state">중복 실험체를 제외하면 만들 수 있는 조합이 없습니다.</p>`;
    return;
  }

  unionResults.innerHTML = combos
    .map((item, index) => {
      const scoreTone = item.score < 0 ? " negative-score" : "";
      return `
        <article class="union-combo-card">
          <div class="combo-card-head">
            <span class="recommendation-rank">조합 ${index + 1}</span>
            <strong class="score${scoreTone}">${item.score}</strong>
          </div>
          <div class="union-combo-members">
            ${item.combo
              .map((character, memberIndex) => `
                <span class="combo-face">
                  <img src="${character.image}" alt="">
                  <span>
                    <strong>${item.players[memberIndex] + 1}P · ${character.name}</strong>
                    <small>${characterSubtitle(character)}</small>
                  </span>
                </span>
              `)
              .join("")}
          </div>
          <p>${unionComboReason(item.combo, item.reasons)}</p>
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

function renderPlayableTools() {
  const count = playableVariantIds.size;
  playableModeButton.classList.toggle("active", playableEditMode);
  playableModeButton.textContent = playableEditMode ? "설정 완료" : "가능 실험체 설정";
  playableModeButton.setAttribute("aria-pressed", String(playableEditMode));
  clearPlayableButton.disabled = count === 0;
  playableStatus.textContent = count > 0 ? `가능 픽 ${count}개 안에서 추천` : "전체 실험체 추천 중";
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
    selectedTeam.innerHTML = `<p class="empty-state">팀원이 고른 실험체를 선택하면 추천이 바로 갱신됩니다.</p>`;
    return;
  }

  selectedTeam.innerHTML = selected
    .map((character) => `<span class="team-chip">${character.name}<small>${[character.weaponLabel, character.weaponStyle].filter(Boolean).join(" · ")}</small></span>`)
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
    detectedTeam.innerHTML = `<p class="detected-status">카드를 클릭하면 팀원 1, 팀원 2, 나 순서로 자동 기록됩니다.</p>`;
    return;
  }

  const manualChips = assigned
    .map(({ slotIndex, variant }) => {
      const slotText = slotIndex === 0 ? "나" : `팀원 ${slotIndex}`;
      return `
        <span class="detected-chip">
          <img src="${variant.image}" alt="">
          <strong>${variant.name}</strong>
          <small>${slotText} · ${variant.weaponLabel}</small>
        </span>
      `;
    })
    .join("");

  const detectedChips = matches.length > 0 && assigned.length === 0
    ? matches
        .map((match) => {
          const percent = Math.round(match.confidence * 100);
          const weaponText = match.weapon ? ` · ${primaryVariantForCharacter(match.character.id, match.weapon)?.weaponLabel ?? match.weapon}` : "";
          const slotText = match.isSelf ? "나" : "팀원";
          return `
            <span class="detected-chip">
              <img src="${match.character.image}" alt="">
              <strong>${match.character.name}</strong>
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
  const filters = [{ id: "all", label: "전체" }, ...roles];
  return `
    <div class="rank-filter-row" aria-label="실험체 랭킹 역할 필터">
      ${filters
        .map((role) => {
          const pressed = role.id === activeRankRole ? "true" : "false";
          return `<button class="filter-button" type="button" data-rank-role="${role.id}" aria-pressed="${pressed}">${role.label}</button>`;
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
    return "앞라인이 시야와 진입각을 만들고, 후방 딜러가 안정적으로 딜을 넣기 좋은 조합입니다.";
  }
  if ((roles.has("bruiser") || roles.has("assassin")) && tags.has("focus")) {
    return "한 대상을 빠르게 몰아칠 수 있어 교전 시작 후 킬 결정력이 높습니다.";
  }
  if (tags.has("initiate") && tags.has("cc")) {
    return "이니쉬와 CC가 함께 있어 먼저 싸움을 열고 흐름을 잡기 좋습니다.";
  }
  if (tags.has("peel") && (roles.has("ranged") || roles.has("mage"))) {
    return "아군 보호 능력과 원거리 딜이 함께 있어 받아치는 교전에 강점이 있습니다.";
  }
  if (ranges.has("melee") && ranges.has("ranged")) {
    return "근거리와 원거리 역할이 섞여 있어 교전 거리 선택지가 넓습니다.";
  }

  const top3 = Math.round((row.top3Rate ?? 0) * 100);
  if (isUserFeedback) return "사용자 평가에서 실제 경기 후 반응이 좋았던 조합입니다.";
  if (top3 >= 70) return "랭커 전적에서 상위권으로 마무리한 비율이 높아 안정성이 확인된 조합입니다.";
  return "랭커 전적에서 반복적으로 등장해 참고할 만한 조합입니다.";
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
      const detail = row.teamKey ? `좋아요 ${row.likes} · 평가 ${row.total}` : `랭커 ${row.games}판 · TOP3 ${Math.round((row.top3Rate ?? 0) * 100)}%`;
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

  const overallItems = renderComboCards(overallComps.length > 0 ? overallComps : fallbackComps, "전체", overallComps.length > 0);
  const recentItems = renderComboCards(recentComps.length > 0 ? recentComps : fallbackComps.slice(0, 14), "최근", recentComps.length > 0);

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
            <small>${character.role} · ${row.games}판 · TOP3 ${Math.round(row.top3Rate * 100)}%</small>
          </div>
        </article>
      `;
    })
    .join("");
  const rankRoleLabel = activeRankRole === "all" ? "전체 실험체" : (roleNames[activeRankRole] ?? activeRankRole);

  recommendations.innerHTML = `
    <div class="recommendation-hub">
      <section class="combo-section">
        <div class="section-title-row">
          <h3>추천 조합</h3>
        <span>사용자 경기 후 평가 기준</span>
        </div>
        <div class="combo-split">
          <div>
            <h4>전체 득표 상위</h4>
            <div class="combo-grid">${overallItems}</div>
          </div>
          <div>
            <h4>최근 득표 상위</h4>
            <div class="combo-grid">${recentItems}</div>
          </div>
        </div>
      </section>
      <section class="rank-section">
        <div class="section-title-row">
          <h3>실험체 랭킹</h3>
          <span>DAK.GG 랭커 최근 스쿼드 전적 기준 · ${rankRoleLabel} ${rankRows.length}명</span>
        </div>
        ${renderRankRoleFilters()}
        <div class="rank-grid">${rankItems || `<p class="empty-state">해당 역할군의 랭킹 데이터가 없습니다.</p>`}</div>
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
        <strong>팀원을 선택하면 추천 후보가 표시됩니다.</strong>
        <span>실험체 카드를 누르면 팀원 1, 팀원 2, 나 순서로 기록되며 추천이 바로 갱신됩니다.</span>
      </div>
    `;
    return;
  }

  const playablePool = playableVariantIds.size > 0 ? [...playableVariantIds] : undefined;
  const results = recommend([...selectedIds], tierSelect.value, remoteFeedback, playablePool, popularFeedback);
  if (results.length === 0) {
    recommendations.innerHTML = `<p class="empty-state">현재 가능 실험체 목록 안에는 추천할 후보가 없습니다.</p>`;
    return;
  }
  recommendations.innerHTML = results
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
            <span hidden>${result.character.name.slice(0, 1)}</span>
          </div>
          <div class="recommendation-main">
            <div class="recommendation-title">
              <span class="recommendation-rank">추천 ${index + 1}</span>
              <h3>${result.character.name}</h3>
              <span>${characterSubtitle(result.character)}</span>
            </div>
            <p class="recommendation-summary">${compactText}</p>
            <div class="recommendation-tags">${compactLabels}</div>
            <details class="recommendation-details">
              <summary>상세 설명</summary>
              <ul>${reasonList}</ul>
            </details>
            <div class="feedback-row">
              <button class="feedback-button" type="button" data-choose-pick="${result.character.variantId}">내 선택으로 기록</button>
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
    matchFeedback.innerHTML = `<p class="empty-state">내 픽을 지정하면 경기 후 평가할 수 있습니다.</p>`;
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
    (tutorialMode && tutorialFeedbackSubmitted) ||
    submittedFeedbackKeys.has(currentFeedbackKey) ||
    hasRecentFeedback([...selectedIds], chosen.variantId, tierSelect.value);
  const doneText = tutorialMode ? "튜토리얼 평가 완료 · 실제 데이터에는 저장되지 않았습니다." : "평가가 반영되었습니다.";
  const feedbackControls = hasSubmittedFeedback
    ? `
      <div class="chosen-feedback-done" aria-live="polite">
        <strong>${doneText}</strong>
      </div>
      <button class="icon-button clear-pick-button" type="button" data-clear-pick aria-label="선택 해제" title="선택 해제">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m18 6-12 12"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
    `
    : `
      <div class="chosen-actions" aria-label="경기 후 평가">
        <button class="icon-button feedback-like" type="button" data-match-feedback="1" aria-label="좋았음" title="좋았음">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Z"></path>
            <path d="M7 11 11 2a3 3 0 0 1 3 3v4h5a3 3 0 0 1 3 3l-2 7a3 3 0 0 1-3 3H7V11Z"></path>
          </svg>
        </button>
        <button class="icon-button feedback-dislike" type="button" data-match-feedback="-1" aria-label="별로였음" title="별로였음">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3V2Z"></path>
            <path d="M17 13 13 22a3 3 0 0 1-3-3v-4H5a3 3 0 0 1-3-3l2-7a3 3 0 0 1 3-3h10v11Z"></path>
          </svg>
        </button>
        <button class="icon-button clear-pick-button" type="button" data-clear-pick aria-label="선택 해제" title="선택 해제">
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
        <strong>${chosen.name}</strong>
        <small>${[chosen.weaponLabel, chosen.weaponStyle, feedbackLabel(chosen.variantId)].filter(Boolean).join(" · ")}</small>
      </div>
      ${score}
      ${feedbackControls}
    </div>
    <div class="combo-evaluation">
      <div>
        <strong>현재 조합 진단</strong>
        <p>${compactText}</p>
      </div>
      <div class="recommendation-tags">${compactLabels}</div>
      <details class="recommendation-details">
        <summary>상세 설명</summary>
        <ul>${reasonList}</ul>
      </details>
    </div>
  `;
}

function feedbackLabel(candidateId) {
  const entry = getFeedbackEntry([...selectedIds], candidateId, tierSelect.value);
  const total = entry.likes + entry.dislikes;
  if (total === 0) return "평가 없음";
  return `좋음 ${entry.likes} · 싫음 ${entry.dislikes}`;
}

async function refreshRemoteFeedback() {
  if (isRefreshingRemote) return;
  isRefreshingRemote = true;
  try {
    syncStatus.textContent = "서버 확인 중";
    syncStatus.dataset.state = "loading";
    remoteFeedback = await loadRemoteFeedback([...selectedIds], tierSelect.value);
    syncStatus.textContent = "서버 연결됨";
    syncStatus.dataset.state = "ok";
  } catch {
    remoteFeedback = {};
    syncStatus.textContent = "서버 연결 실패";
    syncStatus.dataset.state = "error";
  } finally {
    isRefreshingRemote = false;
  }
  renderRecommendations();
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
  recommendTitle.textContent = activeView === "recommendations" ? "랭킹" : "추천 후보";
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
    topbarTitle.textContent = "유니온 사전 팀 조합 추천";
    selectedCount.textContent = unionParticipatingPlayers.size;
    selectedCount.nextElementSibling.textContent = " / 3명 참여";
  } else {
    topbarEyebrow.textContent = activeView === "recommendations" ? "Meta Dashboard" : "Squad Draft Assistant";
    topbarTitle.textContent = activeView === "recommendations" ? "추천 조합과 실험체 랭킹" : "우리 팀에 맞는 실험체 추천";
    selectedCount.nextElementSibling.textContent = " / 2명 선택됨";
  }
  refreshRemoteFeedback();
  refreshPopularFeedback();
}

function renderManualSlots() {
  manualSlots.querySelectorAll("[data-manual-slot]").forEach((button) => {
    const slotIndex = Number(button.dataset.manualSlot);
    const variant = characterVariants.find((character) => character.variantId === slotAssignments[slotIndex]);
    button.classList.toggle("active", activeSlot === slotIndex);
    button.classList.toggle("filled", Boolean(variant));
    button.textContent = variant ? `${slotIndex === 0 ? "나" : `팀원 ${slotIndex}`} · ${variant.name}` : slotIndex === 0 ? "나" : `팀원 ${slotIndex}`;
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
updateCheckButton.addEventListener("click", checkForUpdates);

contactModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-contact-close]")) closeContactModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !contactModal.hidden) closeContactModal();
  if (event.key === "Escape" && tutorialModal && !tutorialModal.hidden) closeTutorialModal(true);
});

tutorialStartButton?.addEventListener("click", startTutorial);
tutorialEndButton?.addEventListener("click", () => endTutorial());
tutorialModal?.addEventListener("click", (event) => {
  if (!event.target.closest("[data-tutorial-skip]")) return;
  closeTutorialModal(true);
});

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const replyTo = contactReply.value.trim();
  const message = contactMessage.value.trim();
  if (!replyTo) {
    contactStatus.textContent = "답장받을 이메일을 입력해주세요.";
    contactReply.focus();
    return;
  }
  if (!message) {
    contactStatus.textContent = "문의 내용을 입력해주세요.";
    contactMessage.focus();
    return;
  }

  contactStatus.textContent = "전송 중";
  submitContactMessage({
    replyTo,
    message,
    appVersion: "desktop",
  })
    .then(() => {
      contactStatus.textContent = "문의가 전송되었습니다.";
      contactForm.reset();
      setTimeout(closeContactModal, 900);
    })
    .catch((error) => {
      contactStatus.textContent = error.message ? `전송 실패: ${error.message}` : "전송 실패";
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
tierSelect.addEventListener("change", () => {
  renderRecommendations();
  refreshRemoteFeedback();
});

recommendations.addEventListener("click", (event) => {
  if (toggleDetailsSummary(event)) return;

  const rankRoleButton = event.target.closest("[data-rank-role]");
  if (rankRoleButton) {
    activeRankRole = rankRoleButton.dataset.rankRole;
    renderRecommendations();
    return;
  }

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

  if (tutorialMode) {
    tutorialFeedbackSubmitted = true;
    syncStatus.textContent = "튜토리얼 평가라 저장하지 않았습니다.";
    syncStatus.dataset.state = "ok";
    window.setTimeout(() => {
      renderMatchFeedback();
      renderRecommendations();
    }, 420);
    return;
  }

  submittedFeedbackKeys.add(currentFeedbackKey);
  recordFeedback([...selectedIds], chosenPickId, Number(button.dataset.matchFeedback), tierSelect.value);
  markRecentFeedback([...selectedIds], chosenPickId, tierSelect.value);
  syncStatus.textContent = "서버 저장 중";
  syncStatus.dataset.state = "loading";
  recordRemoteFeedback([...selectedIds], chosenPickId, Number(button.dataset.matchFeedback), tierSelect.value)
    .then(() => {
      popularFeedbackLoaded = false;
      return Promise.all([refreshRemoteFeedback(), refreshPopularFeedback()]);
    })
    .then(() => {
      renderRecommendations();
    })
    .catch((error) => {
      syncStatus.textContent = error.message ? `서버 저장 실패: ${error.message}` : "서버 저장 실패";
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
  const slotLabel = slotIndex === 0 ? "나" : `팀원 ${slotIndex}`;

  if (slotAssignments[slotIndex]) {
    slotAssignments[slotIndex] = null;
    activeSlot = null;
    syncSelectedFromSlots();
    renderDetectedTeam([], `${slotLabel} 선택을 해제했습니다.`);
    render();
    return;
  }

  if (activeSlot === slotIndex) {
    activeSlot = null;
    renderDetectedTeam([], "슬롯 변경 모드를 취소했습니다.");
    renderManualSlots();
    return;
  }

  activeSlot = slotIndex;
  renderDetectedTeam([], `${slotLabel} 변경 모드입니다. 아래 실험체 카드 하나를 누르면 이 칸에 기록됩니다.`);
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
            <strong>출전 멤버는 3명까지만 선택할 수 있습니다.</strong>
            <span>다른 플레이어의 출전 체크를 먼저 해제한 뒤 다시 선택해주세요.</span>
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

render();
showTutorialModalIfNeeded();
setTimeout(checkForUpdatesOnStartup, 1200);
