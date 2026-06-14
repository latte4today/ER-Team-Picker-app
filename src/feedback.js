const STORAGE_KEY = "er-team-picker-feedback-v1";
const RECENT_VOTE_KEY = "er-team-picker-feedback-windows-v1";
const PENDING_REMOTE_KEY = "er-team-picker-pending-remote-feedback-v1";
const RECOVERY_MARKER_KEY = "er-team-picker-feedback-recovery-v1";
const VOTE_WINDOW_HOURS = 1;
const INVALID_FEEDBACK_IDS = new Set(["", "empty", "null", "undefined", "none"]);

function normalizeFeedbackId(id) {
  const normalized = String(id ?? "").trim().split(":")[0].trim();
  return INVALID_FEEDBACK_IDS.has(normalized.toLowerCase()) ? "" : normalized;
}

function normalizeTeamIds(selectedIds) {
  return selectedIds
    .map(normalizeFeedbackId)
    .filter(Boolean)
    .sort();
}

function normalizeTeam(selectedIds) {
  return normalizeTeamIds(selectedIds).join("+");
}

function hasValidFeedbackTarget(selectedIds, candidateId) {
  return normalizeTeamIds(selectedIds).length === 2 && Boolean(normalizeFeedbackId(candidateId));
}

export function feedbackKey(selectedIds, candidateId, tier = "all") {
  const team = normalizeTeam(selectedIds);
  return `${tier}:${team}->${normalizeFeedbackId(candidateId)}`;
}

export function voteBucket(date = new Date()) {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  bucket.setUTCHours(Math.floor(bucket.getUTCHours() / VOTE_WINDOW_HOURS) * VOTE_WINDOW_HOURS);
  return bucket.toISOString().slice(0, 13);
}

export function feedbackWindowKey(selectedIds, candidateId, tier = "all", date = new Date()) {
  return `${feedbackKey(selectedIds, candidateId, tier)}@${voteBucket(date)}`;
}

export function loadFeedback() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveFeedback(feedback) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
}

function safeParseStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadRecentVotes() {
  return safeParseStorage(RECENT_VOTE_KEY, {});
}

function saveRecentVotes(recentVotes) {
  localStorage.setItem(RECENT_VOTE_KEY, JSON.stringify(recentVotes));
}

export function hasRecentFeedback(selectedIds, candidateId, tier = "all") {
  if (!hasValidFeedbackTarget(selectedIds, candidateId)) return false;
  return Boolean(loadRecentVotes()[feedbackWindowKey(selectedIds, candidateId, tier)]);
}

export function markRecentFeedback(selectedIds, candidateId, tier = "all") {
  if (!hasValidFeedbackTarget(selectedIds, candidateId)) return;
  const recentVotes = loadRecentVotes();
  const currentKey = feedbackWindowKey(selectedIds, candidateId, tier);
  const currentBucket = voteBucket();

  Object.keys(recentVotes).forEach((key) => {
    if (!key.endsWith(`@${currentBucket}`)) delete recentVotes[key];
  });

  recentVotes[currentKey] = Date.now();
  saveRecentVotes(recentVotes);
}

export function recordFeedback(selectedIds, candidateId, value, tier = "all") {
  if (!hasValidFeedbackTarget(selectedIds, candidateId)) return undefined;
  const feedback = loadFeedback();
  const key = feedbackKey(selectedIds, candidateId, tier);
  const current = feedback[key] ?? { likes: 0, dislikes: 0 };

  if (value > 0) current.likes += 1;
  if (value < 0) current.dislikes += 1;

  feedback[key] = {
    likes: current.likes,
    dislikes: current.dislikes,
    updatedAt: Date.now(),
  };
  saveFeedback(feedback);
  return feedback[key];
}

export function loadPendingRemoteFeedback() {
  return safeParseStorage(PENDING_REMOTE_KEY, []);
}

function savePendingRemoteFeedback(items) {
  localStorage.setItem(PENDING_REMOTE_KEY, JSON.stringify(items));
}

function pendingFeedbackId(selectedIds, candidateId, value, tier = "all") {
  return `${feedbackWindowKey(selectedIds, candidateId, tier)}:${value > 0 ? "like" : "dislike"}`;
}

export function queueRemoteFeedback(selectedIds, candidateId, value, tier = "all", reason = "server-failed") {
  if (!hasValidFeedbackTarget(selectedIds, candidateId)) return undefined;
  const pending = loadPendingRemoteFeedback();
  const id = pendingFeedbackId(selectedIds, candidateId, value, tier);
  const existing = pending.find((item) => item.id === id);
  if (existing) {
    existing.reason = reason;
    existing.updatedAt = Date.now();
    savePendingRemoteFeedback(pending);
    return existing;
  }

  const item = {
    id,
    selectedIds: normalizeTeamIds(selectedIds),
    candidateId: normalizeFeedbackId(candidateId),
    value: value > 0 ? 1 : -1,
    tier,
    reason,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  pending.push(item);
  savePendingRemoteFeedback(pending);
  return item;
}

export function removePendingRemoteFeedback(id) {
  savePendingRemoteFeedback(loadPendingRemoteFeedback().filter((item) => item.id !== id));
}

export function updatePendingRemoteFeedback(id, patch) {
  const pending = loadPendingRemoteFeedback();
  const item = pending.find((entry) => entry.id === id);
  if (!item) return undefined;
  Object.assign(item, patch, { updatedAt: Date.now() });
  savePendingRemoteFeedback(pending);
  return item;
}

function parseFeedbackKey(key) {
  const match = key.match(/^([^:]+):(.+)->(.+)$/);
  if (!match) return undefined;
  return {
    tier: match[1],
    selectedIds: match[2] ? match[2].split("+").filter(Boolean) : [],
    candidateId: match[3],
  };
}

export function recoverLocalFeedbackToPendingQueue() {
  if (localStorage.getItem(RECOVERY_MARKER_KEY)) return 0;

  const feedback = loadFeedback();
  let recovered = 0;
  Object.entries(feedback).forEach(([key, entry]) => {
    const parsed = parseFeedbackKey(key);
    if (!parsed || parsed.selectedIds.length === 0) return;
    const likes = entry.likes ?? 0;
    const dislikes = entry.dislikes ?? 0;
    if (likes === dislikes) return;

    const queued = queueRemoteFeedback(
      parsed.selectedIds,
      parsed.candidateId,
      likes > dislikes ? 1 : -1,
      parsed.tier,
      "recovered-local-feedback",
    );
    if (queued) recovered += 1;
  });

  localStorage.setItem(RECOVERY_MARKER_KEY, String(Date.now()));
  return recovered;
}

function scoreFromEntry(entry) {
  if (!entry) return 0;

  const total = entry.likes + entry.dislikes;
  if (total === 0) return 0;

  const sentiment = (entry.likes - entry.dislikes) / total;
  const confidence = Math.min(1, total / 5);
  return sentiment * confidence * 1.5;
}

function parseFeedbackKeyParts(key) {
  const match = key.match(/^([^:]+):(.+)->(.+)$/);
  if (!match) return undefined;
  return {
    tier: match[1],
    teamKey: match[2],
    candidateId: match[3],
  };
}

function candidateGlobalFeedbackScore(candidateId, tier = "all", feedback = loadFeedback()) {
  const targetCandidateId = normalizeFeedbackId(candidateId);
  if (!targetCandidateId) return 0;

  const totals = Object.entries(feedback).reduce((state, [key, entry]) => {
    const parsed = parseFeedbackKeyParts(key);
    if (!parsed || parsed.candidateId !== targetCandidateId) return state;
    if (parsed.teamKey.split("+").filter(Boolean).length !== 2) return state;
    if (tier !== "all" && parsed.tier !== tier && parsed.tier !== "all") return state;

    const tierWeight = parsed.tier === tier ? 1 : 0.65;
    state.likes += (entry.likes ?? 0) * tierWeight;
    state.dislikes += (entry.dislikes ?? 0) * tierWeight;
    return state;
  }, { likes: 0, dislikes: 0 });

  return scoreFromEntry(totals) * 0.35;
}

export function getFeedbackScore(selectedIds, candidateId, tier = "all", feedback = loadFeedback()) {
  const candidateScore = candidateGlobalFeedbackScore(candidateId, tier, feedback);
  if (!hasValidFeedbackTarget(selectedIds, candidateId)) return candidateScore;

  const tierScore = scoreFromEntry(feedback[feedbackKey(selectedIds, candidateId, tier)]);
  if (tier === "all") return tierScore + candidateScore;

  const globalScore = scoreFromEntry(feedback[feedbackKey(selectedIds, candidateId, "all")]);
  return tierScore * 0.75 + globalScore * 0.25 + candidateScore;
}

export function getFeedbackEntry(selectedIds, candidateId, tier = "all", feedback = loadFeedback()) {
  if (!hasValidFeedbackTarget(selectedIds, candidateId)) return { likes: 0, dislikes: 0 };
  return feedback[feedbackKey(selectedIds, candidateId, tier)] ?? { likes: 0, dislikes: 0 };
}
