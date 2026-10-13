import { characterMetric } from './characterMetrics.js';
import { combatStyle } from './combatProfiles.js';

// Explain how a complete, core-adjusted team can fight. No ranking weights.
export function teamConcepts(team) {
  if (team.length !== 3 || new Set(team.map(c => c.characterId)).size !== 3) return [];
  let endurance=0, guard=0, damage=0, ranged=0, melee=0, first=0, follow=0, zone=0, cc=0;
  for (const character of team) {
    const tags=new Set(character.tags??[]), style=combatStyle(character);
    endurance+=Number(tags.has('healing')||tags.has('sustain')||tags.has('shield')
      ||(tags.has('durable')&&tags.has('sustained')));
    guard+=Number(tags.has('peel')||tags.has('shield')||style==='guardOnly');
    damage+=Number((['ranged','mage','assassin'].includes(character.role)&&character.backlineDamage!=='low')
      ||character.frontDamage==='high'||(character.role==='bruiser'&&character.frontDamage!=='low'));
    ranged+=Number(character.weaponRange==='ranged');
    melee+=Number(character.weaponRange==='melee');
    first+=Number(style==='firstEngage'||style==='guardSometimesEngage');
    follow+=Number(style==='delayedEngage'||style==='diveFollowRanged'||style==='rangedEngageHelper');
    zone+=Number(tags.has('zone'));
    cc+=characterMetric(character).crowdControl;
  }
  const concepts=[];
  if (endurance>=2&&damage>=1) concepts.push('attrition');
  if (cc>=9&&damage>=1) concepts.push('controlFocus');
  if (guard>=1&&ranged>=1&&damage>=1) concepts.push('protectCarry');
  if (first>=1&&follow>=1&&melee>=2&&damage>=1) concepts.push('engageFollow');
  if (ranged>=2&&zone>=1&&damage>=1) concepts.push('pokeZone');
  return concepts.slice(0,3);
}
