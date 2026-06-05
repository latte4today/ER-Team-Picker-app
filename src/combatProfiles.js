const byCharacter = {
  yan: "firstEngage",
  piolo: "firstEngage",
  cathy: "firstEngage",
  luke: "firstEngage",
  elena: "firstEngage",
  laura: "firstEngage",
  daniel: "firstEngage",
  mirka: "firstEngage",
  chiara: "firstEngage",
  martina: "firstEngage",
  hyunwoo: "firstEngage",
  echion: "firstEngage",
  aiden: "firstEngage",
  kenneth: "firstEngage",
  nicky: "firstEngage",
  isaac: "firstEngage",
  tazia: "firstEngage",

  debi_marlene: "delayedEngage",
  leon: "delayedEngage",
  felix: "delayedEngage",
  abigail: "delayedEngage",
  istvan: "delayedEngage",
  hisui: "delayedEngage",
  sua: "delayedEngage",
  shirin: "delayedEngage",
  silvia: "delayedEngage",
  ian: "delayedEngage",
  irem: "delayedEngage",

  jackie: "cannotStart",
  shoichi: "cannotStart",

  henry: "rangedEngageHelper",
  hyejin: "rangedEngageHelper",
  bianca: "rangedEngageHelper",
  theodore: "rangedEngageHelper",
  yumin: "rangedEngageHelper",
  arda: "rangedEngageHelper",
  adela: "rangedEngageHelper",
  tia: "rangedEngageHelper",
  nia: "rangedEngageHelper",
  bernice: "rangedEngageHelper",
  barbara: "rangedEngageHelper",
  nathapon: "rangedEngageHelper",

  william: "diveFollowRanged",
  rozzi: "diveFollowRanged",
  chloe: "diveFollowRanged",
  karla: "diveFollowRanged",
  hart: "diveFollowRanged",
  jenny: "diveFollowRanged",
  tsubame: "diveFollowRanged",
  justina: "diveFollowRanged",

  zahir: "counterOnlyRanged",
  sissela: "counterOnlyRanged",
  adriana: "counterOnlyRanged",
  rio: "counterOnlyRanged",
  celine: "counterOnlyRanged",
  katja: "counterOnlyRanged",
  lenore: "counterOnlyRanged",
  adina: "counterOnlyRanged",
  eva: "counterOnlyRanged",

  haze: "pokeThenEngage",

  sho: "guardSometimesEngage",
  eleven: "guardSometimesEngage",
  alex: "guardSometimesEngage",
  mai: "guardSometimesEngage",
  markus: "guardSometimesEngage",
  estelle: "guardSometimesEngage",
  alonso: "guardSometimesEngage",
  darko: "guardSometimesEngage",
  garnet: "guardSometimesEngage",

  lenox: "guardOnly",
};

const byVariant = {
  "li_dailin:glove": "firstEngage",
  "li_dailin:nunchaku": "cannotStart",
  "magnus:hammer": "firstEngage",
  "magnus:bat": "delayedEngage",
  "yuki:two_handed_sword": "firstEngage",
  "yuki:dual_swords": "delayedEngage",
  "fiora:two_handed_sword": "firstEngage",
  "fiora:rapier": "firstEngage",
  "fiora:spear": "delayedEngage",
  "camilo:rapier": "delayedEngage",
  "camilo:dual_swords": "cannotStart",
  "isol:pistol": "rangedEngageHelper",
  "nadine:crossbow": "diveFollowRanged",
  "aya:pistol": "diveFollowRanged",
  "aya:sniper_rifle": "counterOnlyRanged",
  "aya:assault_rifle": "pokeThenEngage",
  "isol:assault_rifle": "pokeThenEngage",
  "nadine:bow": "pokeThenEngage",
};

export function combatStyle(character) {
  if (!character) return "neutral";
  return byVariant[character.variantId] ?? byCharacter[character.characterId] ?? "neutral";
}

export function isFirstEngageStyle(character) {
  const style = combatStyle(character);
  return style === "firstEngage" || style === "guardSometimesEngage";
}

export function isDelayedEngageStyle(character) {
  return combatStyle(character) === "delayedEngage";
}

export function cannotStartEngage(character) {
  return combatStyle(character) === "cannotStart";
}

export function helpsMeleeEngage(character) {
  return combatStyle(character) === "rangedEngageHelper";
}

export function likesDiveFollow(character) {
  return combatStyle(character) === "diveFollowRanged";
}

export function isCounterOnlyRanged(character) {
  return combatStyle(character) === "counterOnlyRanged";
}

export function isPokeThenEngage(character) {
  return combatStyle(character) === "pokeThenEngage";
}

export function isGuardOnly(character) {
  return combatStyle(character) === "guardOnly";
}

export function isGuardSometimesEngage(character) {
  return combatStyle(character) === "guardSometimesEngage";
}
