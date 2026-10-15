import assert from 'node:assert/strict';
import {metaMovementRows,movementBar} from '../src/metaMovement.js';
const rows=[{members:['a','b'],delta:.1},{members:['c','d'],delta:-.2},
  {members:['a','c'],delta:.3},{members:['d','e'],delta:-.4},
  {members:['a'],delta:.5},{members:['f','g'],delta:NaN}];
const selected=metaMovementRows(rows,2,1);
assert.deepEqual(selected.map(r=>r.delta),[.3,-.4],'each direction has room on the same chart');
assert.deepEqual(movementBar(.1,.2),{left:50,width:25});
assert.deepEqual(movementBar(-.1,.2),{left:25,width:25},'equal magnitude is equal length across the same zero');
assert.deepEqual(movementBar(-.2,.2),{left:0,width:50});
assert.deepEqual(movementBar(.2,.2),{left:50,width:50});
assert.deepEqual(movementBar(0,0),{left:50,width:0});
assert.deepEqual(metaMovementRows([],2),[]);
console.log('Meta movement chart: symmetric selection, shared zero/scale, correct signs, category filtering and empty states passed.');
