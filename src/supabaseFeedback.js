import { supabaseConfig } from "./supabaseConfig.js";

function normalizeTeam(selectedIds) {
  return selectedIds
    .map((id) => id.split(":")[0])
    .sort()
    .join("+");
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
  const client = await getClient();
  if (!client) return undefined;

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;

  const payload = {
    user_id: userData.user.id,
    tier,
    team_key: normalizeTeam(selectedIds),
    candidate_id: candidateId.split(":")[0],
    value,
    vote_day: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  };

  const { error } = await client
    .from("recommendation_votes")
    .upsert(payload, {
      onConflict: "user_id,tier,team_key,candidate_id,vote_day",
    });

  if (error) throw error;
  return true;
}

export async function loadRemoteFeedback(selectedIds, tier) {
  const client = await getClient();
  if (!client) return {};

  const teamKey = normalizeTeam(selectedIds);
  const tiers = tier === "all" ? ["all"] : [tier, "all"];
  const { data, error } = await client
    .from("recommendation_feedback_summary")
    .select("tier,candidate_id,likes,dislikes")
    .eq("team_key", teamKey)
    .in("tier", tiers);

  if (error) throw error;

  return Object.fromEntries(
    data.map((row) => [
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
  return data;
}
