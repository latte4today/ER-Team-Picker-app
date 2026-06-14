import { supabaseConfig } from "./supabaseConfig.js";

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

function isValidFeedbackRow(row) {
  const teamIds = String(row?.team_key ?? "").split("+").map(normalizeFeedbackId).filter(Boolean);
  return teamIds.length === 2 && Boolean(normalizeFeedbackId(row?.candidate_id));
}

function voteBucket(date = new Date()) {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  bucket.setUTCHours(Math.floor(bucket.getUTCHours() / VOTE_WINDOW_HOURS) * VOTE_WINDOW_HOURS);
  return bucket.toISOString().slice(0, 13);
}

function isMissingVoteBucketError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return text.includes("vote_bucket") || error?.code === "PGRST204";
}

function isConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

let clientPromise;

async function getClient() {
  if (!isConfigured()) return undefined;
  if (!clientPromise) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const client = createClient(supabaseConfig.url, supabaseConfig.anonKey);
    clientPromise = client.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        const { error } = await client.auth.signInAnonymously();
        if (error) throw error;
      }
      return client;
    });
  }
  return clientPromise;
}

export async function recordRemoteFeedback(selectedIds, candidateId, value, tier) {
  const teamIds = normalizeTeamIds(selectedIds);
  const teamKey = normalizeTeam(selectedIds);
  const normalizedCandidateId = normalizeFeedbackId(candidateId);
  if (teamIds.length !== 2 || !teamKey || !normalizedCandidateId) return false;

  const client = await getClient();
  if (!client) return undefined;

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;

  const basePayload = {
    user_id: userData.user.id,
    tier,
    team_key: teamKey,
    candidate_id: normalizedCandidateId,
    value,
    vote_day: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  };

  const payload = {
    ...basePayload,
    vote_bucket: voteBucket(),
  };

  // Detect whether this attempt collapses into an existing bucket row (a "duplicate"),
  // before the upsert turns it into an UPDATE. Best-effort only — never blocks voting.
  let wasDuplicate = false;
  try {
    const { count } = await client
      .from("recommendation_votes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userData.user.id)
      .eq("tier", tier)
      .eq("team_key", teamKey)
      .eq("candidate_id", normalizedCandidateId)
      .eq("vote_bucket", payload.vote_bucket);
    wasDuplicate = (count ?? 0) > 0;
  } catch {
    // ignore: duplicate flag is diagnostic only
  }

  const { error } = await client
    .from("recommendation_votes")
    .upsert(payload, {
      onConflict: "user_id,tier,team_key,candidate_id,vote_bucket",
    });

  if (error && isMissingVoteBucketError(error)) {
    const { error: fallbackError } = await client
      .from("recommendation_votes")
      .upsert(basePayload, {
        onConflict: "user_id,tier,team_key,candidate_id,vote_day",
      });
    if (fallbackError) throw fallbackError;
    return true;
  }

  if (error) throw error;

  // Fire-and-forget: record every attempt in the append-only diagnostic log.
  logVoteEvent(client, {
    user_id: userData.user.id,
    tier,
    team_key: teamKey,
    candidate_id: normalizedCandidateId,
    value,
    vote_bucket: payload.vote_bucket,
    was_duplicate: wasDuplicate,
  });

  return true;
}

async function logVoteEvent(client, eventPayload) {
  try {
    await client.from("recommendation_vote_events").insert(eventPayload);
  } catch {
    // diagnostic log only; a failure here must never affect the vote flow
  }
}

export async function loadRemoteFeedback(selectedIds, tier) {
  const client = await getClient();
  if (!client) return {};

  if (normalizeTeamIds(selectedIds).length !== 2) return {};
  const teamKey = normalizeTeam(selectedIds);
  if (!teamKey) return {};
  const tiers = tier === "all" ? ["all"] : [tier, "all"];
  const { data, error } = await client
    .from("recommendation_feedback_summary")
    .select("tier,candidate_id,likes,dislikes")
    .eq("team_key", teamKey)
    .in("tier", tiers);

  if (error) throw error;

  return Object.fromEntries(
    data.filter(isValidFeedbackRow).map((row) => [
      `${row.tier}:${teamKey}->${row.candidate_id}`,
      { likes: row.likes, dislikes: row.dislikes },
    ]),
  );
}

export async function loadPopularFeedback(limit = 500) {
  const client = await getClient();
  if (!client) return [];

  const { data, error } = await client
    .from("recommendation_feedback_summary")
    .select("tier,team_key,candidate_id,likes,dislikes,total,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data.filter(isValidFeedbackRow);
}

export async function submitContactMessage({ replyTo = "", message = "", appVersion = "" }) {
  const client = await getClient();
  if (!client) throw new Error("Supabase connection required.");

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;

  const payload = {
    user_id: userData.user.id,
    reply_to: replyTo.trim() || null,
    message: message.trim(),
    app_version: appVersion || null,
    user_agent: navigator.userAgent,
  };

  const { error } = await client.from("contact_messages").insert(payload);
  if (error) throw error;

  client.functions.invoke("contact-notify", { body: payload }).catch(() => {});
  return true;
}
