// First COMPLETE ranked calendar day after the announced ranked restriction.
// 12.5 (2026-10-01): Seres could not be selected in ranked through October 6.
// Official publisher mirror: https://game.naver.com/lounge/Eternal_Return/board/detail/8265647
// Original: https://playeternalreturn.com/posts/news/3867
export const RANKED_AVAILABILITY = {
  seres: { firstFullRankedDay: '2026-10-07T00:00:00+09:00' },
};

export function hasFullRankedBaseline(characterId, previousStart, availability = RANKED_AVAILABILITY) {
  const from = availability[characterId]?.firstFullRankedDay;
  return !from || (Number.isFinite(Date.parse(previousStart)) && Date.parse(from)<=Date.parse(previousStart));
}
