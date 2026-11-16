import assert from 'node:assert/strict';
import {draftCoverage,draftFit} from '../src/draftFit.js';
import {currentSeason,setSeasonState} from '../src/seasonContext.js';
import {recentMetaSnapshot} from '../src/recentMeta.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {recommend,evaluateCandidate,updateOfficialStats}=await import('../src/recommender.js');

const tank={role:'frontline'}, shooter={role:'ranged'};
const tankVector={frontline:1,damage:.2,durability:1,engage:.9,cc:.6,peel:.7,support:.4,range:.2,poke:.1};
const carryVector={frontline:0,damage:1.2,durability:.15,engage:.05,cc:.12,peel:.05,support:.05,range:1,poke:.8};
const needsDamage=draftCoverage([tank,tank],[tankVector,tankVector]);
const needsFront=draftCoverage([shooter,shooter],[carryVector,carryVector]);
assert.equal(draftFit(needsDamage,shooter,carryVector).primary,'damage');
assert.ok(draftFit(needsDamage,shooter,carryVector).score>draftFit(needsDamage,tank,tankVector).score);
assert.equal(draftFit(needsFront,tank,tankVector).primary,'frontline');
assert.ok(draftFit(needsFront,tank,tankVector).score>draftFit(needsFront,shooter,carryVector).score);

const original=currentSeason();
const time=Date.now;
try {
  const anchor=Math.max(time(),Date.parse(original.generatedAt),Date.parse(recentMetaSnapshot().generatedAt))+2000;
  Date.now=()=>anchor;
  if(original.phase!=='preseason')assert.ok(setSeasonState({...original,seasonId:original.seasonId+1,
    phase:'preseason',seasonKey:'PRE_SEASON_98',generatedAt:new Date(anchor).toISOString()}));
  const phase=currentSeason();
  const sample=p=>recommend(p,'all',{},undefined,[],{}, {limit:5,includeAlternates:false});
  const damage=sample(['alonso:glove','estelle:axe']);
  const frontline=sample(['rio:bow','hart:guitar']);
  assert.ok(damage.every(r=>r.draftFit?.primary==='damage'));
  assert.ok(frontline.every(r=>r.draftFit?.primary==='frontline'));
  assert.ok(frontline[0].character.role==='frontline'||frontline[0].character.role==='bruiser');
  assert.equal(new Set([...damage,...frontline].map(r=>r.character.characterId)).size,10);
  assert.ok(new Set(frontline.map(r=>r.draftFit.score)).size>=4,'avoid saturating several compatible picks at the same fit value');
  const fixed=evaluateCandidate(['rio:bow','hart:guitar'],'lenox:whip');
  assert.equal(fixed.draftFit.primary,'frontline');
  updateOfficialStats({source:{seasonId:phase.seasonId-1},officialEmpiricalVectorStatsByTier:{
    all:{'lenox:whip':{vector:{frontline:0,damage:99,engage:99}}}}});
  assert.deepEqual(evaluateCandidate(['rio:bow','hart:guitar'],'lenox:whip').draftFit,fixed.draftFit,
    'outdated empirical vector cannot override current structural abilities');
  assert.ok(setSeasonState({...phase,phase:'ranked',seasonKey:'SEASON_98',seasonId:phase.seasonId+1,
    generatedAt:new Date(anchor+1).toISOString()}));
  assert.ok(sample(['rio:bow','hart:guitar'])[0].draftFit,'still use fallback while waiting for current ranked data');
  updateOfficialStats({source:{seasonId:currentSeason().seasonId}});
  assert.equal(sample(['rio:bow','hart:guitar'])[0].draftFit,null,'restore established ranking path once current ranked data is available');
} finally {Date.now=time;}
console.log('Draft fit: actual complementary roles, no saturated fit, stale stats excluded, current Ranked path restored.');
