import { characterMetric } from './characterMetrics.js';
import { combatStyle } from './combatProfiles.js';

// Tactical hypotheses from actual builds. Never a combat win-rate estimate.
export function matchupProfile(team) {
  const p={melee:0,ranged:0,first:0,dive:0,guard:0,counter:0,zone:0,helpers:0,cc:0,mobility:0};
  for (const member of team) {
    const tags=new Set(member.tags??[]), style=combatStyle(member), metric=characterMetric(member);
    if (member.weaponRange==='melee'||member.weaponRange==='ranged') p[member.weaponRange]++;
    p.first+=Number(style==='firstEngage'||style==='guardSometimesEngage');
    p.dive+=Number(style==='firstEngage'||style==='delayedEngage'||tags.has('dive'));
    p.guard+=Number(style==='guardOnly'||tags.has('peel')||tags.has('shield'));
    p.counter+=Number(style==='counterOnlyRanged'||style==='guardOnly');
    p.zone+=Number(tags.has('zone'));
    p.helpers+=Number(style==='rangedEngageHelper');
    p.cc+=metric.crowdControl; p.mobility+=metric.mobility;
  }
  return p;
}

export function compareMatchup(ownTeam,enemyTeam) {
  if (ownTeam.length!==3||enemyTeam.length!==3) return null;
  const a=matchupProfile(ownTeam), b=matchupProfile(enemyTeam), risks=[], chances=[];
  if (b.dive>=2&&a.ranged>=2&&a.guard===0) risks.push({kind:'caution',reason:'exposedBackline',priority:3});
  if (a.melee>=2&&a.first>=1&&b.guard>=1&&b.counter>=1) risks.push({kind:'caution',reason:'deniedEngage',priority:2});
  if (a.melee>=2&&b.ranged>=2&&b.zone>=1&&a.helpers===0) risks.push({kind:'caution',reason:'approachUnderFire',priority:2});
  if (a.guard>=1&&a.ranged>=2&&a.cc>=7&&b.melee>=2) chances.push({kind:'opportunity',reason:'protectAndCounter',priority:3});
  if (a.first>=2&&b.ranged>=2&&b.guard===0&&b.mobility<=a.mobility) chances.push({kind:'opportunity',reason:'catchBackline',priority:2});
  if (a.ranged>=2&&a.zone>=1&&b.melee>=2&&b.first<=1&&b.mobility<a.mobility+2) chances.push({kind:'opportunity',reason:'holdRange',priority:2});
  // Don't label the same enemy favorable after identifying a concrete weakness.
  return risks.sort((x,y)=>y.priority-x.priority)[0]??chances.sort((x,y)=>y.priority-x.priority)[0]??null;
}

export function matchupGuidance(ownTeam,references,resolveEnemy) {
  if (ownTeam.length!==3||new Set(ownTeam.map(c=>c.characterId)).size!==3) return [];
  const groups=new Map();
  for (const reference of references) {
    const enemyTeam=resolveEnemy(reference);
    if (enemyTeam.length!==3||new Set(enemyTeam.map(c=>c.characterId)).size!==3) continue;
    const result=compareMatchup(ownTeam,enemyTeam);
    if (!result) continue;
    const key=result.kind+':'+result.reason;
    const row=groups.get(key)??{...result,appearances:0,examples:[]};
    row.appearances+=reference.appearances??0;
    row.examples.push({members:reference.members,appearances:reference.appearances});
    groups.set(key,row);
  }
  return ['caution','opportunity'].flatMap(kind=>[...groups.values()].filter(row=>row.kind===kind)
    .sort((a,b)=>b.priority-a.priority||b.appearances-a.appearances).slice(0,2)
    .map(row=>({...row,examples:row.examples.sort((a,b)=>b.appearances-a.appearances).slice(0,1)})));
}
