import {currentSeason} from './seasonContext.js';

// Official 13.0 Part 1/2 and 13.0a/b. These are play notes, not win-rate priors.
export const S13_PATCH = 13000;
export const changedCharacters = Object.freeze(['nia','daniel','lucia','luke','markus','yumin','istvan']);
const changedItems = new Map([
  ['트윈보우','bow'], ['이글 아이','bow'], ['광학미채 슈트','antiHeal'],
  ['락커의 자켓','noAntiHeal'], ['슈팅스타 자켓','noAntiHeal'], ['월왕구천','noAntiHeal'],
  ['고스트','specter'], ['클라다 반지','bond'], ['아이보리 스텝','ivory'],
  ['성기사의 투구','guard'], ['에메랄드 타블렛','overload'], ['제너레이터','generator'],
  ['제왕의 투구','doubleHit'], ['백우선','swift'], ['파초선','swift'],
]);
export function patchNoteForCharacter(id, t) {
  return currentSeason().patch === S13_PATCH && changedCharacters.includes(id) ? t(`patch13.char.${id}`) : '';
}
export function patchNotesForItems(names, t) {
  if (currentSeason().patch !== S13_PATCH) return [];
  return [...new Set(names.map(name=>changedItems.get(name)).filter(Boolean))].map(key=>t(`patch13.item.${key}`));
}

// Examples are built from the provisional character list, not inferred trio rates.
const templates = [
  ['frontline','ranged','mage'],
  ['bruiser','ranged','support'],
  ['frontline','assassin','mage'],
  ['frontline','bruiser','ranged'],
  ['bruiser','mage','support'],
  ['frontline','ranged','support'],
  ['bruiser','assassin','ranged'],
  ['frontline','bruiser','mage'],
];
export function preseasonTeamExamples(rankRows, resolve) {
  const candidates=rankRows.map(row=>resolve(row.characterId)).filter(Boolean);
  const used=new Set();
  return templates.flatMap(roles=>{
    const members=[];
    for(const role of roles) {
      const eligible=candidates.filter(c=>c.role===role&&!members.some(m=>m.characterId===c.characterId));
      const pick=eligible.find(c=>!used.has(c.characterId))??eligible[0];
      if(!pick)return [];
      members.push(pick);
    }
    members.forEach(c=>used.add(c.characterId));
    return [{members:members.map(c=>c.variantId),roles}];
  });
}
