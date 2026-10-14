import assert from 'node:assert/strict';
import { characterSynergies } from '../src/characterSynergies.js';
import { characterVariants } from '../src/data.js';
import { officialPairSynergyLift, pairSynergyLiftMeta } from '../src/pairSynergyLift.js';
const known = new Set(['aya','rio','leni','jenny','daniel']);
const pairs = {
  'aya|rio': { lift:0.2,n:100 },
  'aya|jenny': { lift:0.5,n:60 },
  'aya|leni': { lift:-0.7,n:200 },
  'aya|daniel': { lift:0.8,n:59 },
  'aya|unknown': { lift:0.9,n:500 },
  'aya|aya': { lift:1,n:500 },
  'aya|rio|leni': { lift:1,n:500 },
  'rio|leni': { lift:0.9,n:500 },
};
const result = characterSynergies('aya',pairs,known);
assert.deepEqual(result.positive.map(r=>r.characterId),['jenny','rio']);
assert.deepEqual(result.negative.map(r=>r.characterId),['leni']);
assert.equal(characterSynergies('aya',pairs,known,{limit:1}).positive.length,1);
assert.deepEqual(characterSynergies('new',pairs,known),{positive:[],negative:[]});
for (const invalid of [NaN,Infinity,0,undefined]) {
  assert.deepEqual(characterSynergies('aya',{'aya|rio':{lift:invalid,n:100}},known),{positive:[],negative:[]});
}
const roster = new Set(characterVariants.map(c=>c.characterId));
const actual = characterSynergies('aya',officialPairSynergyLift,roster,{minSamples:pairSynergyLiftMeta.minSamples});
assert.ok(actual.positive.some(r=>r.characterId==='daniel'));
assert.ok(actual.negative.some(r=>r.characterId==='leni'));
for (const row of [...actual.positive,...actual.negative]) {
  const reverse = characterSynergies(row.characterId,officialPairSynergyLift,roster,{limit:100});
  assert.equal([...reverse.positive,...reverse.negative].find(r=>r.characterId==='aya').lift,row.lift);
}
console.log('Character synergy regression: real Aya relationships, sign/symmetry, sample threshold, unknown/self/malformed pairs, sorting, limit and empty state passed.');
