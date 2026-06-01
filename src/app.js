import { characterVariants, roleNames, roles } from "./data.js";
import { detectTeamFromScreenshot } from "./detector.js";
import { getFeedbackEntry, recordFeedback } from "./feedback.js";
import { matchesKoreanSearch } from "./koreanSearch.js";
import { rankerCandidateStats, rankerCompositionStats } from "./metaData.js";
import { evaluateCandidate, recommend } from "./recommender.js";
import { loadPopularFeedback, loadRemoteFeedback, recordRemoteFeedback, submitContactMessage } from "./supabaseFeedback.js";

const selectedIds = new Set();
let activeRole = "all";

const characterGrid = document.querySelector("#character-grid");
const selectedTeam = document.querySelector("#selected-team");
const matchFeedback = document.querySelector("#match-feedback");
const recommendations = document.querySelector("#recommendations");
const recommendTitle = document.querySelector("#recommend-section h2");
const selectedCount = document.querySelector("#selected-count");
const clearButton = document.querySelector("#clear-button");
const searchInput = document.querySelector("#search-input");
const roleFilters = document.querySelector("#role-filters");
const screenshotInput = document.querySelector("#screenshot-input");
const screenCaptureButton = document.querySelector("#screen-capture-button");
const clearScreenshotButton = document.querySelector("#clear-screenshot-button");
const detectButton = document.querySelector("#detect-button");
const captureCanvas = document.querySelector("#capture-canvas");
const screenshotPreview = document.querySelector("#screenshot-preview");
const capturePreview = document.querySelector("#capture-preview");
const detectedTeam = document.querySelector("#detected-team");
const tierSelect = document.querySelector("#tier-select");
const slotOverlay = document.querySelector("#slot-overlay");
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
const appMain = document.querySelector(".app-main");
const sideTabs = document.querySelectorAll("[data-view]");

let screenshotImage;
let activeSlot = null;
let remoteFeedback = {};
let popularFeedback = [];
let isRefreshingRemote = false;
let isRefreshingPopular = false;
let popularFeedbackLoaded = false;
let screenStream;
let chosenPickId = null;
const slotAssignments = [null, null, null];
const savedTheme = localStorage.getItem("er-team-picker-theme");
const playableStorageKey = "er-team-picker-playable-characters";
const playableCharacterIds = new Set(JSON.parse(localStorage.getItem(playableStorageKey) ?? "[]"));
let playableEditMode = false;
let activeView = appMain?.dataset.view ?? "setup";

function characterName(characterId) {
  return characterVariants.find((character) => character.characterId === characterId)?.name ?? characterId;
}

function characterById(characterId) {
  return characterVariants.find((character) => character.characterId === characterId);
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

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("er-team-picker-theme", nextTheme);
  themeToggle.textContent = nextTheme === "dark" ? "다크 모드" : "라이트 모드";
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

function renderRoleFilters() {
  const filters = [{ id: "all", label: "전체" }, ...roles];
  roleFilters.innerHTML = filters
    .map((role) => {
      const pressed = role.id === activeRole ? "true" : "false";
      return `<button class="filter-button" type="button" data-role="${role.id}" aria-pressed="${pressed}">${role.label}</button>`;
    })
    .join("");
}

function renderCharacters() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = characterVariants.filter((character) => {
    const matchesRole = activeRole === "all" || character.role === activeRole;
    const matchesQuery = matchesKoreanSearch(character.name, query);
    return matchesRole && matchesQuery;
  });

  characterGrid.innerHTML = filtered
    .map((character) => {
      const selected = selectedIds.has(character.variantId) || chosenPickId === character.variantId;
      const playable = playableCharacterIds.has(character.characterId);
      return `
        <button class="character-card" type="button" data-id="${character.variantId}" data-playable="${playable}" aria-pressed="${selected}">
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
}

function savePlayableCharacters() {
  localStorage.setItem(playableStorageKey, JSON.stringify([...playableCharacterIds]));
}

function renderPlayableTools() {
  const count = playableCharacterIds.size;
  playableModeButton.classList.toggle("active", playableEditMode);
  playableModeButton.textContent = playableEditMode ? "설정 완료" : "가능 실험체 설정";
  playableModeButton.setAttribute("aria-pressed", String(playableEditMode));
  clearPlayableButton.disabled = count === 0;
  playableStatus.textContent = count > 0 ? `가능 실험체 ${count}명 안에서 추천` : "전체 실험체 추천 중";
}

function togglePlayableCharacter(variantId) {
  const variant = characterVariants.find((character) => character.variantId === variantId);
  if (!variant) return;

  if (playableCharacterIds.has(variant.characterId)) {
    playableCharacterIds.delete(variant.characterId);
  } else {
    playableCharacterIds.add(variant.characterId);
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
    selectedTeam.innerHTML = `<p class="empty-state">팀원이 고른 캐릭터를 선택하면 추천이 바로 갱신됩니다.</p>`;
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
    renderSlotOverlay();
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
    renderSlotOverlay();
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
  renderSlotOverlay();
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

function rankerCharacterRows() {
  return Object.entries(rankerCandidateStats)
    .map(([characterId, stat]) => ({
      characterId,
      score: (stat.top3Rate ?? 0) * 100 + (stat.winRate ?? 0) * 120 + Math.min(30, stat.games ?? 0) - (stat.avgPlacement ?? 5) * 4,
      games: stat.games ?? 0,
      top3Rate: stat.top3Rate ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);
}

function compositionReason(row, isUserFeedback) {
  const members = row.teamKey ? [...row.teamKey.split("+"), row.candidateId] : [...row.teammates, row.candidate];
  const characters = members.map(characterById).filter(Boolean);
  const roles = new Set(characters.map((character) => character.role));
  const tags = new Set(characters.flatMap((character) => character.tags));
  const ranges = new Set(characters.map((character) => character.weaponRange));

  if (roles.has("frontline") && (roles.has("ranged") || roles.has("mage"))) {
    return "앞라인이 시야와 진입 각을 만들고, 뒤에서 안정적으로 딜을 넣기 좋은 조합입니다.";
  }
  if ((roles.has("bruiser") || roles.has("assassin")) && tags.has("focus")) {
    return "한 대상을 빠르게 몰아치는 포커싱이 좋아 교전 시작 후 킬 결정력이 높습니다.";
  }
  if (tags.has("initiate") && tags.has("cc")) {
    return "이니쉬와 CC가 함께 있어 먼저 싸움을 열고 흐름을 잡기 좋습니다.";
  }
  if (tags.has("peel") && (roles.has("ranged") || roles.has("mage"))) {
    return "보호 능력과 원거리 딜이 함께 있어 받아치는 교전에 강점이 있습니다.";
  }
  if (ranges.has("melee") && ranges.has("ranged")) {
    return "근거리와 원거리 역할이 섞여 있어 교전 거리 선택지가 넓습니다.";
  }

  const top3 = Math.round((row.top3Rate ?? 0) * 100);
  if (isUserFeedback) return "사용자 평가에서 실제 경기 후 반응이 좋았던 조합입니다.";
  if (top3 >= 70) return "랭커 전적에서 상위권 마무리가 많아 안정성이 확인된 조합입니다.";
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

  const rankItems = rankerCharacterRows()
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
          <span>DAK.GG 랭커 최근 스쿼드 전적 기준</span>
        </div>
        <div class="rank-grid">${rankItems}</div>
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
        <span>실험체 카드를 누르면 팀원 1, 팀원 2, 나 순서로 기록되고 바로 추천이 갱신됩니다.</span>
      </div>
    `;
    return;
  }

  const playablePool = playableCharacterIds.size > 0 ? [...playableCharacterIds] : undefined;
  const results = recommend([...selectedIds], tierSelect.value, remoteFeedback, playablePool, popularFeedback);
  if (results.length === 0) {
    recommendations.innerHTML = `<p class="empty-state">가능 실험체 목록 안에서 추천할 후보가 없습니다.</p>`;
    return;
  }
  recommendations.innerHTML = results
    .map((result, index) => {
      const reasonList = result.reasons.map((reason) => `<li>${reason}</li>`).join("");
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
            <ul>${reasonList}</ul>
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
  const scoreTone = (evaluation?.score ?? 0) < 0 ? " negative-score" : "";
  const score = selectedIds.size > 0 ? `<strong class="chosen-score${scoreTone}">${evaluation?.score ?? "-"}</strong>` : "";

  matchFeedback.innerHTML = `
    <div class="chosen-pick">
      <img src="${chosen.image}" alt="">
      <div>
        <strong>${chosen.name}</strong>
        <small>${[chosen.weaponLabel, chosen.weaponStyle, feedbackLabel(chosen.variantId)].filter(Boolean).join(" · ")}</small>
      </div>
      ${score}
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
    </div>
    <ul class="chosen-reasons">${reasonList}</ul>
  `;
}

function feedbackLabel(candidateId) {
  const entry = getFeedbackEntry([...selectedIds], candidateId, tierSelect.value);
  const total = entry.likes + entry.dislikes;
  if (total === 0) return "평가 없음";
  return `좋음 ${entry.likes} · 싫음 ${entry.dislikes}`;
}

function setScreenshotSource(src, status = "스크린샷을 불러왔습니다.") {
  screenshotImage = new Image();
  screenshotImage.onload = () => {
    screenshotPreview.src = src;
    capturePreview.hidden = false;
    detectButton.disabled = false;
    clearScreenshotButton.disabled = false;
    activeSlot = null;
    renderDetectedTeam([], status);
  };
  screenshotImage.src = src;
}

function clearScreenshot() {
  screenshotImage = undefined;
  screenshotPreview.removeAttribute("src");
  screenshotInput.value = "";
  capturePreview.hidden = true;
  detectButton.disabled = true;
  clearScreenshotButton.disabled = true;
  activeSlot = null;
  slotAssignments.fill(null);
  chosenPickId = null;
  syncSelectedFromSlots();
  renderDetectedTeam([], "스크린샷을 지웠습니다.");
  render();
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
  renderSlotOverlay();
  renderManualSlots();
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

function renderSlotOverlay() {
  slotOverlay.querySelectorAll("[data-slot]").forEach((button) => {
    const slotIndex = Number(button.dataset.slot);
    const variant = characterVariants.find((character) => character.variantId === slotAssignments[slotIndex]);
    button.classList.toggle("active", activeSlot === slotIndex);
    button.classList.toggle("filled", Boolean(variant));
    button.textContent = variant ? `${slotIndex === 0 ? "나" : `팀원 ${slotIndex}`} · ${variant.name}` : button.dataset.slot === "0" ? "나" : `팀원 ${slotIndex}`;
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
    assignSlot(activeSlot, id);
    activeSlot = null;
    renderDetectedTeam();
    render();
    return;
  }

  assignNextPick(id);
  renderDetectedTeam();
  render();
});

roleFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  activeRole = button.dataset.role;
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
    contactStatus.textContent = "답장 받을 이메일을 입력해주세요.";
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

searchInput.addEventListener("input", renderCharacters);
playableModeButton.addEventListener("click", () => {
  playableEditMode = !playableEditMode;
  renderPlayableTools();
  renderCharacters();
});
clearPlayableButton.addEventListener("click", () => {
  playableCharacterIds.clear();
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
  const button = event.target.closest("[data-choose-pick]");
  if (!button) return;

  chosenPickId = button.dataset.choosePick;
  slotAssignments[0] = chosenPickId;
  renderDetectedTeam();
  render();
});

matchFeedback.addEventListener("click", (event) => {
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

  recordFeedback([...selectedIds], chosenPickId, Number(button.dataset.matchFeedback), tierSelect.value);
  syncStatus.textContent = "서버 저장 중";
  syncStatus.dataset.state = "loading";
  recordRemoteFeedback([...selectedIds], chosenPickId, Number(button.dataset.matchFeedback), tierSelect.value)
    .then(() => {
      popularFeedbackLoaded = false;
      return Promise.all([refreshRemoteFeedback(), refreshPopularFeedback()]);
    })
    .then(() => {
      renderRecommendations();
      renderMatchFeedback();
    })
    .catch((error) => {
      syncStatus.textContent = error.message ? `서버 저장 실패: ${error.message}` : "서버 저장 실패";
      syncStatus.dataset.state = "error";
    });
  renderMatchFeedback();
  renderRecommendations();
});

screenshotInput.addEventListener("change", () => {
  const file = screenshotInput.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  setScreenshotSource(url);
});

document.addEventListener("paste", (event) => {
  const imageItem = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;

  const file = imageItem.getAsFile();
  if (!file) return;

  setScreenshotSource(URL.createObjectURL(file), "붙여넣은 이미지를 불러왔습니다.");
});

screenCaptureButton.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    renderDetectedTeam([], "이 브라우저는 화면 캡처를 지원하지 않습니다.");
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = screenStream;
    await video.play();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    setScreenshotSource(canvas.toDataURL("image/png"), "현재 화면을 캡처했습니다.");
  } catch {
    renderDetectedTeam([], "화면 캡처가 취소되었습니다.");
  } finally {
    screenStream?.getTracks().forEach((track) => track.stop());
    screenStream = undefined;
  }
});

clearScreenshotButton.addEventListener("click", clearScreenshot);

manualSlots.addEventListener("click", (event) => {
  const button = event.target.closest("[data-manual-slot]");
  if (!button) return;
  activeSlot = Number(button.dataset.manualSlot);
  renderDetectedTeam([], `${button.textContent} 변경 모드입니다. 아래 카드 하나를 누르면 이 칸에 기록됩니다.`);
  renderManualSlots();
});

slotOverlay.addEventListener("click", (event) => {
  const button = event.target.closest("[data-slot]");
  if (!button) return;
  activeSlot = Number(button.dataset.slot);
  renderDetectedTeam([], `${button.textContent} 슬롯을 선택했습니다. 아래 캐릭터/무기 카드를 눌러 지정하세요.`);
  renderCharacters();
});

detectButton.addEventListener("click", async () => {
  if (!screenshotImage) return;
  detectButton.disabled = true;
  renderDetectedTeam([], "팀 선택 정보를 확인하는 중입니다.");

  try {
    const matches = await detectTeamFromScreenshot(screenshotImage, captureCanvas);
    slotAssignments.fill(null);
    selectedIds.clear();
    matches.forEach((match) => {
      const variant = primaryVariantForCharacter(match.character.id, match.weapon);
      if (variant) slotAssignments[match.slotIndex] = variant.variantId;
    });
    syncSelectedFromSlots();
    renderDetectedTeam(matches);
    render();
  } catch (error) {
    renderDetectedTeam([], "이미지 감지에 실패했습니다.");
  } finally {
    detectButton.disabled = false;
  }
});

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

render();
