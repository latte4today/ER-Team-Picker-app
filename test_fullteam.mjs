import { recommendFullTeam } from './src/recommender.js';
const result = recommendFullTeam('celine:assault_rifle');
console.log('count:', result.length);
result.slice(0, 3).forEach((c, i) => {
  console.log(`#${i+1}: ${c.teammate1.character.id} + ${c.teammate2.character.id} = ${c.combinedScore}`);
});
