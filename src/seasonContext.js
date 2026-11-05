import {seasonState as bundled} from './seasonState.js';

let state = bundled;
export const currentSeason = () => state;
export const seasonVersion = () => `${state.seasonId}:${state.patch}:${state.generatedAt}`;
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
export function isCurrentRecent(source, cohort) {
  return isCurrentSeason(source) && source.seasonKey === state.seasonKey
    && source.phase === state.phase && cohort?.patch === state.patch
    && Math.floor(cohort.patch / 1000) === state.displaySeason
    // A seven-day window crossing a phase boundary is deliberately withheld.
    && Date.parse(cohort.updatedAt) - cohort.days * 86400000 >= Date.parse(state.phaseStartedAt);
}
export function canComparePreviousPatch(previous, cohort) {
  return previous && Math.floor(previous.patch / 1000) === state.displaySeason
    && Date.parse(cohort.updatedAt) - 2 * cohort.days * 86400000 >= Date.parse(state.phaseStartedAt);
}
