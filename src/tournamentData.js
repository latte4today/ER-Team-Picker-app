import { characters, characterVariants } from './data.js';
const ids=new Set(characters.map(c=>c.id));
const variants=new Set(characterVariants.map(c=>c.variantId));
export function validTournamentData(data) {
  return Number.isSafeInteger(data?.totalGames)&&data.totalGames>0
    &&(data.latestMatchAt==null||typeof data.latestMatchAt==='string')
    &&(data.generatedAt==null||typeof data.generatedAt==='string')
    &&Array.isArray(data.compositions)&&data.compositions.length>0
    &&data.compositions.every(row=>row&&Array.isArray(row.members)&&row.members.length===3&&new Set(row.members).size===3
      &&row.members.every(id=>ids.has(id))&&Number.isSafeInteger(row.appearances)&&row.appearances>0
      &&Number.isFinite(row.rank)&&row.rank>=1&&row.rank<=8&&Number.isFinite(row.ts)&&Number.isFinite(row.ks))
    &&Array.isArray(data.builds)&&data.builds.every(row=>row&&Array.isArray(row.members)&&row.members.length===3
      &&row.members.every(m=>m&&variants.has(m.variantId)&&Number.isSafeInteger(m.core)&&m.core>0)
      &&new Set(row.members.map(m=>m.variantId.split(':')[0])).size===3
      &&Number.isSafeInteger(row.appearances)&&row.appearances>0);
}
