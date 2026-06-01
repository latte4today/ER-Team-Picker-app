const STORAGE_KEY = "er-team-picker-feedback-v1";

function normalizeTeam(selectedIds) {
  return selectedIds
    .map((id) => id.split(":")[0])
    .sort()
    .join("+");
}

export function feedbackKey(selectedIds, candidateId, tier = "all") {
  const team = normalizeTeam(selectedIds);
  return `${tier}:${team}->${candidateId.split(":")[0]}`;
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

export function recordFeedback(selectedIds, candidateId, value, tier = "all") {
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

function scoreFromEntry(entry) {
  if (!entry) return 0;

  const total = entry.likes + entry.dislikes;
  if (total === 0) return 0;

  const sentiment = (entry.likes - entry.dislikes) / total;
  const confidence = Math.min(1, total / 5);
  return sentiment * confidence * 1.5;
}

export function getFeedbackScore(selectedIds, candidateId, tier = "all", feedback = loadFeedback()) {
  const tierScore = scoreFromEntry(feedback[feedbackKey(selectedIds, candidateId, tier)]);
  if (tier === "all") return tierScore;

  const globalScore = scoreFromEntry(feedback[feedbackKey(selectedIds, candidateId, "all")]);
  return tierScore * 0.75 + globalScore * 0.25;
}

export function getFeedbackEntry(selectedIds, candidateId, tier = "all", feedback = loadFeedback()) {
  return feedback[feedbackKey(selectedIds, candidateId, tier)] ?? { likes: 0, dislikes: 0 };
}
