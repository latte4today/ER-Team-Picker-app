export function metaMovementRows(rows, size, limitPerDirection=6) {
  const valid=rows.filter(r=>r.members?.length===size&&Number.isFinite(r.delta)&&r.delta!==0);
  const groups=[1,-1].map(sign=>valid.filter(r=>Math.sign(r.delta)===sign)
    .sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,limitPerDirection));
  // Alternate the strongest rises/falls so both remain visible without scrolling past one direction.
  return Array.from({length:Math.max(...groups.map(g=>g.length))},(_,i)=>groups.map(g=>g[i]).filter(Boolean)).flat();
}

// Both directions use the same %p scale and zero midpoint.
export function movementBar(delta, maxAbsoluteDelta) {
  const width=Number.isFinite(delta)&&maxAbsoluteDelta>0?Math.min(50,Math.abs(delta)/maxAbsoluteDelta*50):0;
  return {width,left:delta<0?50-width:50};
}
