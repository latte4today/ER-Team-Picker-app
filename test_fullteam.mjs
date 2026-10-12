import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { documentElement: { lang: 'ko', dataset: {} } };
const { evaluateCandidate, recommend } = await import('./src/recommender.js');
// Full-team/union scoring uses three reciprocal candidate evaluations now.
// recommendFullTeam and the old invalid celine:assault_rifle seed were retired.
for (const team of [
  ['celine:throw', 'lenox:whip', 'rio:bow'],
  ['seres:two_handed_sword', 'lucia:sniper_rifle', 'rio:bow'],
]) {
  const rows = team.map((candidate, i) => evaluateCandidate(team.filter((_, j) => j !== i), candidate));
  assert.ok(rows.every((r) => r && Number.isFinite(r.total) && Number.isFinite(r.score)));
  for (let i = 0; i < team.length; i += 1) {
    const others = team.filter((_, j) => j !== i);
    assert.equal(evaluateCandidate(others, team[i]).total, evaluateCandidate([...others].reverse(), team[i]).total);
  }
  const picks = team.slice(0, 2);
  const recommendations = recommend(picks);
  const pickedCharacters = new Set(picks.map((id) => id.split(':')[0]));
  assert.ok(recommendations.every((r) => !pickedCharacters.has(r.character.characterId)));
}
console.log('full-team regression passed: reciprocal finite scores, order invariance and duplicate exclusion');
