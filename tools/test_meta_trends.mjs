import assert from 'node:assert/strict';
import {createTrendAccumulator} from './lib/meta_trends.mjs';
const options={asOf:'2026-10-15T12:00:00Z'};
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
console.log('Meta trends: real growth, complete KST windows, dedup, valid trios, volume normalization, fixed tier mix and insufficient coverage passed.');
