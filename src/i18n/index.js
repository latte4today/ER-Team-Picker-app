import { en } from "./en.js";
import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { zhHans } from "./zhHans.js";
import { zhHant } from "./zhHant.js";

export const languageStorageKey = "er-tp-lang";

const dictionaries = {
  ko,
  en,
  ja,
  zhHans,
  zhHant,
};

export function getLanguage() {
  return localStorage.getItem(languageStorageKey) || "ko";
}

export function hasStoredLanguage() {
  return Boolean(localStorage.getItem(languageStorageKey));
}

export function setLanguage(language) {
  const nextLanguage = dictionaries[language] ? language : "ko";
  localStorage.setItem(languageStorageKey, nextLanguage);
  document.documentElement.lang = nextLanguage;
  return nextLanguage;
}

export function t(key, params = {}) {
  const language = getLanguage();
  const template = dictionaries[language]?.[key] ?? ko[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, paramKey) => params[paramKey] ?? "");
}

export function applyTranslations(root = document) {
  document.documentElement.lang = getLanguage();
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll("[data-i18n-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nLabel));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", t(element.dataset.i18nTitle));
  });
}
