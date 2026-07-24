import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import de from "@/locales/de/common.json";
import fr from "@/locales/fr/common.json";
import it from "@/locales/it/common.json";
import en from "@/locales/en/common.json";

export const supportedLanguages = [
  { short: "DE", code: "de-CH" },
  { short: "FR", code: "fr-CH" },
  { short: "IT", code: "it-CH" },
  { short: "EN", code: "en" },
] as const;

export const localeForLanguage = (language: string) => {
  if (language.toLowerCase().startsWith("de")) return "de-CH";
  if (language.toLowerCase().startsWith("fr")) return "fr-CH";
  if (language.toLowerCase().startsWith("it")) return "it-CH";
  return "en";
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { common: de },
      "de-CH": { common: de },
      fr: { common: fr },
      "fr-CH": { common: fr },
      it: { common: it },
      "it-CH": { common: it },
      en: { common: en },
    },
    fallbackLng: "en",
    supportedLngs: ["de", "de-CH", "fr", "fr-CH", "it", "it-CH", "en"],
    nonExplicitSupportedLngs: true,
    defaultNS: "common",
    ns: ["common"],

    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "upsala-language",
      caches: ["localStorage"],
    },
  });

export default i18n;
