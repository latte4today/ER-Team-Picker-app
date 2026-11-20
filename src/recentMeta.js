import {characterVariants} from './data.js';
import {currentSeason, isCurrentRecent, canComparePreviousPatch, seasonVersion} from './seasonContext.js';
import {recentMetaSnapshot as bundled} from './recentMetaSnapshot.js';

// Bounded observational correction, not an estimated causal win-rate gain.
export const RECENT_META_POLICY=Object.freeze({minGames:300,priorGames:1500,maxBlend:0.35,maxCorrection:0.45,maxAgeDays:7,minCoreGames:100,minCoreShare:0.05});
export const META_RANK_LIMIT=10;
export const PRESEASON_META_POLICY=Object.freeze({minGames:120,priorGames:650,maxBlend:0.48,maxCorrection:0.55,maxMomentum:0.16,maxPulseAgeDays:2});
let snapshot=bundled;
let previousPreseason=bundled.phase==='preseason'?bundled:null;
let version=0;
const DAY=86400000;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const validRow=r=>r&&Number.isInteger(r.games)&&r.games>0&&Number.isInteger(r.wins)&&Number.isInteger(r.top3)&&r.wins>=0&&r.wins<=r.top3&&r.top3<=r.games&&Number.isFinite(r.placement)&&r.placement>=r.games&&Number.isFinite(r.pickShare)&&r.pickShare>=0&&r.pickShare<=1;
const variantIds = characterVariants.map(c=>c.variantId);
const ITEM_ICON_URL = /^https:\/\/cdn\.dak\.gg\/assets\/er\/game-assets\/\d+\.\d+\.\d+\/ItemIcon_\d+\.png$/;
export const validBuildIcon = (icon, code) => typeof icon === "string" && ITEM_ICON_URL.test(icon) && icon.endsWith(`/ItemIcon_${code}.png`);
function validPulse(cohort) {
  const p=cohort.pulse;
  if(!p)return true; // Keeps older snapshots usable when the short window is unavailable.
  return p.days===3&&Number.isFinite(Date.parse(p.updatedAt))
    &&Math.abs(Date.parse(p.updatedAt)-Date.parse(cohort.updatedAt))<=10*60000
    &&Object.keys(p.rows??{}).length>=Math.ceil(variantIds.length*0.8)
    &&['winRate','top3Rate','avgPlacement'].every(k=>Number.isFinite(p.averages?.[k]))
    &&p.averages.winRate>=0&&p.averages.winRate<=p.averages.top3Rate&&p.averages.top3Rate<=1&&p.averages.avgPlacement>=1
    &&Object.keys(p.rows).every(id=>{
      const r=p.rows[id],total=cohort.rows[id];
      return total&&r&&Number.isSafeInteger(r.population)&&r.population>=r.games&&validRow({...r,pickShare:r.games/r.population})
        &&['games','wins','top3','placement'].every(k=>r[k]<=total[k]);
    });
}
export function validRecentMeta(data) {
  if(data?.schemaVersion!==1||!Number.isFinite(Date.parse(data.generatedAt)))return false;
  if(Date.parse(data.generatedAt)>Date.now()+3600000)return false;
  if (!['ranked','preseason'].includes(data.phase)) return false;
  if (data.itemDetails !== undefined &&
      (!data.itemDetails || typeof data.itemDetails !== "object" ||
        Object.entries(data.itemDetails).some(([code, item]) => !item || !data.itemNames?.[code] ||
          !validBuildIcon(item.icon, code) || !item.stats || !Object.values(item.stats).every(Number.isFinite) ||
          !Array.isArray(item.effects) || item.effects.length > 3 ||
          !item.effects.every((effect) => typeof effect === "string" && effect.length <= 32)))) return false;
  const preseason=data.phase==='preseason';
  const keys=preseason?['unrank']:['diamond_plus','mithril_plus'];
  if(Object.keys(data.cohorts??{}).length!==keys.length)return false;
  const cs=keys.map(k=>data.cohorts?.[k]);
  return cs.every(c=>c&&Number.isInteger(c.patch)&&(preseason?c.days===7&&c.matchingMode===2:[3,7].includes(c.days)&&(c.matchingMode??3)===3)&&Number.isFinite(Date.parse(c.updatedAt))&&Date.parse(c.updatedAt)<=Date.parse(data.generatedAt)+3600000&&Object.keys(c.rows??{}).length>=variantIds.length&&
    variantIds.every(id=>c.rows[id])&&
    ['winRate','top3Rate','avgPlacement'].every(k=>Number.isFinite(c.averages?.[k]))&&c.averages.winRate>=0&&c.averages.winRate<=c.averages.top3Rate&&c.averages.top3Rate<=1&&c.averages.avgPlacement>=1&&
    Object.entries(c.rows).every(([id,r])=>/^[a-z_]+:[a-z_]+$/.test(id)&&validRow(r)&&Array.isArray(r.cores)&&r.cores.every(x=>validRow({...x,pickShare:x.games/r.games})&&/^\d{7}$/.test(x.core))&&
      Array.isArray(r.builds)&&r.builds.length<=3&&r.builds.every(b=>Array.isArray(b.items)&&b.items.length===5&&b.items.every(code=>Number.isInteger(code)&&typeof data.itemNames?.[code]==='string')&&validRow({...b,pickShare:b.games/r.games})))
    &&(preseason?validPulse(c):!c.pulse))&&cs.every(c=>c.patch===cs[0].patch&&c.days===cs[0].days);
}
export function setRecentMeta(data) {
  if(!validRecentMeta(data)||Date.parse(data.generatedAt)<=Date.parse(snapshot.generatedAt))return false;
  snapshot=structuredClone(data);
  if(snapshot.phase==='preseason')previousPreseason=snapshot;
  version++;return true;
}
export function recentMetaVersion(){return `${snapshot.generatedAt}:${version}:${seasonVersion()}:${Math.floor(Date.now()/3600000)}`;}
export function recentMetaSnapshot(){return snapshot;}

// Display only. All recommendation evidence goes through isCurrentRecent.
export function preseasonReference() {
  const season = currentSeason();
  const saved = previousPreseason?.cohorts.unrank;
  if (season.phase !== 'ranked' || !saved || saved.matchingMode !== 2
      || previousPreseason.seasonId >= season.seasonId
      || previousPreseason.seasonKey !== `PRE_${season.seasonKey}`
      || Math.floor(saved.patch / 1000) !== season.displaySeason
      || !(Date.parse(saved.updatedAt) < Date.parse(season.phaseStartedAt))) return null;
  const rows = Object.entries(saved.rows).map(([characterId, row]) => ({
    characterId, games: row.games, top3Rate: row.top3 / row.games, pickShare: row.pickShare,
  })).sort((a,b) => b.pickShare - a.pickShare || b.games - a.games);
  return { rows, updatedAt: saved.updatedAt };
}

// Source buckets do not equal the app buckets. Inexact transfer is discounted;
// lower tiers receive no high-tier performance correction.
export function recentCohort(tier='all',now=Date.now()) {
  const high=['meteor_mithril','mithril_plus','demigod_eternity'].includes(tier);
  const preseason=snapshot.phase==='preseason';
  const transfer=preseason?0.30:({all:0.5,platinum_diamond:0.6,diamond:0.8,meteor_mithril:0.8,mithril_plus:1,demigod_eternity:0.7})[tier]??0;
  const key=preseason?'unrank':high?'mithril_plus':'diamond_plus',cohort=snapshot.cohorts[key];
  const age=(now-Date.parse(cohort.updatedAt))/DAY;
  const freshness=!isCurrentRecent(snapshot,cohort)||age< -1||age>=RECENT_META_POLICY.maxAgeDays?0:Math.min(1,(RECENT_META_POLICY.maxAgeDays-age)/5);
  return {...cohort,key,transfer:cohort.days===3&&!preseason?transfer*0.5:transfer,freshness};
}
export function recentEvidence(variantId,tier='all',now=Date.now()) {
  const cohort=recentCohort(tier,now),row=cohort.rows[variantId];
  if(!row||!cohort.freshness)return null;
  return {row,cohort,winRate:row.wins/row.games,top3Rate:row.top3/row.games,avgPlacement:row.placement/row.games};
}
export function recentStrengthCorrection(variantId,tier,baseline,now=Date.now()) {
  const e=recentEvidence(variantId,tier,now);
  if(!e||!e.cohort.transfer)return 0;
  const preseason=e.cohort.key==='unrank';
  const policy=preseason?PRESEASON_META_POLICY:RECENT_META_POLICY;
  const pulse=currentPulse(e.cohort,now);
  const short=pulse?.rows[variantId];
  const hasShort=short&&short.games>=policy.minGames;
  const form=hasShort?recentRankingEvidence(variantId,tier,now):e;
  if(form.row.games<policy.minGames)return 0;
  const a=hasShort?pulse.averages:e.cohort.averages;
  const recent=(form.top3Rate-a.top3Rate)*7.2+(form.winRate-a.winRate)*4.8+(a.avgPlacement-form.avgPlacement)*0.82;
  const weight=policy.maxBlend*(preseason?0.55:e.cohort.transfer)*e.cohort.freshness*form.row.games/(form.row.games+policy.priorGames);
  const change=hasShort?pulseShift(e.row,short,'performance'):null;
  // Selection share is a watch signal only. A modest, bounded lift goes only
  // to an observed performance change with adequate independent samples.
  const momentum=change&&Math.abs(change.z)>=1&&Math.abs(change.delta)>=0.005
    ? clamp(change.delta*9*change.confidence,-policy.maxMomentum,policy.maxMomentum)*e.cohort.freshness : 0;
  return clamp((recent-baseline)*weight+momentum,-policy.maxCorrection,policy.maxCorrection);
}

// Keep historical combat measurements for that exact core, replacing only its
// outcome fields. Missing cores get no borrowed damage/healing measurements.
export function recentCoreRows(variantId,tier,legacy=[],now=Date.now()) {
  const e=recentEvidence(variantId,tier,now);
  if(!e||!e.cohort.transfer||e.cohort.days===3||e.cohort.freshness<0.6||e.row.games<300)return legacy;
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
function currentPulse(cohort,now) {
  const p=cohort.key==='unrank'&&cohort.freshness?cohort.pulse:null;
  return p&&now-Date.parse(p.updatedAt)<PRESEASON_META_POLICY.maxPulseAgeDays*DAY?p:null;
}
export function preseasonHasPulse(tier='all',now=Date.now()) {
  return Boolean(currentPulse(recentCohort(tier,now),now));
}
function pulsePair(total,short) {
  if(!total?.pickShare||!short)return null;
  const n=Math.round(total.games/total.pickShare);
  const previous={games:total.games-short.games,wins:total.wins-short.wins,
    top3:total.top3-short.top3,placement:total.placement-short.placement,population:n-short.population};
  if(previous.games<PRESEASON_META_POLICY.minGames||short.games<PRESEASON_META_POLICY.minGames
    ||previous.population<previous.games||!Number.isSafeInteger(previous.population)
    ||!validRow({...previous,pickShare:previous.games/previous.population}))return null;
  return {current:short,previous};
}
function pulseShift(total,short,kind) {
  const pair=pulsePair(total,short);if(!pair)return null;
  const {current:c,previous:p}=pair;
  const usage=kind==='usage';
  const n=usage?c.population:c.games,oldN=usage?p.population:p.games;
  const count=usage?c.games:c.top3,oldCount=usage?p.games:p.top3;
  const delta=count/n-oldCount/oldN;
  const pooled=(count+oldCount)/(n+oldN),se=Math.sqrt(pooled*(1-pooled)*(1/n+1/oldN));
  if(!(se>0))return null;
  const z=delta/se,smallerSample=Math.min(c.games,p.games);
  return {delta,z,confidence:smallerSample/(smallerSample+600)};
}
export function recentRankingEvidence(variantId,tier,now=Date.now()) {
  const e=recentEvidence(variantId,tier,now);
  if(!e)return null;
  const pulse=currentPulse(e.cohort,now),short=pulse?.rows[variantId];
  if(!short||short.games<PRESEASON_META_POLICY.minGames)return e;
  return {...e,row:{...e.row,...short},winRate:short.wins/short.games,
    top3Rate:short.top3/short.games,avgPlacement:short.placement/short.games};
}
export function recentMovers(tier='all',kind='usage',now=Date.now()) {
  const cohort=recentCohort(tier,now);
  if(!cohort.freshness)return [];
  if(cohort.key==='unrank'){
    const pulse=currentPulse(cohort,now);
    if(!pulse)return [];
    const minimum=kind==='usage'?0.00025:0.005;
    return Object.entries(pulse.rows).map(([variantId,row])=>({variantId,row,cohort,movement:pulseShift(cohort.rows[variantId],row,kind)}))
      .filter(r=>r.movement&&r.movement.delta>=minimum&&r.movement.z>=1)
      .sort((a,b)=>b.movement.delta*b.movement.confidence-a.movement.delta*a.movement.confidence).slice(0,META_RANK_LIMIT);
  }
  // Bonferroni-style z>=4 conservatively screens both families across 116 builds.
  return Object.entries(cohort.rows).filter(([,row])=>canComparePreviousPatch(row.previous,cohort)).map(([variantId,row])=>({variantId,row,cohort,movement:movement(row,kind)}))
    .filter(r=>r.movement?.z>=4).sort((a,b)=>b.movement.delta-a.movement.delta).slice(0,META_RANK_LIMIT);
}
