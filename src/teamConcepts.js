import { characterMetric } from './characterMetrics.js';
import { combatStyle } from './combatProfiles.js';

// A proposed operating plan, not a strength bonus or a claim of sufficient damage.
// Pure guards and ranged CC helpers do not count as a second diving damage dealer.
export function teamCombatPlan(team) {
  const empty = { primary: null, supports: [] };
  if (team.length !== 3 || new Set(team.map(c => c.characterId)).size !== 3) return empty;
  let endurance=0, anchor=0, guardOnly=0, damage=0, ranged=0, meleeDamage=0, first=0, follow=0, zone=0, cc=0;
  for (const character of team) {
    const tags=new Set(character.tags??[]), style=combatStyle(character);
    const dealer=(['ranged','mage','assassin'].includes(character.role)&&character.backlineDamage!=='low')
      ||character.frontDamage==='high'||(character.role==='bruiser'&&character.frontDamage!=='low');
    const meleeDealer=dealer&&character.weaponRange==='melee'&&style!=='guardOnly';
    endurance+=Number(tags.has('healing')||tags.has('sustain')||tags.has('shield')
      ||(tags.has('durable')&&tags.has('sustained')));
    anchor+=Number(['frontline','support'].includes(character.role)
      &&(tags.has('peel')||tags.has('shield')||style==='guardOnly'||style==='guardSometimesEngage'));
    guardOnly+=Number(style==='guardOnly');
    damage+=Number(dealer);
    ranged+=Number(dealer&&character.weaponRange==='ranged');
    meleeDamage+=Number(meleeDealer);
    first+=Number(meleeDealer&&['firstEngage','guardSometimesEngage'].includes(style));
    follow+=Number(meleeDealer&&style==='delayedEngage');
    zone+=Number(tags.has('zone'));
    cc+=characterMetric(character).crowdControl;
  }
  if (!damage) return empty;
  let primary=null;
  if (!guardOnly&&meleeDamage>=2&&first&&follow) primary='engageFollow';
  else if (endurance>=2) primary='attrition';
  else if (anchor&&ranged) primary='protectCarry';
  else if (ranged>=2&&zone) primary='pokeZone';
  else if (cc>=9) primary='controlFocus';
  if (!primary) return empty;
  const supports=[];
  if (cc>=9) supports.push(['protectCarry','attrition','pokeZone'].includes(primary)?'stopEntry':'chainControl');
  if (endurance>=1) supports.push('recovery');
  return { primary, supports };
}

export function teamConcepts(team) {
  const { primary }=teamCombatPlan(team);
  return primary ? [primary] : [];
}
