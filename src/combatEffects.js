// Reviewed against official Korean localization (2026-10-29), not inferred from
// damage taken or trait popularity. Conditional skill effects remain conditional.
export const COMBAT_EFFECT_SOURCE = 'https://d1wkxvul68bth9.cloudfront.net/l10n/l10n-Korean-20261029123921.txt';

// Broad combat position, not the weapon's basic-attack category or exact meters.
// Adela/Tia cast from range with melee weapons; pistol Silvia fights up front.
export function combatRangeOf(character) {
  if (['frontline','bruiser','assassin'].includes(character?.role)) return 'melee';
  if (['ranged','mage','support'].includes(character?.role)) return 'ranged';
  return character?.weaponRange ?? 'unknown';
}

export const ALLY_HEAL_SKILLS = {
  sho: ['1013300'], silvia: ['1016200'], cathy: ['1023500'],
  johann: ['1041200','1041500'], mai: ['1045500'], priya: ['1051500'],
  adina: ['1052400'], theodore: ['1062200'], arda: ['1066100'],
  leni: ['1069200'], charlotte: ['1073300'],
};
export const ALLY_SHIELD_SKILLS = {
  leon: ['1029300'], mai: ['1045400'], priya: ['1051300'],
  adina: ['1052300'], estelle: ['1055500'], johann: ['1041400'],
  leni: ['1069400'], charlotte: ['1073400'], seres: ['1091500'],
};

export function intrinsicEffectTags(id, tags = []) {
  const result = new Set(tags);
  // Existing "shield" labels on these two characters describe only themselves.
  if (['vanya','theodore'].includes(id)) {
    result.delete('shield');
    result.add('selfShield');
  }
  if (ALLY_HEAL_SKILLS[id]) result.add('healing');
  if (ALLY_SHIELD_SKILLS[id]) result.add('shield');
  if (id === 'theodore') result.add('speedBoost');
  return [...result];
}

// These describe the trait's actual effects. Tempo is not movement speed;
// durability is not ally protection; ally shielding is not healing.
export const CORE_EFFECTS = {
  '7000201': { tags: [], profile: { damage: .70, tempo: .35 } },
  '7000401': { tags: ['sustain'], profile: { damage: .42, durability: .35, tempo: .20 } },
  '7000501': { tags: [], profile: { damage: .70, tempo: .35 } },
  '7000601': { tags: ['mobility'], profile: { damage: .70, tempo: .35 } },
  '7000701': { tags: [], profile: { damage: .70, tempo: .35 } },
  '7100101': { tags: [], profile: { durability: .78, cc: .12 } },
  '7100201': { tags: [], profile: { durability: .78 } },
  '7100401': { tags: ['selfShield','mobility'], profile: { durability: .45, tempo: .20 } },
  '7100501': { tags: ['sustain'], profile: { damage: .36, durability: .36, cc: .24, tempo: .20 } },
  '7200201': { tags: ['speedBoost','utility'], profile: { support: .50, damage: .28, tempo: .18 } },
  '7200301': { tags: ['healing','sustain'], profile: { support: .72, durability: .28 } },
  '7200501': { tags: ['shield'], profile: { support: .72, durability: .28 } },
  '7211301': { tags: ['speedBoost','utility'], profile: { damage: .35, support: .30, tempo: .20 } },
  '7300101': { tags: [], profile: { damage: .45, tempo: .38 } },
  '7300201': { tags: [], profile: { damage: .45, tempo: .38 } },
  '7300301': { tags: ['sustain','mobility'], profile: { damage: .42, durability: .35, tempo: .20 } },
};

export function coreEffectTags(baseTags, inferredTags, code) {
  const grants = CORE_EFFECTS[String(code)]?.tags ?? [];
  const mechanical = new Set(['peel','shield','healing','mobility','speedBoost','selfShield']);
  const base = new Set(baseTags);
  return [...new Set([
    ...inferredTags.filter(tag => !mechanical.has(tag) || base.has(tag) || grants.includes(tag)),
    ...baseTags.filter(tag => mechanical.has(tag)),
    ...grants,
  ])];
}
