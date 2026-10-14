// The supplied table has already passed the collector's significance filter.
// Its keys are character pairs, not weapon pairs or opponent matchups.
export function characterSynergies(characterId, pairs, knownIds, { minSamples = 60, limit = 6 } = {}) {
  const positive = [], negative = [];
  for (const [key, row] of Object.entries(pairs)) {
    const members = key.split('|');
    if (members.length !== 2 || new Set(members).size !== 2 || !members.includes(characterId)) continue;
    const partnerId = members.find(id => id !== characterId);
    if (!knownIds.has(partnerId) || !Number.isFinite(row.lift) || row.lift === 0 ||
        !Number.isFinite(row.n) || row.n < minSamples) continue;
    (row.lift > 0 ? positive : negative).push({ characterId: partnerId, lift: row.lift, games: row.n });
  }
  const strongest = rows => rows.sort((a,b) => Math.abs(b.lift)-Math.abs(a.lift) || b.games-a.games ||
    a.characterId.localeCompare(b.characterId)).slice(0,limit);
  return { positive: strongest(positive), negative: strongest(negative) };
}
