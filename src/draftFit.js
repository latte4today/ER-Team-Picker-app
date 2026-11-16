// Reviewed role/ability profiles only. The gain measures how much of a team's
// missing coverage a pick can supply; it is not a win-probability estimate.
const AXES = [
  {id:'frontline', target:0.90, weight:1.35},
  {id:'damage', target:1.85, weight:1.55},
  {id:'engage', target:0.88, weight:0.85},
  {id:'peel', target:0.75, weight:0.75},
  {id:'range', target:0.95, weight:0.65},
];

function capabilities(character, vector) {
  const frontFactor=({frontline:1,bruiser:.88,assassin:.23})[character.role]??.12;
  return {
    frontline:(vector.frontline*.63+vector.durability*.37)*frontFactor,
    damage:vector.damage,
    engage:vector.engage*.78+vector.cc*.22,
    peel:vector.peel*.72+vector.support*.28,
    range:vector.range*.66+vector.poke*.34,
  };
}

export function draftCoverage(team, vectors) {
  const profiles=team.map((c,i)=>capabilities(c,vectors[i]));
  return AXES.map(axis=>{
    // Damage stacks. For control, range and protection, one strong source
    // already covers much of the job, so extra copies have diminishing value.
    const values=profiles.map(p=>p[axis.id]);
    const sum=values.reduce((a,b)=>a+b,0);
    const max=Math.max(0,...values);
    const have=axis.id==='damage'?sum:max+(sum-max)*.55;
    const target=axis.id==='damage'&&team.length===1?1.42:axis.target;
    return {...axis,target,missing:Math.max(0,target-have)};
  });
}

export function draftFit(coverage, character, vector) {
  const profile=capabilities(character,vector);
  const gains=coverage.map(({id,target,missing,weight})=>({
    id,value:weight*Math.min(missing,profile[id])/target,
  })).sort((a,b)=>b.value-a.value);
  const score=gains.reduce((sum,gain)=>sum+gain.value,0);
  return {score,primary:gains[0]?.value>=.12?gains[0].id:null};
}
