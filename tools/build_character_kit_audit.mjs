import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {characters,characterVariants} from '../src/data.js';
import {combatStyle} from '../src/combatProfiles.js';
import {FALLBACK_CHARACTER_CODE_TO_ID} from './character_code_map.mjs';
import {ALLY_HEAL_SKILLS,ALLY_SHIELD_SKILLS,COMBAT_EFFECT_SOURCE} from '../src/combatEffects.js';
const index=process.argv.indexOf('--l10n');
if(index<0)throw Error('Pass --l10n with the official Korean localization file');
const raw=await fs.readFile(process.argv[index+1],'utf8');
const entries=new Map(raw.split(/\r?\n/).map(line=>{const i=line.indexOf('┃');return [line.slice(0,i),line.slice(i+1)];}));
const rows=Object.entries(FALLBACK_CHARACTER_CODE_TO_ID).map(([code,id])=>{
 const c=characters.find(c=>c.id===id);
 assert.equal(entries.get('Character/Name/'+code),c.name,`official ID/name mismatch: ${id}`);
 const skillGroups=[...entries.keys()].filter(key=>key.startsWith('Skill/LobbyDesc/')&&Math.floor(Number(key.split('/').at(-1))/1000)===1000+Number(code)).map(key=>key.split('/').at(-1));
 assert.ok(skillGroups.length>=5,`missing skill descriptions: ${id}`);
 for(const group of [...(ALLY_HEAL_SKILLS[id]??[]),...(ALLY_SHIELD_SKILLS[id]??[])]){
  assert.ok(skillGroups.includes(group),`wrong skill owner: ${id}/${group}`);
  assert.match(entries.get('Skill/LobbyDesc/'+group),/아군/,'support evidence must describe allies');
 }
 const variants=characterVariants.filter(v=>v.characterId===id);
 return {id,code:Number(code),name:c.name,skillGroups,allyHealSkills:ALLY_HEAL_SKILLS[id]??[],allyShieldSkills:ALLY_SHIELD_SKILLS[id]??[],
  variants:variants.map(v=>({id:v.variantId,role:v.role,damage:v.damage,combatStyle:combatStyle(v)}))};
});
assert.equal(rows.length,characters.length);
const report={source:COMBAT_EFFECT_SOURCE,sha256:crypto.createHash('sha256').update(raw).digest('hex'),scope:'Official identity/skill coverage and reviewed ally healing/shielding. Roles and combat styles remain model judgments, not official classes or win-rate claims.',characters:rows};
await fs.mkdir('reports',{recursive:true});
await fs.writeFile('reports/character-kit-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(`${rows.length} characters, ${rows.reduce((n,r)=>n+r.skillGroups.length,0)} skill groups, ${characterVariants.length} variants: official identity and effect-source checks passed.`);
