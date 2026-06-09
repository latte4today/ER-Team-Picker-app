import { wikiMetrics } from "./wikiMetrics.js";
import { t } from "./i18n/index.js";

function clamp(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function estimatedMetric(character) {
  const tags = new Set(character.tags ?? []);
  const cc = character.ccProfile ?? {};
  const ccPower =
    (cc.targeted ?? 0) * 1.15 +
    (cc.nonTarget ?? 0) * 0.8 +
    (cc.medium ?? 0) * 0.45 +
    (cc.wide ?? 0) * 0.6 +
    (cc.single ?? 0) * 0.25;

  const damage =
    character.damage === "basic"
      ? 4
      : character.damage === "skill"
        ? 4
        : 3;

  return {
    difficulty: clamp(character.difficulty ?? 3),
    damage: clamp(
      damage +
        (tags.has("burst") ? 0.45 : 0) +
        (tags.has("sustained") ? 0.35 : 0) +
        (tags.has("range") ? 0.2 : 0) -
        (character.role === "support" ? 1.2 : 0),
    ),
    defense: clamp(
      2 +
        (tags.has("durable") ? 1.3 : 0) +
        (tags.has("shield") ? 0.5 : 0) +
        (character.role === "frontline" ? 1.2 : 0) +
        (character.role === "bruiser" ? 0.4 : 0) -
        (character.role === "ranged" || character.role === "mage" ? 0.45 : 0),
    ),
    crowdControl: clamp(1 + ccPower),
    mobility: clamp(
      2 +
        (tags.has("mobility") ? 1.4 : 0) +
        (tags.has("dive") ? 0.8 : 0) +
        (tags.has("range") ? 0.2 : 0) -
        (tags.has("zone") ? 0.25 : 0),
    ),
    utility: clamp(
      1 +
        (tags.has("utility") ? 1.2 : 0) +
        (tags.has("peel") ? 1 : 0) +
        (tags.has("healing") ? 1.2 : 0) +
        (tags.has("shield") ? 0.8 : 0) +
        (tags.has("zone") ? 0.35 : 0),
    ),
  };
}

export function characterMetric(character) {
  return wikiMetrics[character.characterId ?? character.id] ?? estimatedMetric(character);
}

export function teamMetricProfile(team) {
  const metrics = team.map(characterMetric);
  const total = metrics.reduce(
    (state, metric) => {
      Object.keys(state).forEach((key) => {
        state[key] += metric[key] ?? 0;
      });
      return state;
    },
    { difficulty: 0, damage: 0, defense: 0, crowdControl: 0, mobility: 0, utility: 0 },
  );
  const count = Math.max(1, metrics.length);
  const average = Object.fromEntries(Object.entries(total).map(([key, value]) => [key, Number((value / count).toFixed(2))]));
  return { total, average };
}

export function teamMetricTags(team) {
  const { total, average } = teamMetricProfile(team);
  const tags = [];
  if (total.damage >= 11) tags.push(t("metric.tag.damageHigh"));
  if (total.damage <= 9) tags.push(t("metric.tag.damageLow"));
  if (total.defense >= 9) tags.push(t("metric.tag.defenseHigh"));
  if (total.defense <= 6) tags.push(t("metric.tag.defenseLow"));
  if (total.crowdControl >= 9) tags.push(t("metric.tag.ccHigh"));
  if (total.crowdControl <= 5) tags.push(t("metric.tag.ccLow"));
  if (average.mobility >= 3.6) tags.push(t("metric.tag.mobilityHigh"));
  if (average.mobility <= 2.2) tags.push(t("metric.tag.mobilityLow"));
  if (total.utility >= 8) tags.push(t("metric.tag.utilityHigh"));
  return tags;
}

export function metricCompositionReason(team) {
  const tags = teamMetricTags(team);
  if (tags.length === 0) return t("metric.reason.balanced");
  return t("metric.reason.tags", { tags: tags.slice(0, 3).join(" · ") });
}
