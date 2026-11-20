import {seasonState as bundled} from './seasonState.js';

let state = bundled;
const DAY = 86400000;
export const currentSeason = () => state;
export const seasonVersion = () => `${state.seasonId}:${state.patch}:${state.generatedAt}`;
export function isRankedOpeningWeek(now = Date.now()) {
  const elapsed = now - Date.parse(state.phaseStartedAt);
  return state.phase === 'ranked' && elapsed >= 0 && elapsed < 7 * DAY;
}
export function validSeasonState(value) {
  return value?.schemaVersion === 1 && Number.isInteger(value.seasonId) && value.seasonId > 0
    && /^(PRE_)?SEASON_\d+$/.test(value.seasonKey)
    && ['preseason','ranked'].includes(value.phase)
    && (value.phase === 'preseason') === value.seasonKey.startsWith('PRE_')
    && Number.isInteger(value.displaySeason) && value.displaySeason > 0
    && Number.isInteger(value.patch) && value.patch > 0
    && Number.isFinite(Date.parse(value.generatedAt))
    && Date.parse(value.generatedAt) <= Date.now() + 3600000
    && Number.isFinite(Date.parse(value.phaseStartedAt))
    && Date.parse(value.phaseStartedAt) <= Date.parse(value.generatedAt);
}
export function setSeasonState(value) {
  if (!validSeasonState(value) || value.seasonId < state.seasonId
      || Date.parse(value.generatedAt) <= Date.parse(state.generatedAt)
      || (value.seasonId === state.seasonId && value.patch < state.patch)) return false;
  state = structuredClone(value);
  return true;
}
// Official API IDs and the provider's season keys are separate namespaces.
export function isCurrentSeason(source) {
  return Number(source?.seasonId ?? source?.currentSeason ?? source?.season) === state.seasonId;
}
export function isRankedWindowInPhase(cohort, season = state) {
  return season.phase === 'ranked' && (cohort.matchingMode ?? 3) === 3
    && [3, 7].includes(cohort.days)
    && Date.parse(cohort.updatedAt) - cohort.days * DAY >= Date.parse(season.phaseStartedAt);
}
export function isCurrentRecent(source, cohort) {
  return isCurrentSeason(source) && source.seasonKey === state.seasonKey
    && source.phase === state.phase && cohort?.patch === state.patch
    && Math.floor(cohort.patch / 1000) === state.displaySeason
    // Never use a rolling Ranked window that crosses the phase boundary.
    && (state.phase === 'preseason'
      // Normal play and exact patch isolate 13.0 from the previous Ranked phase.
      ? cohort.matchingMode === 2 && Date.parse(cohort.updatedAt) >= Date.parse(state.phaseStartedAt)
      : isRankedWindowInPhase(cohort));
}
export function canComparePreviousPatch(previous, cohort) {
  return state.phase === 'ranked' && cohort.days === 7 && previous
    && Math.floor(previous.patch / 1000) === state.displaySeason
    && Date.parse(cohort.updatedAt) - 2 * cohort.days * DAY >= Date.parse(state.phaseStartedAt);
}
