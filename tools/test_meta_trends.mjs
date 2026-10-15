import assert from 'node:assert/strict';
import {createTrendAccumulator,qualifyTrioTrends,hasMeaningfulTrendEffect} from './lib/meta_trends.mjs';
import {hasFullRankedBaseline} from '../src/characterAvailability.js';
const options={asOf:'2026-10-15T12:00:00Z',availability:{}};
let serial=0;
function populate(tracker,tier,period,total,rate) {
  for(let day=0;day<7;day++)for(let i=0;i<total;i++)tracker.add({gameId:++serial,teamKey:1,
    startedAt:`2026-10-${String((period?8:1)+day).padStart(2,'0')}T12:00:00Z`,tierBucket:tier,placement:2,
    members:i<total*rate?['aya:pistol','rio:bow','seres:two_handed_sword']:['luke:bat','sho:spear','lenox:whip']});
}
const rising=createTrendAccumulator(options);
populate(rising,'iron_gold',0,200,.05);populate(rising,'iron_gold',1,200,.25);
const actual=rising.finish();
assert.equal(actual.end,'2026-10-14T15:00:00.000Z','complete KST calendar days only');
assert.ok(actual.byTier.all.rows.some(r=>r.members.length===2&&r.members.includes('aya:pistol')&&r.ratio>4));
assert.ok(actual.byTier.all.rows.some(r=>r.members.length===3));
const both=createTrendAccumulator(options);
populate(both,'iron_gold',0,200,.5);populate(both,'iron_gold',1,200,.1);
const movements=both.finish().byTier.all.rows;
assert.ok(movements.some(r=>r.direction==='down'&&r.members.includes('aya:pistol')&&r.delta<0));
assert.ok(movements.some(r=>r.direction==='up'&&r.members.includes('luke:bat')&&r.delta>0));
assert.ok(movements.every(r=>r.previousGames>=20&&r.games>=20),'both signs require adequate old and new samples');
const duplicate={gameId:999999,teamKey:1,startedAt:'2026-10-14T12:00:00Z',tierBucket:'iron_gold',placement:1,members:['a:x','b:y','c:z']};
assert.ok(rising.add(duplicate));assert.ok(!rising.add(duplicate));
assert.ok(!rising.add({...duplicate,gameId:1000000,startedAt:'2026-10-14T16:00:00Z'}),'exclude incomplete current KST day');
assert.ok(!rising.add({...duplicate,gameId:1000001,members:['a:x','a:y','c:z']}));
const volume=createTrendAccumulator(options);
populate(volume,'iron_gold',0,200,.1);populate(volume,'iron_gold',1,400,.1);
assert.equal(volume.finish().byTier.all.rows.length,0,'more collection alone is not a trend');
const mix=createTrendAccumulator(options);
populate(mix,'iron_gold',0,100,.1);populate(mix,'iron_gold',1,900,.1);
populate(mix,'platinum_diamond',0,900,.9);populate(mix,'platinum_diamond',1,100,.9);
assert.equal(mix.finish().byTier.all.rows.length,0,'a changing tier mix cannot create a rise');
const sparse=createTrendAccumulator(options);sparse.add(duplicate);
assert.equal(sparse.finish().byTier.all.rows.length,0,'insufficient coverage has no verdict');
const launch=createTrendAccumulator({asOf:options.asOf});
populate(launch,'iron_gold',0,200,.05);populate(launch,'iron_gold',1,200,.25);
assert.ok(launch.finish().byTier.all.rows.every(r=>r.members.every(id=>!id.startsWith('seres:'))),'known launch eligibility blocks the character and every containing pair/trio');
assert.equal(launch.finish().excludedCharacters[0].characterId,'seres');
assert.ok(!hasFullRankedBaseline('seres','2026-10-06T00:00:00+09:00'));
assert.ok(hasFullRankedBaseline('seres','2026-10-07T00:00:00+09:00'),'eligible again when both complete comparison windows are after ranked availability');
const tinyBaseline=createTrendAccumulator(options);
populate(tinyBaseline,'iron_gold',0,200,.005);populate(tinyBaseline,'iron_gold',1,200,.25);
assert.ok(tinyBaseline.finish().byTier.all.rows.every(r=>!r.members.includes('aya:pistol')),'tiny old sample cannot manufacture a huge growth ratio');
const lateRegistration=createTrendAccumulator(options);
for(let period=0;period<2;period++)for(let day=0;day<7;day++)for(let i=0;i<200;i++)lateRegistration.add({
  gameId:++serial,teamKey:1,startedAt:`2026-10-${String((period?8:1)+day).padStart(2,'0')}T12:00:00Z`,
  tierBucket:'iron_gold',placement:2,members:(period||day>=2)&&i<100?['future:a','rio:bow','mai:whip']:['luke:bat','sho:spear','lenox:whip'],
});
assert.ok(lateRegistration.finish().byTier.all.rows.every(r=>r.members.every(id=>!id.startsWith('future:'))),'unknown future releases need all seven observed days in both windows');
console.log('Meta trends: real growth, complete KST windows, dedup, valid trios, volume normalization, fixed tier mix and insufficient coverage passed.');
const trio={members:['a:x','b:y','c:z'],size:3,games:60,previousGames:30,ratio:2,delta:.00008,z:3,p:.0027};
const rare=Array.from({length:120000},()=>({...trio,games:1,previousGames:1,p:1,z:0}));
assert.deepEqual(qualifyTrioTrends([trio,...rare]),[trio],'unsupported rare combinations cannot swamp the trio correction family');
assert.deepEqual(qualifyTrioTrends([{...trio,delta:-.00008,z:-3,ratio:.5}]).map(r=>r.z),[-3],'same evidence rule in both directions');
assert.equal(qualifyTrioTrends([{...trio,games:19,previousGames:100}]).length,0,'retain both-period sample protection');
assert.equal(qualifyTrioTrends([{...trio,delta:.00001}]).length,0,'trio-specific effect floor still rejects negligible changes');
const modest=createTrendAccumulator(options);
populate(modest,'iron_gold',0,1000,.5);populate(modest,'iron_gold',1,1000,.4);
const picks=modest.finish().byTier.all.rows.filter(r=>r.members.length===1);
assert.ok(picks.some(r=>r.direction==='down'&&r.members.includes('aya:pistol')),'well-supported 20% pick decline remains visible');
assert.ok(picks.some(r=>r.direction==='up'&&r.members.includes('luke:bat')),'same pick policy allows comparable rises');
const pick={size:1,games:1000,previousGames:1200,ratio:1/1.2,delta:-.003,z:-4};
assert.ok(hasMeaningfulTrendEffect(pick));
assert.ok(hasMeaningfulTrendEffect({...pick,ratio:1.2,delta:.003,z:4}));
assert.ok(!hasMeaningfulTrendEffect({...pick,previousGames:59}));
assert.ok(!hasMeaningfulTrendEffect({...pick,delta:-.001}),'reject negligible absolute changes');
assert.ok(!hasMeaningfulTrendEffect({...pick,z:-2}),'retain statistical evidence threshold');
assert.ok(!hasMeaningfulTrendEffect({...pick,size:2}),'duo effect rules stay unchanged');
