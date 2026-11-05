import {recentMetaSnapshot as bundled} from './recentMetaSnapshot.js';

// Bounded observational correction, not an estimated causal win-rate gain.
export const RECENT_META_POLICY=Object.freeze({minGames:300,priorGames:1500,maxBlend:0.35,maxCorrection:0.45,maxAgeDays:7,minCoreGames:100,minCoreShare:0.05});
let snapshot=bundled;
let version=0;
const DAY=86400000;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const validRow=r=>r&&Number.isInteger(r.games)&&r.games>0&&Number.isInteger(r.wins)&&Number.isInteger(r.top3)&&r.wins>=0&&r.wins<=r.top3&&r.top3<=r.games&&Number.isFinite(r.placement)&&r.placement>=r.games&&Number.isFinite(r.pickShare)&&r.pickShare>=0&&r.pickShare<=1;
export function validRecentMeta(data) {
  if(data?.schemaVersion!==1||!Number.isFinite(Date.parse(data.generatedAt)))return false;
  if(Date.parse(data.generatedAt)>Date.now()+3600000)return false;
  const cs=['diamond_plus','mithril_plus'].map(k=>data.cohorts?.[k]);
  return cs.every(c=>c&&Number.isInteger(c.patch)&&c.days===7&&Number.isFinite(Date.parse(c.updatedAt))&&Date.parse(c.updatedAt)<=Date.parse(data.generatedAt)+3600000&&Object.keys(c.rows??{}).length>=Object.keys(bundled.cohorts.diamond_plus.rows).length&&
    Object.keys(bundled.cohorts.diamond_plus.rows).every(id=>c.rows[id])&&
    ['winRate','top3Rate','avgPlacement'].every(k=>Number.isFinite(c.averages?.[k]))&&c.averages.winRate>=0&&c.averages.winRate<=c.averages.top3Rate&&c.averages.top3Rate<=1&&c.averages.avgPlacement>=1&&
    Object.entries(c.rows).every(([id,r])=>/^[a-z_]+:[a-z_]+$/.test(id)&&validRow(r)&&Array.isArray(r.cores)&&r.cores.every(x=>validRow({...x,pickShare:x.games/r.games})&&/^\d{7}$/.test(x.core))&&
      Array.isArray(r.builds)&&r.builds.length<=3&&r.builds.every(b=>Array.isArray(b.items)&&b.items.length===5&&b.items.every(code=>Number.isInteger(code)&&typeof data.itemNames?.[code]==='string')&&validRow({...b,pickShare:b.games/r.games}))))&&cs[0].patch===cs[1].patch;
}
export function setRecentMeta(data) {
  if(!validRecentMeta(data)||Date.parse(data.generatedAt)<=Date.parse(snapshot.generatedAt))return false;
  snapshot=structuredClone(data);version++;return true;
}
export function recentMetaVersion(){return `${snapshot.generatedAt}:${version}:${Math.floor(Date.now()/3600000)}`;}
export function recentMetaSnapshot(){return snapshot;}

// Source buckets do not equal the app buckets. Inexact transfer is discounted;
// lower tiers receive no high-tier performance correction.
export function recentCohort(tier='all',now=Date.now()) {
  const high=['meteor_mithril','mithril_plus','demigod_eternity'].includes(tier);
  const transfer=({all:0.5,platinum_diamond:0.6,diamond:0.8,meteor_mithril:0.8,mithril_plus:1,demigod_eternity:0.7})[tier]??0;
  const key=high?'mithril_plus':'diamond_plus',cohort=snapshot.cohorts[key];
  const age=(now-Date.parse(cohort.updatedAt))/DAY;
  const freshness=age< -1||age>=RECENT_META_POLICY.maxAgeDays?0:Math.min(1,(RECENT_META_POLICY.maxAgeDays-age)/5);
  return {...cohort,key,transfer,freshness};
}
export function recentEvidence(variantId,tier='all',now=Date.now()) {
  const cohort=recentCohort(tier,now),row=cohort.rows[variantId];
  if(!row||!cohort.freshness)return null;
  return {row,cohort,winRate:row.wins/row.games,top3Rate:row.top3/row.games,avgPlacement:row.placement/row.games};
}
export function recentStrengthCorrection(variantId,tier,baseline,now=Date.now()) {
  const e=recentEvidence(variantId,tier,now);
  if(!e||!e.cohort.transfer||e.row.games<RECENT_META_POLICY.minGames)return 0;
  const a=e.cohort.averages;
  const recent=(e.top3Rate-a.top3Rate)*7.2+(e.winRate-a.winRate)*4.8+(a.avgPlacement-e.avgPlacement)*0.82;
  const weight=RECENT_META_POLICY.maxBlend*e.cohort.transfer*e.cohort.freshness*e.row.games/(e.row.games+RECENT_META_POLICY.priorGames);
  return clamp((recent-baseline)*weight,-RECENT_META_POLICY.maxCorrection,RECENT_META_POLICY.maxCorrection);
}

// Keep historical combat measurements for that exact core, replacing only its
// outcome fields. Missing cores get no borrowed damage/healing measurements.
export function recentCoreRows(variantId,tier,legacy=[],now=Date.now()) {
  const e=recentEvidence(variantId,tier,now);
  if(!e||!e.cohort.transfer||e.cohort.freshness<0.6||e.row.games<300)return legacy;
  if(!e.row.cores.some(r=>r.games>=100&&r.games/e.row.games>=0.05))return legacy;
  const rows=e.row.cores.filter(r=>r.games>0)
    .sort((a,b)=>b.games-a.games).map(r=>({...legacy.find(x=>String(x.core)===r.core),core:r.core,games:r.games,corePickShare:r.games/e.row.games,
      winRate:r.wins/r.games,top3Rate:r.top3/r.games,avgPlacement:r.placement/r.games,source:'recent-meta',cohort:e.cohort.key,performanceWeight:e.cohort.transfer*e.cohort.freshness}));
  return rows.length?rows:legacy;
}

// Two-proportion approximation for screening, not proof of a patch's effect.
function movement(r,kind) {
  const p=r.previous;if(!p||r.games<500||p.games<500)return null;
  const current=kind==='usage'?r.pickShare:r.top3/r.games;
  const previous=kind==='usage'?p.pickShare:p.top3/p.games;
  const n=kind==='usage'?r.games/r.pickShare:r.games,oldN=kind==='usage'?p.games/p.pickShare:p.games;
  const pooled=(current*n+previous*oldN)/(n+oldN),se=Math.sqrt(pooled*(1-pooled)*(1/n+1/oldN));
  const delta=current-previous,z=se>0?delta/se:0;
  return Number.isFinite(z)&&delta>=(kind==='usage'?0.0025:0.02)?{delta,z}:null;
}
export function recentMovers(tier='all',kind='usage',now=Date.now()) {
  const cohort=recentCohort(tier,now);
  if(!cohort.freshness)return [];
  // Bonferroni-style z>=4 conservatively screens both families across 116 builds.
  return Object.entries(cohort.rows).map(([variantId,row])=>({variantId,row,cohort,movement:movement(row,kind)}))
    .filter(r=>r.movement?.z>=4).sort((a,b)=>b.movement.delta-a.movement.delta).slice(0,5);
}
