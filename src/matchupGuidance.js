import { characterMetric } from './characterMetrics.js';
import { combatStyle } from './combatProfiles.js';

// Tactical comparisons, not measured encounter win rates.
export function matchupProfile(team) {
  const p={melee:0,ranged:0,first:0,dive:0,guard:0,counter:0,zone:0,helpers:0,cc:0,mobility:0};
  for (const member of team) {
    const tags=new Set(member.tags??[]), style=combatStyle(member), metric=characterMetric(member);
    p.melee+=Number(melee(member)); p.ranged+=Number(ranged(member));
    p.first+=Number(melee(member)&&(style==='firstEngage'||style==='guardSometimesEngage'));
    p.dive+=Number(style==='firstEngage'||style==='delayedEngage'||tags.has('dive'));
    p.guard+=Number(style==='guardOnly'||tags.has('peel')||tags.has('shield'));
    p.counter+=Number(style==='counterOnlyRanged'||style==='guardOnly');
    p.zone+=Number(tags.has('zone'));
    p.helpers+=Number(style==='rangedEngageHelper');
    p.cc+=metric.crowdControl; p.mobility+=metric.mobility;
  }
  return p;
}

const validTeam = team => Array.isArray(team) && team.length === 3 && team.every(Boolean)
  && new Set(team.map(c => c.characterId ?? c.id)).size === 3;
const tagsOf = c => new Set(c.tags ?? []);
// Weapon category is not combat range: Adela uses a rapier/bat but casts from
// the backline; Silvia's pistol does not make her a protected ranged carry.
// Support-only teams also must not acquire a two-carry counter-engage advantage.
const ranged = c => ['ranged', 'mage'].includes(c.role);
const melee = c => ['frontline', 'bruiser', 'assassin'].includes(c.role);
const diving = c => ['firstEngage', 'delayedEngage'].includes(combatStyle(c)) || tagsOf(c).has('dive');
const guarding = c => combatStyle(c) === 'guardOnly' || tagsOf(c).has('peel') || tagsOf(c).has('shield');
const zoneControl = c => tagsOf(c).has('zone') || tagsOf(c).has('poke');
const idOf = c => c.variantId ?? c.characterId ?? c.id;
const mean = xs => xs.reduce((s, n) => s + n, 0) / Math.max(1, xs.length);
const mobility = c => characterMetric(c).mobility;
const vulnerability = c => 10 - mobility(c) - characterMetric(c).defense;
const control = c => characterMetric(c).crowdControl + characterMetric(c).utility;
const reach = c => mobility(c) + characterMetric(c).crowdControl / 2 + Number(tagsOf(c).has('burst'));

function pressure(attacker, target) {
  const attack = characterMetric(attacker), defense = characterMetric(target), tags = tagsOf(attacker);
  // A mobile diver and an immobile zoner do not threaten the same builds equally.
  // Compare every actual member pairing; aggregate counts alone cannot do this.
  return Math.max(0, attack.mobility - defense.mobility + 1) * 0.6
    + attack.crowdControl / (1 + defense.defense / 3)
    + Number(tags.has('burst')) * (6 - defense.defense) / 5
    + Number(tags.has('sustained') || tags.has('zone')) * (6 - defense.mobility) / 5
    + Math.max(0, (attacker.roleProfile?.range ?? 1) - (target.roleProfile?.range ?? 1)) / (1 + defense.mobility);
}

function comparison(kind, reason, priority, own, enemy, ownScore, enemyScore, ownTeam, enemyTeam) {
  const rank = (members, score) => [...members].sort((a, b) => score(b) - score(a) || idOf(a).localeCompare(idOf(b)));
  const enemyAttacks = kind === 'caution';
  const ownImpact = c => ownScore(c) + mean(enemy.map(e => enemyAttacks ? pressure(e, c) : pressure(c, e)));
  const enemyImpact = c => enemyScore(c) + mean(own.map(a => enemyAttacks ? pressure(c, a) : pressure(a, c)));
  const actors = rank(own, ownImpact).slice(0, 2), threats = rank(enemy, enemyImpact).slice(0, 2);
  // Protection has to serve these particular carries. Considering only the guard
  // would still choose the same opponents whenever that one guard stayed fixed.
  const direction = (attackers, targets) => mean(attackers.map(c => mean(targets.map(t => pressure(c, t)))));
  const balance = direction(ownTeam, enemyTeam) - direction(enemyTeam, ownTeam);
  return { kind, reason, priority,
    relevance: Number((mean(actors.map(ownImpact)) + mean(threats.map(enemyImpact)) + (enemyAttacks ? -balance : balance) * 2).toFixed(6)),
    ownActors: actors.map(idOf), enemyActors: threats.map(idOf) };
}

export function compareMatchup(ownTeam, enemyTeam) {
  if (!validTeam(ownTeam) || !validTeam(enemyTeam)) return null;
  const signature = team => team.map(c => `${idOf(c)}:${c.effectiveCore?.core ?? ''}`).sort().join('|');
  if (signature(ownTeam) === signature(enemyTeam)) return null;
  const a = matchupProfile(ownTeam), b = matchupProfile(enemyTeam), risks = [], chances = [];
  const add = (rows, kind, reason, priority, own, enemy, ownScore, enemyScore) =>
    rows.push(comparison(kind, reason, priority, own, enemy, ownScore, enemyScore, ownTeam, enemyTeam));
  if (b.dive >= 2 && a.ranged >= 2 && a.guard === 0)
    add(risks, 'caution', 'exposedBackline', 3, ownTeam.filter(ranged), enemyTeam.filter(diving), vulnerability, c => reach(c) - mean(ownTeam.filter(ranged).map(mobility)));
  if (a.melee >= 2 && a.first >= 1 && b.guard >= 1 && b.counter >= 1)
    add(risks, 'caution', 'deniedEngage', 2, ownTeam.filter(melee), enemyTeam.filter(guarding), c => 5 - mobility(c), control);
  if (a.melee >= 2 && b.ranged >= 2 && b.zone >= 1 && a.helpers === 0)
    add(risks, 'caution', 'approachUnderFire', 2, ownTeam.filter(melee), enemyTeam.filter(ranged), c => 5 - mobility(c), c => control(c) + Number(zoneControl(c)) * 2);
  if (a.guard >= 1 && a.ranged >= 2 && a.cc >= 7 && b.melee >= 2)
    add(chances, 'opportunity', 'protectAndCounter', 3, ownTeam.filter(guarding), enemyTeam.filter(melee), control, c => 5 - mobility(c));
  if (a.first >= 2 && b.ranged >= 2 && b.guard === 0 && b.mobility <= a.mobility)
    add(chances, 'opportunity', 'catchBackline', 2, ownTeam.filter(diving), enemyTeam.filter(ranged), reach, vulnerability);
  if (a.ranged >= 2 && a.zone >= 1 && b.melee >= 2 && b.first <= 1 && b.mobility < a.mobility + 2)
    add(chances, 'opportunity', 'holdRange', 2, ownTeam.filter(ranged), enemyTeam.filter(melee), c => control(c) + Number(zoneControl(c)) * 2, c => 5 - mobility(c));
  const sort = (x, y) => y.priority - x.priority || y.relevance - x.relevance || x.reason.localeCompare(y.reason);
  return risks.sort(sort)[0] ?? chances.sort(sort)[0] ?? null;
}

const buildKey = members => members.map(m => `${m.variantId}:${m.core ?? ''}`).sort().join('|');
const characterSet = example => new Set(example.members.map(m => m.variantId.split(':')[0]));
function diverseExamples(examples, limit) {
  const remaining = [...examples].sort((a, b) => b.relevance - a.relevance || b.appearances - a.appearances || a.key.localeCompare(b.key));
  const selected = [];
  while (remaining.length && selected.length < limit) {
    let best = -1, bestUtility = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const ids = characterSet(remaining[i]);
      const overlap = Math.max(0, ...selected.map(e => [...characterSet(e)].filter(id => ids.has(id)).length));
      if (selected.length && overlap === 3) continue;
      const utility = remaining[i].relevance - overlap * 0.75;
      if (utility > bestUtility) { best = i; bestUtility = utility; }
    }
    // A core-only variation is not another opponent example.
    if (best < 0) break;
    selected.push(remaining.splice(best, 1)[0]);
  }
  return selected;
}

// Each context owns a deck of distinct observed lineups. Renderers cache the
// returned page, advancing only on a deliberate refresh or a reopened panel.
export function createMatchupRotation(random = Math.random, maxContexts = 100) {
  const decks = new Map();
  return (context, examples, limit = 3) => {
    let state = decks.get(context);
    if (!state) {
      const deck = diverseExamples(examples, examples.length);
      state = { deck, cursor: Math.floor(random() * deck.length) || 0 };
      decks.set(context, state);
      if (decks.size > maxContexts) decks.delete(decks.keys().next().value);
    }
    const count = Math.min(limit, state.deck.length);
    const page = Array.from({ length: count }, (_, i) => state.deck[(state.cursor + i) % state.deck.length]);
    state.cursor = (state.cursor + count) % Math.max(1, state.deck.length);
    return page;
  };
}

export function matchupGuidance(ownTeam,references,resolveEnemy,selectExamples = (_, examples) => diverseExamples(examples,3)) {
  if (!validTeam(ownTeam)) return [];
  const groups=new Map(), seen=new Set();
  for (const reference of references) {
    if (!Array.isArray(reference.members) || reference.members.length !== 3
      || reference.members.some(m => typeof m?.variantId !== 'string')) continue;
    const enemyTeam=resolveEnemy(reference);
    if (!validTeam(enemyTeam)) continue;
    const build=buildKey(reference.members);
    if (seen.has(build)) continue;
    seen.add(build);
    const result=compareMatchup(ownTeam,enemyTeam);
    if (!result) continue;
    const key=result.kind+':'+result.reason;
    const row=groups.get(key)??{kind:result.kind,reason:result.reason,priority:result.priority,relevance:result.relevance,appearances:0,examples:[]};
    const count=Number(reference.appearances);
    const appearances=Number.isFinite(count)?Math.max(0,count):0;
    row.appearances+=appearances;
    row.relevance=Math.max(row.relevance,result.relevance);
    row.examples.push({...result,key:build,members:reference.members,appearances});
    groups.set(key,row);
  }
  return ['caution','opportunity'].flatMap(kind=>[...groups.values()].filter(row=>row.kind===kind)
    .sort((a,b)=>b.priority-a.priority||b.relevance-a.relevance||b.appearances-a.appearances).slice(0,2)
    .map(row=>({...row,examples:selectExamples(`${row.kind}:${row.reason}`,row.examples)})));
}
