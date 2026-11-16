import { setTimeout as delay } from "node:timers/promises";
import { addSquadResult, recentSquadGames, summarizePlayerMatches } from "../src/playerHistory.js";
import { officialGameRows, officialUserId } from "../src/officialApiResponse.js";

const OFFICIAL_API = "https://open-api.bser.io";
const DESKTOP_ORIGIN = "http://127.0.0.1:34579";
const TEAM_SAMPLE_LIMIT = 8;
const requestWindows = new Map();
let activeLookups = 0;
let upstreamRetryAt = 0;

function rateLimited(request, now) {
  for (const [ip, window] of requestWindows) {
    if (window.until <= now) requestWindows.delete(ip);
  }
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (now < upstreamRetryAt || activeLookups >= 3) return true;
  if (!ip) return false;
  const window = requestWindows.get(ip) ?? { count: 0, until: now + 60_000 };
  if (window.count >= 8 || (!requestWindows.has(ip) && requestWindows.size >= 512)) return true;
  window.count += 1;
  requestWindows.set(ip, window);
  return false;
}

class UpstreamError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function officialJson(path, apiKey, signal) {
  const response = await fetch(OFFICIAL_API + path, {
    headers: { "x-api-key": apiKey },
    redirect: "error",
    signal,
  });
  const json = await response.json().catch(() => null);
  const code = Number(json?.code ?? response.status);
  if (code === 429 || response.status === 429 ||
      ((code === 403 || response.status === 403) && /rate.limit|too many/i.test(json?.message ?? ""))) {
    const retrySeconds = Number(response.headers.get("retry-after")) || 10;
    upstreamRetryAt = Date.now() + Math.min(60, Math.max(1, retrySeconds)) * 1000;
    throw new UpstreamError("busy");
  }
  if (code === 404 || response.status === 404) throw new UpstreamError("notFound");
  if (code === 403 || response.status === 403 || response.status === 401) throw new UpstreamError("unconfigured");
  if (!response.ok || code !== 200 || !json) throw new UpstreamError("unavailable");
  return json;
}

async function fetchSquadSummary(matches, seasonId, apiKey, signal) {
  const sample = recentSquadGames(matches, seasonId, TEAM_SAMPLE_LIMIT);
  const records = new Map();
  let inspected = 0;
  for (const match of sample) {
    try {
      await delay(450, undefined, { signal });
      const detail = await officialJson(`/v1/games/${match.gameId}`, apiKey, signal);
      const rows = officialGameRows(detail);
      if (rows && addSquadResult(records, match, rows)) inspected += 1;
    } catch (error) {
      if (signal.aborted || error.code === "busy" || error.code === "unconfigured") break;
    }
  }
  return { seasonId, inspected, requested: sample.length, entries: [...records.values()] };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("origin");
    const headers = { "Cache-Control": "private, no-store", Vary: "Origin" };
    if (origin === DESKTOP_ORIGIN) headers["Access-Control-Allow-Origin"] = origin;
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    if (origin && origin !== DESKTOP_ORIGIN && origin !== new URL(request.url).origin) {
      return reply({ error: "forbidden" }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        ...headers, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type",
      } });
    }
    const apiKey = process.env.ER_API_KEY?.trim();
    if (request.method === "GET") return reply({ enabled: Boolean(apiKey) });
    if (request.method !== "POST") return reply({ error: "method" }, 405);
    if (Number(request.headers.get("content-length")) > 512) return reply({ error: "invalid" }, 400);
    let nickname;
    let seasonId;
    try {
      const body = await request.text();
      const input = body.length <= 512 ? JSON.parse(body) : null;
      nickname = input?.nickname;
      seasonId = input?.comparisonSeason;
    } catch {
      return reply({ error: "invalid" }, 400);
    }
    nickname = typeof nickname === "string" ? nickname.trim() : "";
    if (!nickname || nickname.length > 32 || /[\u0000-\u001f\u007f]/u.test(nickname)) return reply({ error: "invalid" }, 400);

    if (!apiKey) return reply({ error: "unconfigured" }, 503);
    if (rateLimited(request, Date.now())) return reply({ error: "busy" }, 429);
    activeLookups += 1;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(7500)]);
      const account = await officialJson(`/v1/user/nickname?query=${encodeURIComponent(nickname)}`, apiKey, signal);
      const uid = officialUserId(account);
      if (!uid) return reply({ error: "unavailable" }, 502);
      try {
        const history = await officialJson(`/v1/user/games/uid/${encodeURIComponent(uid)}`, apiKey, signal);
        const matches = officialGameRows(history);
        if (!matches) return reply({ error: "unavailable" }, 502);
        const profile = summarizePlayerMatches(matches);
        if (Number.isSafeInteger(seasonId) && seasonId > 0 && seasonId < 10_000) {
          profile.squads = await fetchSquadSummary(matches, seasonId, apiKey, signal);
        }
        return reply(profile);
      } catch (error) {
        if (error.code === "notFound") return reply(summarizePlayerMatches([]));
        throw error;
      }
    } catch (error) {
      const status = { notFound: 404, busy: 429, unconfigured: 503 }[error.code];
      return status ? reply({ error: error.code }, status) : reply({ error: "unavailable" }, 502);
    } finally {
      activeLookups -= 1;
    }
  },
};
