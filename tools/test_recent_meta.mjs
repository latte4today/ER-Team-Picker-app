import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {recentMetaSnapshot,recentCohort,recentStrengthCorrection,recentCoreRows,recentMovers,validRecentMeta,RECENT_META_POLICY} from '../src/recentMeta.js';
import {renderRecentDashboard,renderRecentEvidence} from '../src/recentMetaView.js';
import {characterVariants} from '../src/data.js';
import {normalizeTraitBuildRows,topCoreRowsForVariant} from '../src/traitMeta.js';

globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={documentElement:{lang:'ko',dataset:{}}};
const {t}=await import('../src/i18n/index.js');
const {evaluateCandidate,recommend,updateRecentMeta}=await import('../src/recommender.js');
const original=structuredClone(recentMetaSnapshot());
const now=Date.parse(original.cohorts.diamond_plus.updatedAt)+3600000;
assert.ok(validRecentMeta(original));
assert.equal(Object.keys(original.cohorts.diamond_plus.rows).length,characterVariants.length);
assert.equal(Object.keys(original.cohorts.mithril_plus.rows).length,characterVariants.length);
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
  if(raw.games>=300&&expected.length)assert.deepEqual(topCoreRowsForVariant(c.variantId,recentCoreRows(c.variantId,'all',[],now),{limit:4}).map(r=>r.core),expected.filter(r=>normalizeTraitBuildRows(c.variantId,[{...r,source:'recent-meta'}]).length).map(r=>r.core));
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
assert.ok(html.includes('최근 7일')&&html.includes('추천 아이템 구성'));
assert.ok(!html.includes('undefined')&&!html.includes('[object Object]'));
assert.ok(!/DAK|dak\.gg|<a\b|최근 메타 근거|recent-meta-evidence/i.test(html),'use source data internally without exposing links or raw cohort statistics');
for(const locale of ['ko','en','ja','zhHans','zhHant']) {
  const dictionary=(await import(`../src/i18n/${locale}.js`))[locale];
  const translate=(key,params={})=>String(dictionary[key]??key).replace(/\{(\w+)\}/g,(_,k)=>params[k]??'');
  const view=renderRecentDashboard('all',resolve,translate)+renderRecentEvidence('nia:pistol','all','7000401',translate);
  assert.ok(!/DAK|dak\.gg|<a\b|recent-meta-evidence|recent\.recommendedBuild|recent\.window/i.test(view),locale);
  assert.equal((view.match(/class="build-items"/g)??[]).length,1,'keep the actionable five-item build');
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
