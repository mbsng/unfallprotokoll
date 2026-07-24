import { useState } from "react";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { KeyRound, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { supabase } from "@/integrations/supabase/client";
import { localeForLanguage } from "@/i18n";

export default function AuthPage() {
  const { t, i18n } = useTranslation();
  const [method, setMethod] = useState<"password" | "magic">("password");
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const requestedRedirect = new URLSearchParams(window.location.search).get("redirect");
  const safeRedirect = requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//") ? requestedRedirect : "/";
  const appUrl = import.meta.env.DEV ? "https://unfallprotokoll.vercel.app" : window.location.origin;
  const redirectTo = `${appUrl}/auth?redirect=${encodeURIComponent(safeRedirect)}`;
  const localization = {
    sign_up: { email_label: t("auth.email"), password_label: t("auth.password"), email_input_placeholder: t("auth.emailPlaceholder"), password_input_placeholder: t("auth.passwordPlaceholder"), button_label: t("auth.signUp"), loading_button_label: t("auth.signingUp"), link_text: t("auth.noAccount"), confirmation_text: t("auth.confirmation") },
    sign_in: { email_label: t("auth.email"), password_label: t("auth.password"), email_input_placeholder: t("auth.emailPlaceholder"), password_input_placeholder: t("auth.passwordPlaceholder"), button_label: t("auth.signIn"), loading_button_label: t("auth.signingIn"), link_text: t("auth.hasAccount") },
    magic_link: { email_input_label: t("auth.email"), email_input_placeholder: t("auth.emailPlaceholder"), button_label: t("auth.magicSend"), loading_button_label: t("auth.magicSending"), link_text: t("auth.magicChoice"), confirmation_text: t("auth.magicConfirmation"), empty_email_address: t("auth.email") },
    forgotten_password: { email_label: t("auth.email"), email_input_placeholder: t("auth.emailPlaceholder"), button_label: t("auth.resetSend"), loading_button_label: t("auth.resetSending"), link_text: t("auth.forgot"), confirmation_text: t("auth.resetConfirmation") },
    update_password: { password_label: t("auth.newPassword"), password_input_placeholder: t("auth.passwordPlaceholder"), button_label: t("auth.updatePassword"), loading_button_label: t("auth.updatingPassword"), confirmation_text: t("auth.passwordUpdated") },
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] px-5 py-6 text-slate-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between"><Link to="/" className="flex items-center gap-3"><img src="/assets/upsala-logo.png" alt={t("app.name")} className="h-11 w-11 rounded-xl object-cover" /><span className="font-bold text-[#153B66]">{t("app.name")}</span></Link><LanguageSwitcher /></div>
      <main className="mx-auto mt-10 max-w-md md:mt-16">
        <div className="mb-7 text-center"><span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E7F0F6] text-[#153B66]"><KeyRound className="h-7 w-7" /></span><h1 className="text-3xl font-bold tracking-tight text-[#102F52]">{t("auth.title")}</h1><p className="mt-3 leading-relaxed text-slate-600">{t("auth.subtitle")}</p></div>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/50 md:p-7">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setMethod("password")} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold ${method === "password" ? "bg-white text-[#153B66] shadow-sm" : "text-slate-500"}`}><KeyRound className="h-4 w-4" />{t("auth.passwordTab")}</button><button type="button" onClick={() => setMethod("magic")} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold ${method === "magic" ? "bg-white text-[#153B66] shadow-sm" : "text-slate-500"}`}><Mail className="h-4 w-4" />{t("auth.magicTab")}</button></div>
          <SupabaseAuth
            key={`${method}-${locale}`}
            supabaseClient={supabase}
            providers={[]}
            view="sign_in"
            magicLink={method === "magic"}
            showLinks={method === "password"}
            redirectTo={redirectTo}
            additionalData={{ locale }}
            localization={{ variables: localization }}
            appearance={{ theme: ThemeSupa, variables: { default: { colors: { brand: "#153B66", brandAccent: "#102F52", inputBorderFocus: "#39719D" }, radii: { borderRadiusButton: "12px", buttonBorderRadius: "12px", inputBorderRadius: "12px" }, space: { inputPadding: "12px 14px", buttonPadding: "13px 16px" } } }, className: { button: "min-h-12 font-semibold", input: "min-h-12 text-base", anchor: "font-semibold text-[#285B82]" } }}
            theme="light"
          />
        </section>
      </main>
    </div>
  );
}
