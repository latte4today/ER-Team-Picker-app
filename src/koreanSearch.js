const INITIALS = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const INITIAL_UNIT = 588;

export function initialsOf(text) {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < HANGUL_START || code > HANGUL_END) return char.toLowerCase();
      return INITIALS[Math.floor((code - HANGUL_START) / INITIAL_UNIT)];
    })
    .join("");
}

export function matchesKoreanSearch(text, query) {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return normalizedText.includes(normalizedQuery) || initialsOf(text).includes(normalizedQuery);
}
