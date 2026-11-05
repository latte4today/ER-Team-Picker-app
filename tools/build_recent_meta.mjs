// Public aggregate statistics only. Never persist page props, players or routes.
import fs from 'node:fs/promises';
import {characterVariants} from '../src/data.js';
import {FALLBACK_CHARACTER_CODE_TO_ID} from './character_code_map.mjs';
import {COMBAT_EFFECT_SOURCE} from '../src/combatEffects.js';

const weaponIds={1:'glove',2:'tonfa',3:'bat',4:'whip',5:'throw',6:'shuriken',7:'bow',8:'crossbow',9:'pistol',10:'assault_rifle',11:'sniper_rifle',13:'hammer',14:'axe',15:'dagger',16:'two_handed_sword',18:'dual_swords',19:'spear',20:'nunchaku',21:'rapier',22:'guitar',23:'camera',24:'arcana',25:'vf_prosthetic'};
const root=new URL('../',import.meta.url);
async function page(url) {
  let error;
  for(let attempt=0;attempt<3;attempt++)try {
    const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'ER-Team-Picker aggregate updater'}});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const html=await r.text();
    const data=JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]??'null');
    if(!data?.props?.pageProps)throw Error('Missing server statistics');
    return data.props.pageProps;
  }catch(e){error=e;}
  throw Error(`${url}: ${error.message}`);
}
const aggregate=r=>({games:r.count,wins:r.win,top3:r.top3,placement:r.place});
const validAggregate=r=>Number.isInteger(r.games)&&r.games>0&&Number.isInteger(r.wins)&&r.wins>=0&&r.wins<=r.top3&&r.top3<=r.games&&Number.isFinite(r.placement)&&r.placement>=r.games;
const cohorts={};
for(const tier of ['diamond_plus','mithril_plus']) {
  const seed=await page(`https://dak.gg/er/characters/Niah?hl=ko&tier=${tier}`);
  const chars=seed.dehydratedState.queries.find(q=>q.queryKey[0]==='GET_CHARACTERS_KEY').state.data.characters;
  const wanted=new Set(characterVariants.map(v=>v.characterId));
  const jobs=chars.filter(c=>wanted.has(FALLBACK_CHARACTER_CODE_TO_ID[c.id]));
  const rows={};let next=0,patch=null,updatedAt=Infinity;
  await Promise.all(Array.from({length:3},async()=>{
    while(next<jobs.length) {
      const c=jobs[next++],url=`https://dak.gg/er/characters/${encodeURIComponent(c.key)}?hl=ko&tier=${tier}`;
      const p=c.key==='Niah'?seed:await page(url);
      const d=p.dehydratedState.queries.find(q=>q.queryKey[0]==='getCharacterStatistics')?.state.data;
      const s=d?.characterDetailStatSnapshot;
      if(d?.meta?.dt!==7||d.meta.tier!==tier||s?.matchingMode!==3||s.teamMode!==3||s.patch!==d.meta.patch)throw Error(`Wrong cohort: ${url}`);
      if(patch!==null&&patch!==s.patch)throw Error('Patch changed during collection; retry the whole snapshot');
      patch=s.patch;updatedAt=Math.min(updatedAt,Number(d.meta.updatedAt));
      const id=FALLBACK_CHARACTER_CODE_TO_ID[c.id];
      for(const w of s.characterDetailStat.weaponStats) {
        const v=characterVariants.find(v=>v.characterId===id&&(v.weapon===weaponIds[w.key]||v.weapon==='flex'));
        if(!v)throw Error(`Unmapped weapon ${id}:${w.key}`);
        if(rows[v.variantId])throw Error(`Ambiguous variant ${v.variantId}; do not double count weapon observations`);
        const previous=w.prevPatchStats?.find(x=>x.patch<s.patch);
        const row={...aggregate(w),pickShare:w.count/s.tierCount,url,
          previous:previous?{...aggregate(previous),patch:previous.patch,pickShare:previous.count/previous.tierCount}:null,
          cores:(w.traitCoreStats??[]).map(x=>({core:String(x.key),...aggregate(x)})),
          builds:(w.itemBuildStats??[]).filter(x=>x.count>=100&&x.key?.length===5).sort((a,b)=>b.count-a.count).slice(0,3).map(x=>({items:x.key,...aggregate(x)}))};
        if(!validAggregate(row)||row.cores.some(x=>!validAggregate(x)))throw Error(`Invalid aggregates: ${v.variantId}`);
        rows[v.variantId]=row;
      }
    }
  }));
  if(Object.keys(rows).length!==characterVariants.length||!Number.isFinite(updatedAt))throw Error(`Incomplete ${tier} snapshot`);
  const values=Object.values(rows),n=values.reduce((a,r)=>a+r.games,0);
  cohorts[tier]={patch,days:7,updatedAt:new Date(updatedAt).toISOString(),rows,averages:{
    winRate:values.reduce((a,r)=>a+r.wins,0)/n,top3Rate:values.reduce((a,r)=>a+r.top3,0)/n,avgPlacement:values.reduce((a,r)=>a+r.placement,0)/n}};
  console.log(`${tier}: ${values.length} variants, patch ${patch}; aggregate observations ${n} (cohorts overlap)`);
}
if(cohorts.diamond_plus.patch!==cohorts.mithril_plus.patch)throw Error('Cross-cohort patch mismatch');
const l10n=await fetch(COMBAT_EFFECT_SOURCE,{signal:AbortSignal.timeout(25000)}).then(r=>{if(!r.ok)throw Error('Item localization unavailable');return r.text();});
const names=new Map([...l10n.matchAll(/^Item\/Name\/(\d+)┃([^\r\n]+)/gm)].map(m=>[m[1],m[2]]));
const itemNames={};
for(const c of Object.values(cohorts))for(const row of Object.values(c.rows)) {
  row.builds=row.builds.filter(b=>b.items.every(code=>names.has(String(code))));
  for(const build of row.builds)for(const code of build.items)itemNames[code]=names.get(String(code));
}
const snapshot={schemaVersion:1,generatedAt:new Date().toISOString(),source:'DAK.GG public Rank/Squad aggregates',itemNameSource:COMBAT_EFFECT_SOURCE,itemNames,cohorts};
// Only replace both outputs after every character/cohort succeeds.
const json=JSON.stringify(snapshot);
await fs.writeFile(new URL('src/recentMetaSnapshot.json',root),json+'\n');
await fs.writeFile(new URL('src/recentMetaSnapshot.js',root),'// Generated by tools/build_recent_meta.mjs; public aggregates only.\nexport const recentMetaSnapshot = '+json+';\n');
