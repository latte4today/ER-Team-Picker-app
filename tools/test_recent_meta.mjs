import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {preseasonReference,recentMetaSnapshot,recentCohort,recentStrengthCorrection,recentCoreRows,recentMovers,validRecentMeta,RECENT_META_POLICY,PRESEASON_META_POLICY,preseasonHasPulse,recentRankingEvidence} from '../src/recentMeta.js';
import {renderRecentDashboard,renderRecentEvidence} from '../src/recentMetaView.js';
import {characterVariants} from '../src/data.js';
import {normalizeTraitBuildRows,topCoreRowsForVariant} from '../src/traitMeta.js';
import {isCurrentRecent,isRankedOpeningWeek} from '../src/seasonContext.js';
import {preseasonTeamExamples,patchNoteForCharacter,patchNotesForItems} from '../src/preseason.js';

globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {t}=await import('../src/i18n/index.js');
const {evaluateCandidate,recommend,updateRecentMeta}=await import('../src/recommender.js');
const original=structuredClone(recentMetaSnapshot());
assert.ok(validRecentMeta(original));
const visibleText = (html) => html.replace(/<[^>]*>/g, "");
if (original.phase==='preseason') {
  const cohort=original.cohorts.unrank;
  if (!isCurrentRecent(original,cohort)) {
    assert.equal(recentCohort('all').freshness,0);
    const reference=preseasonReference();
    if(reference){
      assert.equal(reference.rows.length,characterVariants.length);
      assert.ok(reference.rows.every((row,i,rows)=>!i||row.pickShare<=rows[i-1].pickShare));
      assert.equal(recentStrengthCorrection(reference.rows[0].characterId,'all',0),0);
    }
    assert.ok(recommend(['rio:bow','lenox:whip'],'all').length>0);
    console.log('Previous preseason sample is withheld during the ranked transition.');
    process.exit(0);
  }
  assert.equal(cohort.matchingMode,2);
  assert.equal(Object.keys(cohort.rows).length,characterVariants.length);
  const wrong=structuredClone(original);wrong.cohorts.unrank.matchingMode=3;
  assert.equal(validRecentMeta(wrong),false,'never accept Ranked data as Normal');
  const observed=Date.parse(cohort.updatedAt)+3600000;
  assert.equal(recentCohort('all',observed).freshness,1);
  assert.equal(recentCohort('iron_gold',observed).transfer,recentCohort('mithril_plus',observed).transfer);
  assert.ok(recentCohort('all',observed).transfer<0.5,'normal outcomes have reduced weight');
  if (!cohort.pulse) assert.deepEqual(recentMovers('all','performance',observed),[]);
  const id='nia:pistol';
  const correction=recentStrengthCorrection(id,'all',-1,observed);
  assert.notEqual(correction,0);
  assert.equal(correction,recentStrengthCorrection(id,'mithril_plus',-1,observed));
  assert.equal(recentStrengthCorrection(id,'all',-1,observed+8*86400000),0);
  assert.ok(recentCoreRows(id,'all',[],observed).length);
  const find=id=>characterVariants.find(c=>c.variantId===id||c.characterId===id);
  const teams=preseasonTeamExamples(characterVariants.map(c=>({characterId:c.variantId})),find);
  assert.ok(teams.length>=3);
  for(const team of teams) {
    assert.equal(new Set(team.members.map(id=>find(id).characterId)).size,3);
    assert.deepEqual(team.members.map(id=>find(id).role),team.roles);
  }
  const realNow=Date.now;
  try {
    Date.now=()=>observed;
    const buildView = renderRecentEvidence(id,'all',null,t);
    assert.ok(buildView.includes('build-items'));
    if (original.itemDetails) {
      assert.ok(buildView.includes('ItemIcon_') && buildView.includes(t('recent.buildDelta')));
      const formerlyEmpty = renderRecentEvidence('priya:guitar','all',null,t);
      assert.equal((formerlyEmpty.match(/class="item-build-option"/g) ?? []).length, 3);
      const broken = structuredClone(original);
      const code = Object.keys(broken.itemDetails)[0];
      broken.itemDetails[code].icon = 'https://example.invalid/ItemIcon_' + code + '.png';
      assert.equal(validRecentMeta(broken), false);
    }
    assert.ok(renderRecentEvidence('no-data:bat','all',null,t).includes(t('recent.buildSampleMissing')));
    Date.now=()=>observed+8*86400000;
    assert.ok(renderRecentEvidence(id,'all',null,t).includes(t('recent.buildPatchPending')));
    Date.now=()=>observed;
    if(cohort.patch===13000) {
      assert.ok(patchNoteForCharacter('istvan',t).includes('자가 회복'));
      assert.ok(patchNotesForItems(['고스트'],t)[0].includes('10초'));
      const html=renderRecentDashboard('all',find,t);
      assert.ok(html.includes(t('recent.dashboard'))&&!html.includes(t('patch13.title'))&&!/DAK|dak\.gg|<a\b/.test(html));
    }
    const before=evaluateCandidate(['rio:bow','lenox:whip'],id,'all').total;
    const shifted=structuredClone(original);
    shifted.generatedAt=new Date(Date.parse(original.generatedAt)+1000).toISOString();
    delete shifted.cohorts.unrank.pulse;
    const row=shifted.cohorts.unrank.rows[id];
    row.wins=row.games;row.top3=row.games;row.placement=row.games;
    assert.ok(updateRecentMeta(shifted));
    assert.ok(evaluateCandidate(['rio:bow','lenox:whip'],id,'all').total>before,'normal outcomes reach the final recommendation');

    const fixture=structuredClone(shifted);
    const f=fixture.cohorts.unrank;
    f.pulse={days:3,updatedAt:f.updatedAt,averages:{winRate:.1,top3Rate:.4,avgPlacement:4.5},rows:{}};
    const ids=Object.keys(f.rows),pop=10000*ids.length;
    for(const key of ids) {
      // Independent halves: each build starts at 40% TOP 3 in both windows.
      const pulse={games:10000,top3:4000,wins:1000,placement:45000,population:pop};
      f.pulse.rows[key]=pulse;
      Object.assign(f.rows[key],{games:20000,top3:8000,wins:2000,placement:90000,pickShare:10000/pop,cores:[],builds:[]});
    }
    const bump=key=>fixture.generatedAt=new Date(Date.parse(fixture.generatedAt)+key).toISOString();
    bump(1);assert.ok(updateRecentMeta(fixture));
    const unshifted=recentStrengthCorrection(id,'all',0);
    assert.equal(recentMovers('all','performance').length,0);
    f.pulse.rows[id].top3+=60;f.rows[id].top3+=60; // +0.6 percentage points vs the earlier half.
    bump(1);assert.ok(updateRecentMeta(fixture));
    // A 0.6-point move with n=10k per half is too noisy on its own.
    assert.equal(recentMovers('all','performance').length,0);
    f.pulse.rows[id].top3+=20;f.rows[id].top3+=20; // +0.8pp, enough at this sample size.
    bump(1);assert.ok(updateRecentMeta(fixture));
    assert.equal(recentMovers('all','performance')[0]?.variantId,id);
    assert.ok(recentStrengthCorrection(id,'all',0)>unshifted);
    assert.equal(recentRankingEvidence(id,'all').row.games,10000);
    assert.ok(preseasonHasPulse('all'));
    assert.ok(!preseasonHasPulse('all',observed+3*86400000));
    assert.ok(Math.abs(recentStrengthCorrection(id,'all',20))<=PRESEASON_META_POLICY.maxCorrection);

  } finally {Date.now=realNow;}
  console.log('Preseason: exact current Normal patch, 116 variants, bounded tier-neutral scoring, live traits/builds, distinct practice teams and patch guidance.');
  process.exit(0);
}
const now=Date.parse(original.cohorts.diamond_plus.updatedAt)+3600000;
assert.equal(Object.keys(original.cohorts.diamond_plus.rows).length,characterVariants.length);
assert.equal(Object.keys(original.cohorts.mithril_plus.rows).length,characterVariants.length);
if (!isCurrentRecent(original,original.cohorts.diamond_plus)) {
  assert.equal(recentCohort('all').freshness,0,'cross-phase windows stay withheld');
  assert.ok(renderRecentDashboard('all',()=>null,t).includes(t(isRankedOpeningWeek()?'season.openingPending':'recent.unavailable')));
  assert.ok(recommend(['rio:bow','lenox:whip'],'all').every(r=>Number.isFinite(r.total)));
  console.log('Recent-meta cold start passed: valid aggregates retained, cross-phase outcomes withheld, recommendations available.');
  process.exit(0);
}
const id='nia:pistol';
assert.notEqual(recentStrengthCorrection(id,'all',-2,now),0,'large cumulative samples must not suppress recent outcomes');
assert.equal(recentStrengthCorrection(id,'iron_gold',-2,now),0,'do not transfer high-tier strength into low tiers');
assert.equal(recentStrengthCorrection(id,'all',-2,now+8*86400000),0,'old evidence expires');
for(const c of characterVariants)for(const tier of ['all','platinum_diamond','meteor_mithril','demigod_eternity'])for(const base of [-10,0,10]) {
  assert.ok(Math.abs(recentStrengthCorrection(c.variantId,tier,base,now))<=RECENT_META_POLICY.maxCorrection);
}
assert.equal(recentCohort('demigod_eternity',now).key,'mithril_plus');
assert.ok(recentCohort('all',now).transfer<recentCohort('mithril_plus',now).transfer);
for(const c of characterVariants) {
  const raw=original.cohorts.diamond_plus.rows[c.variantId];
  const expected=raw.cores.filter(r=>r.games>=100&&r.games/raw.games>=0.05).sort((a,b)=>b.games-a.games).slice(0,4);
  if(original.cohorts.diamond_plus.days===7&&raw.games>=300&&expected.length)assert.deepEqual(topCoreRowsForVariant(c.variantId,recentCoreRows(c.variantId,'all',[],now),{limit:4}).map(r=>r.core),expected.filter(r=>normalizeTraitBuildRows(c.variantId,[{...r,source:'recent-meta'}]).length).map(r=>r.core));
}
assert.deepEqual(recentCoreRows('luke:bat','iron_gold',[{core:'7200301'}],now),[{core:'7200301'}]);

const bad=structuredClone(original);bad.cohorts.diamond_plus.rows[id].wins=1e9;
assert.ok(!validRecentMeta(bad));assert.equal(updateRecentMeta(bad),false);
const before=evaluateCandidate(['rio:bow','lenox:whip'],id,'all',{},[],{[id]:'7000401'});
const lowBefore=evaluateCandidate(['rio:bow','lenox:whip'],id,'iron_gold',{},[],{[id]:'7000401'});
const changed=structuredClone(original);changed.generatedAt=new Date(Date.parse(original.generatedAt)+1).toISOString();
const row=changed.cohorts.diamond_plus.rows[id];
row.wins=row.games;row.top3=row.games;row.placement=row.games; // Outcomes only, preserve popularity/damage/core stats.
assert.ok(updateRecentMeta(changed));
const after=evaluateCandidate(['rio:bow','lenox:whip'],id,'all',{},[],{[id]:'7000401'});
assert.ok(after.total>before.total,'recent outcomes must actually reach the final composition score');
assert.equal(evaluateCandidate(['rio:bow','lenox:whip'],id,'iron_gold',{},[],{[id]:'7000401'}).total,lowBefore.total);
const usageOnly=structuredClone(changed);usageOnly.generatedAt=new Date(Date.parse(changed.generatedAt)+1).toISOString();
usageOnly.cohorts.diamond_plus.rows[id].pickShare=0.5;
assert.ok(updateRecentMeta(usageOnly));
assert.equal(evaluateCandidate(['rio:bow','lenox:whip'],id,'all',{},[],{[id]:'7000401'}).total,after.total,'popularity alone cannot improve a recommendation');
const restored={...original,generatedAt:new Date(Date.parse(usageOnly.generatedAt)+1).toISOString()};
assert.ok(updateRecentMeta(restored));
assert.equal(evaluateCandidate(['rio:bow','lenox:whip'],id,'all',{},[],{[id]:'7000401'}).total,before.total,'clear all dependent caches on data refresh');
assert.equal(updateRecentMeta(original),false,'reject rollback');
const legacy=[{core:'7000401',games:500}];
const sparse=structuredClone(original);sparse.generatedAt=new Date(Date.parse(restored.generatedAt)+1).toISOString();
sparse.cohorts.diamond_plus.rows[id]={...sparse.cohorts.diamond_plus.rows[id],games:10,wins:10,top3:10,placement:10,cores:[],builds:[]};
assert.ok(updateRecentMeta(sparse));
assert.equal(recentStrengthCorrection(id,'all',-2),0,'tiny hot streak earns no correction');
assert.deepEqual(recentCoreRows(id,'all',legacy),legacy);
restored.generatedAt=new Date(Date.parse(sparse.generatedAt)+1).toISOString();assert.ok(updateRecentMeta(restored));

const resolve=id=>characterVariants.find(c=>c.variantId===id);
const html=renderRecentDashboard('all',resolve,t)+renderRecentEvidence('nia:pistol','all','7000401',t);
assert.ok(html.includes(original.cohorts.diamond_plus.days===3?'최근 3일':'최근 7일')&&html.includes('추천 아이템 구성'));
assert.ok(!html.includes('undefined')&&!html.includes('[object Object]'));
assert.ok(!/DAK|dak\.gg|최근 메타 근거/i.test(visibleText(html))&&!/<a\b|recent-meta-evidence/i.test(html),'use source data internally without exposing links or raw cohort statistics');
for(const locale of ['ko','en','ja','zhHans','zhHant']) {
  const dictionary=(await import(`../src/i18n/${locale}.js`))[locale];
  const fallback=(await import('../src/i18n/en.js')).en;
  const translate=(key,params={})=>String(dictionary[key]??fallback[key]??key).replace(/\{(\w+)\}/g,(_,k)=>params[k]??'');
  const view=renderRecentDashboard('all',resolve,translate)+renderRecentEvidence('nia:pistol','all','7000401',translate);
  assert.ok(!/DAK|dak\.gg|recent\.recommendedBuild|recent\.window/i.test(visibleText(view))&&!/<a\b|recent-meta-evidence/i.test(view),locale);
  const buildCount = (view.match(/class="build-items"/g)??[]).length;
  assert.ok(buildCount >= 1 && buildCount <= 3, 'show up to three observed builds');
  assert.ok(!view.includes('undefined')&&!view.includes('[object Object]'));
}
for(const kind of ['usage','performance'])for(const r of recentMovers('all',kind))assert.ok(r.movement.z>=4&&r.row.games>=500&&r.row.previous.games>=500);

const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const context={};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function coreRanked('),source.indexOf('// The chips are built')),context);
const a={total:.4,recommendedCore:{name:'A',source:'recent-meta',games:500}},b={total:.6,recommendedCore:{name:'B',source:'recent-meta',games:150}};
assert.equal(context.coreRanked({best:b,alts:[a]}).all[0],b,'display exactly the core whose score ranks the card');
const rec=recommend(['rio:bow','lenox:whip'],'all');
assert.ok(rec.length>0&&rec.every(r=>Number.isFinite(r.total)));
const actualNow=Date.now;
try {
  Date.now=()=>now+8*86400000;
  assert.equal(evaluateCandidate([],id,'all').recommendedCore.source,'archive','cached current cores expire even without a successful network refresh');
  assert.ok(renderRecentDashboard('all',resolve,t).includes(t('recent.unavailable')));
} finally {Date.now=actualNow;}
console.log(JSON.stringify({passed:true,variants:characterVariants.length,scoreBefore:before.total,scoreAfterOutcomeChange:after.total,checks:'bounded recent-outcome path, cohort separation, expiry, tiny samples, popularity isolation, current cores, cache invalidation, rollback/malformed rejection, real HTML and displayed core consistency'}));
