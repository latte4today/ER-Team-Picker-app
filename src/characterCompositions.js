// Observed teams, not predicted matchups: keep weapons distinct and do not sum
// the three candidate perspectives of the same composition into inflated games.
export function observedCharacterCompositions(rows, variantId, limit = 8) {
  const byTeam = new Map();
  for (const row of rows) {
    const members = [...(row.teammates ?? []), row.candidate].filter(Boolean);
    if (members.length !== 3 || !members.includes(variantId) || new Set(members).size !== 3) continue;
    if (!Number.isFinite(row.games) || row.games < 30) continue;
    const key = [...members].sort().join('+');
    if (!byTeam.has(key) || row.games > byTeam.get(key).games) byTeam.set(key, row);
  }
  return [...byTeam.values()].sort((a,b) => b.games-a.games).slice(0,limit);
}
