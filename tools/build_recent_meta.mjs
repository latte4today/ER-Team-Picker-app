import {seasonFromPage, publicPage as page} from './season_metadata.mjs';
// Public aggregate statistics only. Never persist page props, players or routes.
import fs from 'node:fs/promises';
import {characterVariants} from '../src/data.js';
import {FALLBACK_CHARACTER_CODE_TO_ID} from './character_code_map.mjs';
import {COMBAT_EFFECT_SOURCE} from '../src/combatEffects.js';

const weaponIds={1:'glove',2:'tonfa',3:'bat',4:'whip',5:'throw',6:'shuriken',7:'bow',8:'crossbow',9:'pistol',10:'assault_rifle',11:'sniper_rifle',13:'hammer',14:'axe',15:'dagger',16:'two_handed_sword',18:'dual_swords',19:'spear',20:'nunchaku',21:'rapier',22:'guitar',23:'camera',24:'arcana',25:'vf_prosthetic'};
const root=new URL('../',import.meta.url);
const aggregate=r=>({games:r.count,wins:r.win,top3:r.top3,placement:r.place});
const validAggregate=r=>Number.isInteger(r.games)&&r.games>0&&Number.isInteger(r.wins)&&r.wins>=0&&r.wins<=r.top3&&r.top3<=r.games&&Number.isFinite(r.placement)&&r.placement>=r.games;
function observedBuilds(weapon) {
  const builds = (weapon.itemBuildStats ?? [])
    .filter((row) => row.count >= 20 && row.count <= weapon.count && row.key?.length === 5 &&
      row.key.every((code) => Number.isSafeInteger(code) && code > 0) && new Set(row.key).size === 5)
    .map((row) => ({ items: row.key, ...aggregate(row) }))
    .filter(validAggregate)
    .sort((a, b) => b.games - a.games);
  const seen = new Set();
  const unique = builds.filter((build) => {
    const key = build.items.join("+");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!unique.length) return [];
  const [common, ...rest] = unique;
  const score = (build) => (build.top3 + 40 * weapon.top3 / weapon.count) / (build.games + 40);
  const higherTop3 = rest.filter((build) => build.games >= 40 && score(build) > score(common) + 0.025)
    .sort((a, b) => score(b) - score(a))[0];
  const distinct = rest.filter((b) => b !== higherTop3);
  const reference = higherTop3 ? [common, higherTop3] : [common];
  const changes = (b) => Math.min(...reference.map((other) => b.items.filter((item) => !other.items.includes(item)).length));
  distinct.sort((a, b) => changes(b) - changes(a) || b.games - a.games);
  return [...reference, ...distinct.filter((b) => changes(b) > 0).slice(0, 3 - reference.length)];
}
const itemsUrl = "https://er.dakgg.io/api/v1/data/items?hl=ko";
async function loadItemCatalog(patch) {
  const response = await fetch(itemsUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error("Item catalog unavailable");
  const { items } = await response.json();
  const version = Math.floor(patch / 1000) + "." + Math.floor(patch % 1000 / 10) + ".";
  const expectedBase = "https://cdn.dak.gg/assets/er/game-assets/" + version;
  return new Map(items.filter((item) => item.imageUrl?.startsWith(expectedBase)).map((item) => [item.id, item]));
}

const itemStats = new Map([
  ["공격력", "attack"], ["스킬 증폭", "amp"], ["방어력", "defense"], ["최대 체력", "health"],
  ["공격 속도", "attackSpeed"], ["쿨다운 감소", "cooldown"], ["치명타 확률", "crit"],
  ["이동 속도", "move"], ["모든 피해 흡혈", "lifesteal"], ["주는 치유 증가", "healing"],
]);
const percentItemStats = new Set(["attackSpeed", "crit", "lifesteal", "healing"]);
function itemDisplayData(item) {
  const stats = {};
  // Extract only unconditional stats. Adaptive, level-scaled and passive
  // numbers are intentionally kept out of the sums.
  for (const [, label, value, unit] of String(item.tooltip ?? "").matchAll(/^([^\r\n+]+?)\s+\+([0-9]+(?:\.[0-9]+)?)(%?)\s*$/gm)) {
    const key = itemStats.get(label.trim());
    if (key === "move" && unit === "%") stats.movePercent = Number(value);
    else if (key && (unit === "%") === percentItemStats.has(key)) stats[key] = Number(value);
  }
  const effects = [...new Set(Array.from(String(item.tooltip ?? "").matchAll(/<b><color=yellow>([^<>\r\n]{1,32})<\/color><\/b>/gi), (match) => match[1]))].slice(0, 3);
  return { icon: item.imageUrl, stats, effects };
}
const activeSeason=JSON.parse(await fs.readFile(new URL('src/seasonState.json',root),'utf8'));
const catalogPromise = loadItemCatalog(activeSeason.patch).catch(() => new Map());
const preseason=activeSeason.phase==='preseason';
const expectedMode=preseason?2:3;
const cohorts={};
for(const tier of preseason?['unrank']:['diamond_plus','mithril_plus']) {
  const seed=await page(`https://dak.gg/er/characters/Niah?hl=ko&tier=${tier}`);
  const chars=seed.dehydratedState.queries.find(q=>q.queryKey[0]==='GET_CHARACTERS_KEY').state.data.characters;
  const wanted=new Set(characterVariants.map(v=>v.characterId));
  const jobs=chars.filter(c=>wanted.has(FALLBACK_CHARACTER_CODE_TO_ID[c.id]));
  const rows={},shortRows={};let next=0,patch=null,updatedAt=Infinity,shortUpdatedAt=Infinity;
  await Promise.all(Array.from({length:3},async()=>{
    while(next<jobs.length) {
      const c=jobs[next++],url=`https://dak.gg/er/characters/${encodeURIComponent(c.key)}?hl=ko&tier=${tier}`;
      const p=c.key==='Niah'?seed:await page(url);
      const phase=seasonFromPage(p,activeSeason);
      if (phase.seasonId!==activeSeason.seasonId || phase.patch!==activeSeason.patch || Math.floor(phase.patch/1000)!==phase.displaySeason) throw Error('Season changed or statistics lag the new season; retry later');
      const d=p.dehydratedState.queries.find(q=>q.queryKey[0]==='getCharacterStatistics')?.state.data;
      const s=d?.characterDetailStatSnapshot;
      if(d?.meta?.dt!==7||d.meta.tier!==tier||s?.matchingMode!==expectedMode||s.dt!==7||s.teamMode!==3||s.patch!==d.meta.patch)throw Error(`Wrong cohort: ${url}`);
      if(patch!==null&&patch!==s.patch)throw Error('Patch changed during collection; retry the whole snapshot');
      patch=s.patch;updatedAt=Math.min(updatedAt,Number(d.meta.updatedAt));
      const id=FALLBACK_CHARACTER_CODE_TO_ID[c.id];
      for(const w of s.characterDetailStat.weaponStats) {
        const v=characterVariants.find(v=>v.characterId===id&&(v.weapon===weaponIds[w.key]||v.weapon==='flex'));
        if(!v)throw Error(`Unmapped weapon ${id}:${w.key}`);
        if(rows[v.variantId])throw Error(`Ambiguous variant ${v.variantId}; do not double count weapon observations`);
        const previous=preseason?null:w.prevPatchStats?.find(x=>x.patch<s.patch);
        const row={...aggregate(w),pickShare:w.count/s.tierCount,url,
          previous:previous?{...aggregate(previous),patch:previous.patch,pickShare:previous.count/previous.tierCount}:null,
          cores:(w.traitCoreStats??[]).map(x=>({core:String(x.key),...aggregate(x)})),
          builds:observedBuilds(w)};
        if(!validAggregate(row)||row.cores.some(x=>!validAggregate(x)))throw Error(`Invalid aggregates: ${v.variantId}`);
        rows[v.variantId]=row;
      }
      if(preseason) {
        // Compare two windows from one patch and mode. A failed short window
        // must not prevent publication of the otherwise complete base snapshot.
        try {
          const shortPage=await page(url+'&dt=3');
          const shortPhase=seasonFromPage(shortPage,activeSeason);
          const short=shortPage.dehydratedState.queries.find(q=>q.queryKey[0]==='getCharacterStatistics')?.state.data;
          const window=short?.characterDetailStatSnapshot;
          const stamp=Number(short?.meta?.updatedAt);
          if(shortPhase.seasonId!==activeSeason.seasonId||short?.meta?.dt!==3||short.meta.tier!==tier||
             window?.dt!==3||window.matchingMode!==2||window.teamMode!==3||window.patch!==s.patch||
             Math.abs(stamp-Number(d.meta.updatedAt))>10*60000||!Number.isFinite(stamp))continue;
          shortUpdatedAt=Math.min(shortUpdatedAt,stamp);
          for(const w of window.characterDetailStat.weaponStats) {
            const v=characterVariants.find(v=>v.characterId===id&&(v.weapon===weaponIds[w.key]||v.weapon==='flex'));
            if(!v||shortRows[v.variantId])continue;
            const current={...aggregate(w),population:window.tierCount};
            const total=rows[v.variantId];
            if(!validAggregate(current)||!total||current.games>total.games||current.wins>total.wins||
               current.top3>total.top3||current.placement>total.placement||
               !Number.isSafeInteger(current.population)||current.population<current.games)continue;
            shortRows[v.variantId]=current;
          }
        } catch { /* Use the complete seven-day cohort when the short window is unavailable. */ }
      }
    }
  }));
  if(Object.keys(rows).length!==characterVariants.length||!Number.isFinite(updatedAt))throw Error(`Incomplete ${tier} snapshot`);
  const values=Object.values(rows),n=values.reduce((a,r)=>a+r.games,0);
  cohorts[tier]={patch,days:7,matchingMode:expectedMode,updatedAt:new Date(updatedAt).toISOString(),rows,averages:{
    winRate:values.reduce((a,r)=>a+r.wins,0)/n,top3Rate:values.reduce((a,r)=>a+r.top3,0)/n,avgPlacement:values.reduce((a,r)=>a+r.placement,0)/n}};
  if(preseason&&Object.keys(shortRows).length>=Math.ceil(characterVariants.length*0.8)){
    const short=Object.values(shortRows),games=short.reduce((sum,row)=>sum+row.games,0);
    cohorts[tier].pulse={days:3,updatedAt:new Date(shortUpdatedAt).toISOString(),rows:shortRows,averages:{
      winRate:short.reduce((sum,row)=>sum+row.wins,0)/games,
      top3Rate:short.reduce((sum,row)=>sum+row.top3,0)/games,
      avgPlacement:short.reduce((sum,row)=>sum+row.placement,0)/games}};
    console.log(`Short preseason window: ${short.length} variants, ${games} observations`);
  } else if(preseason) console.warn(`Short window unavailable: ${Object.keys(shortRows).length}/${characterVariants.length} verified variants`);
  console.log(`${tier}: ${values.length} variants, patch ${patch}; aggregate observations ${n} (cohorts overlap)`);
}
if(!preseason&&cohorts.diamond_plus.patch!==cohorts.mithril_plus.patch)throw Error('Cross-cohort patch mismatch');
const catalog = await catalogPromise;
const usedCodes = new Set(Object.values(cohorts).flatMap((c) =>
  Object.values(c.rows).flatMap((row) => row.builds.flatMap((build) => build.items))));
const names = new Map([...catalog].map(([id, item]) => [id, item.name]));
if ([...usedCodes].some((id) => !names.get(id))) {
  const l10n = await fetch(COMBAT_EFFECT_SOURCE, { signal: AbortSignal.timeout(15_000) })
    .then((r) => r.ok ? r.text() : "").catch(() => "");
  for (const [, code, name] of l10n.matchAll(/^Item\/Name\/(\d+)┃([^\r\n]+)/gm)) {
    if (!names.get(Number(code))) names.set(Number(code), name);
  }
}
const itemNames = {};
const itemDetails = {};
for(const c of Object.values(cohorts))for(const row of Object.values(c.rows)) {
  row.builds=row.builds.filter(b=>b.items.every(code=>names.get(code)));
  for(const build of row.builds)for(const code of build.items) {
    itemNames[code] = names.get(code);
    if (catalog.has(code) && !itemDetails[code]) itemDetails[code] = itemDisplayData(catalog.get(code));
  }
}
if (usedCodes.size && !Object.keys(itemNames).length) throw Error("Could not resolve item names");
const snapshot={schemaVersion:1,seasonId:activeSeason.seasonId,seasonKey:activeSeason.seasonKey,phase:activeSeason.phase,generatedAt:new Date().toISOString(),source:preseason?'Public Normal/Squad aggregates':'Public Ranked/Squad aggregates',itemNameSource:catalog.size?itemsUrl:COMBAT_EFFECT_SOURCE,itemNames,itemDetails,cohorts};
// Only replace both outputs after every character/cohort succeeds.
const json=JSON.stringify(snapshot);
await fs.writeFile(new URL('src/recentMetaSnapshot.json',root),json+'\n');
await fs.writeFile(new URL('src/recentMetaSnapshot.js',root),'// Generated by tools/build_recent_meta.mjs; public aggregates only.\nexport const recentMetaSnapshot = '+json+';\n');
