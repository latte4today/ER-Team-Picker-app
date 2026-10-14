// A weapon-specific description takes precedence over the shared character profile.
// Keep a role-based fallback so future roster additions never render an empty card.
export function characterDescription(character, translate) {
  if (!character) return '';
  const keys = [
    `detail.character.${character.variantId}`,
    `recommender.signatureReasons.${character.characterId}`,
    `detail.roleDescription.${character.role}`,
    'detail.roleDescription.generic',
  ];
  for (const key of keys) {
    const value = translate(key);
    if (value && value !== key) return value;
  }
  return '';
}
