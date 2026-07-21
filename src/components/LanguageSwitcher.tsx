import { useTranslation } from "react-i18next";
import { localeForLanguage, supportedLanguages } from "@/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { user, isAnonymous } = useAuth();
  const active = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  const selectLanguage = async (locale: string) => {
    await i18n.changeLanguage(locale);
    if (user && !isAnonymous) {
      await supabase.from("profiles").update({ locale, updated_at: new Date().toISOString() }).eq("id", user.id);
    }
  };

  return (
    <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label={t("language.label")}>
      {supportedLanguages.map((language) => (
        <button
          key={language.code}
          type="button"
          onClick={() => void selectLanguage(language.code)}
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
