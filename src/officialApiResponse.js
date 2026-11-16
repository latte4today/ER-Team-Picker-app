export function officialUserId(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  for (const key of ["userId", "user_id", "uid"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Number.isSafeInteger(value) && value > 0) return String(value);
  }
  for (const child of Object.values(payload)) {
    const found = officialUserId(child);
    if (found) return found;
  }
  return undefined;
}

export function officialGameRows(payload) {
  for (const envelope of [payload, payload?.data]) {
    for (const rows of [envelope?.userGames, envelope?.games, envelope?.gameDetails, envelope]) {
      if (Array.isArray(rows)) return rows;
    }
  }
  return undefined;
}
