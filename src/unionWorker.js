import { characterVariants } from "./data.js";
import { evaluateCandidate } from "./recommender.js";

const variantMap = new Map(characterVariants.map((character) => [character.variantId, character]));
const comboScoreCache = new Map();
let activeContextKey = "";

function cachedComboScore(combo, context) {
  const key = `${context.contextKey}:${combo.map((character) => character.variantId).sort().join("|")}`;
  if (comboScoreCache.has(key)) return comboScoreCache.get(key);

  const [first, second, third] = combo;
  const evaluations = [
    evaluateCandidate(
      [second.variantId, third.variantId],
      first.variantId,
      context.tier,
      context.remoteFeedback,
      context.popularFeedback,
      context.localFeedback,
    ),
    evaluateCandidate(
      [first.variantId, third.variantId],
      second.variantId,
      context.tier,
      context.remoteFeedback,
      context.popularFeedback,
      context.localFeedback,
    ),
    evaluateCandidate(
      [first.variantId, second.variantId],
      third.variantId,
      context.tier,
      context.remoteFeedback,
      context.popularFeedback,
      context.localFeedback,
    ),
  ].filter(Boolean);

  const average = evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / evaluations.length;
  const result = {
    score: Number(average.toFixed(1)),
    reasons: evaluations
      .flatMap((evaluation) => evaluation.reasons)
      .filter((reason, index, reasons) => reasons.indexOf(reason) === index)
      .slice(0, 2),
  };

  comboScoreCache.set(key, result);
  return result;
}

function buildUnionCombos({ rosters, maxChecks = 16000, limit = 24, context }) {
  if (activeContextKey !== context.contextKey) {
    comboScoreCache.clear();
    activeContextKey = context.contextKey;
  }

  const [firstRoster, secondRoster, thirdRoster] = rosters.map((roster) =>
    roster.map((variantId) => variantMap.get(variantId)).filter(Boolean),
  );
  const combos = [];
  let checked = 0;

  for (const first of firstRoster) {
    for (const second of secondRoster) {
      if (first.characterId === second.characterId) continue;
      for (const third of thirdRoster) {
        checked += 1;
        if (checked > maxChecks) break;
        if (third.characterId === first.characterId || third.characterId === second.characterId) continue;

        const scoreInfo = cachedComboScore([first, second, third], context);
        combos.push({
          comboIds: [first.variantId, second.variantId, third.variantId],
          ...scoreInfo,
        });
      }
      if (checked > maxChecks) break;
    }
    if (checked > maxChecks) break;
  }

  return {
    checked,
    truncated: checked > maxChecks,
    combos: combos.sort((a, b) => b.score - a.score).slice(0, limit),
  };
}

if (typeof self !== "undefined") {
  self.onmessage = (event) => {
    const { requestId, rosters, tier, remoteFeedback, popularFeedback, localFeedback, contextKey } = event.data;
    try {
      const result = buildUnionCombos({
        rosters,
        context: {
          tier,
          remoteFeedback: remoteFeedback ?? {},
          popularFeedback: popularFeedback ?? [],
          localFeedback: localFeedback ?? {},
          contextKey,
        },
      });
      self.postMessage({ requestId, ...result });
    } catch (error) {
      self.postMessage({
        requestId,
        error: error?.message ?? "union worker failed",
      });
    }
  };
}
