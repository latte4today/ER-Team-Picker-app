import assert from 'node:assert/strict';
import { characterVariants } from '../src/data.js';
import { characterDescription } from '../src/characterDescriptions.js';
import { ko } from '../src/i18n/ko.js';
import { en } from '../src/i18n/en.js';
import { ja } from '../src/i18n/ja.js';
import { zhHans } from '../src/i18n/zhHans.js';
import { zhHant } from '../src/i18n/zhHant.js';

for (const dictionary of [ko,en,ja,zhHans,zhHant]) {
  const translate = key => dictionary[key] ?? key;
  for (const character of characterVariants) {
    const description = characterDescription(character,translate);
    assert.ok(description.trim().length > 0,`${character.variantId}: description missing`);
    assert.notEqual(description,dictionary[`detail.roleDescription.${character.role}`],
      `${character.variantId}: current roster must have a specific profile`);
  }
  const aya = characterVariants.filter(c=>c.characterId === 'aya');
  assert.equal(new Set(aya.map(c=>characterDescription(c,translate))).size,3);
  const rio = characterVariants.find(c=>c.characterId === 'rio');
  assert.equal(characterDescription(rio,translate),dictionary['recommender.signatureReasons.rio']);
  assert.equal(characterDescription({characterId:'future',variantId:'future:bow',role:'ranged'},translate),dictionary['detail.roleDescription.ranged']);
  assert.equal(characterDescription({characterId:'future',variantId:'future:new',role:'new'},translate),dictionary['detail.roleDescription.generic']);
  assert.equal(characterDescription(null,translate),'');
}
console.log(`Character descriptions: ${characterVariants.length} weapon variants × 5 languages, Aya weapon distinctions, preserved profiles and future-roster fallbacks passed.`);

