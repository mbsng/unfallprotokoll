import { useTranslation } from "react-i18next";
import { localeForLanguage, supportedLanguages } from "@/i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const active = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label={t("language.label")}>
      {supportedLanguages.map((language) => (
        <button
          key={language.code}
          type="button"
          onClick={() => i18n.changeLanguage(language.code)}
          aria-label={t(`language.${language.short.toLowerCase()}`)}
          aria-pressed={active === language.code}
          className={`min-h-9 min-w-9 rounded-lg px-2 text-xs font-bold transition-colors ${active === language.code ? "bg-[#153B66] text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-[#153B66]"}`}
        >
          {language.short}
        </button>
      ))}
    </div>
  );
}
