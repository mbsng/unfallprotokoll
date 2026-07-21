import { ArrowLeft, Link2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Join() {
  const { t } = useTranslation();
  const { code = "" } = useParams();

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4">
          <Link to="/" className="flex h-11 w-11 items-center justify-center rounded-xl text-[#153B66]" aria-label={t("app.back")}><ArrowLeft className="h-6 w-6" /></Link>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 py-10 md:py-16">
        <div className="mb-8 flex items-center gap-3"><img src="/assets/unfallklar-logo.png" alt={t("app.name")} className="h-12 w-12 rounded-xl object-cover" /><div><p className="font-bold text-[#153B66]">{t("app.name")}</p><p className="text-xs text-slate-500">{t("app.statement")}</p></div></div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E7F0F6] text-[#153B66]"><Link2 className="h-6 w-6" /></span>
          <p className="text-sm font-bold uppercase tracking-wider text-[#39719D]">{t("join.eyebrow")}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#102F52]">{t("join.title", { code: code.toUpperCase() })}</h1>
          <p className="mt-4 leading-relaxed text-slate-600">{t("join.description")}</p>
          <div className="my-6 rounded-2xl bg-[#F5F8FA] p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("join.codeLabel")}</p><p className="mt-1 font-mono text-2xl font-bold tracking-[0.18em] text-[#153B66]">{code.toUpperCase()}</p></div>
          <Button onClick={() => toast.info(t("join.unavailable"))} className="h-14 w-full rounded-2xl bg-[#153B66] text-base font-semibold"><ShieldCheck className="mr-2 h-5 w-5" />{t("join.continue")}</Button>
          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">{t("join.differentLanguage")}</p>
        </section>
      </main>
    </div>
  );
}
