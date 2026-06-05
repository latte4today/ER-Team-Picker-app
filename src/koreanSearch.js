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

const COMPOUND_JAMO = {
  ㄳ: "ㄱㅅ",
  ㄵ: "ㄴㅈ",
  ㄶ: "ㄴㅎ",
  ㄺ: "ㄹㄱ",
  ㄻ: "ㄹㅁ",
  ㄼ: "ㄹㅂ",
  ㄽ: "ㄹㅅ",
  ㄾ: "ㄹㅌ",
  ㄿ: "ㄹㅍ",
  ㅀ: "ㄹㅎ",
  ㅄ: "ㅂㅅ",
};

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const INITIAL_UNIT = 588;

function normalizeSearchInput(text) {
  return [...text]
    .map((char) => COMPOUND_JAMO[char] ?? char)
    .join("")
    .toLowerCase();
}

export function initialsOf(text) {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < HANGUL_START || code > HANGUL_END) return COMPOUND_JAMO[char] ?? char.toLowerCase();
      return INITIALS[Math.floor((code - HANGUL_START) / INITIAL_UNIT)];
    })
    .join("");
}

export function matchesKoreanSearch(text, query) {
  const normalizedText = normalizeSearchInput(text);
  const normalizedQuery = normalizeSearchInput(query.trim());
  if (!normalizedQuery) return true;
  return normalizedText.includes(normalizedQuery) || initialsOf(text).includes(normalizedQuery);
}
