// Official kill/death character aggregates. These are not team fight outcomes.
export function encounterStats(row) {
  const result = {};
  for (const field of ["killDetails", "deathDetails"]) {
    const value = row?.[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    result[field] = Object.fromEntries(Object.entries(value).filter(([code, count]) =>
      /^[1-9]\d*$/.test(code) && Number.isSafeInteger(count) && count >= 0));
  }
  return result;
}
