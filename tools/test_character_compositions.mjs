import assert from 'node:assert/strict';
import { observedCharacterCompositions } from '../src/characterCompositions.js';
const rows=[
  {candidate:'rio:bow',teammates:['seres:two_handed_sword','lucia:sniper_rifle'],games:100},
  {candidate:'lucia:sniper_rifle',teammates:['rio:bow','seres:two_handed_sword'],games:90},
  {candidate:'rio:bow',teammates:['luke:bat','sho:spear'],games:80},
  {candidate:'rio:bow',teammates:['lenox:whip','nicky:glove'],games:29},
  {candidate:'rio:bow',teammates:['rio:bow','sho:spear'],games:200},
  {candidate:'nadine:crossbow',teammates:['luke:bat','sho:spear'],games:1000},
];
const result=observedCharacterCompositions(rows,'rio:bow');
assert.deepEqual(result.map(row=>row.games),[100,80]);
assert.equal(observedCharacterCompositions(rows,'rio:bow',1).length,1);
assert.deepEqual(observedCharacterCompositions(rows,'nadine:bow'),[],'weapon variants remain separate');
const many = Array.from({length:12},(_,i)=>({candidate:'rio:bow',teammates:[`mate${i}:sword`,'sho:spear'],games:100+i}));
assert.equal(observedCharacterCompositions(many,'rio:bow').length,8,'default list now includes more than three teams');
assert.deepEqual(observedCharacterCompositions(many,'rio:bow').map(r=>r.games),[111,110,109,108,107,106,105,104]);
console.log('Observed character teams: exact weapon, complete unique trio, minimum sample, duplicate perspectives and bounded list passed.');
