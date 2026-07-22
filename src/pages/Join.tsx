import { useEffect, useState } from "react";
import { ArrowLeft, Link2, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { IncidentJoinError, joinIncident, previewIncident } from "@/lib/incidents";
import type { IncidentPreview } from "@/types/incident";

export default function Join() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const { user } = useAuth();
  const normalizedCode = code.trim().toUpperCase();
  const [incident, setIncident] = useState<IncidentPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [consented, setConsented] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const verifiedUser = Boolean(user && !user.is_anonymous && user.email_confirmed_at);

  useEffect(() => {
    let active = true;
    setIncident(null);
    setNotFound(false);
    if (!verifiedUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    previewIncident(normalizedCode)
      .then((result) => { if (active) setIncident(result); })
      .catch(() => { if (active) setNotFound(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [normalizedCode, verifiedUser]);

  const join = async () => {
    if (!verifiedUser) return toast.error(t("join.errors.verified_account_required", { defaultValue: "A verified account is required." }));
    if (!consented) return toast.error(t("join.consentRequired"));
    setJoining(true);
    try {
      const joined = await joinIncident(normalizedCode);
      toast.success(t("join.success"));
      navigate("/", { replace: true, state: { joinedIncident: joined } });
    } catch (error) {
      const code = error instanceof IncidentJoinError ? error.code : "join_failed";
      toast.error(t(`join.errors.${code}`, { defaultValue: t("join.errors.join_failed") }));
    } finally {
      setJoining(false);
    }
  };

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
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#102F52]">{t("join.title", { code: normalizedCode })}</h1>

          {!verifiedUser && <div className="mt-6 space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-relaxed text-blue-950">
            <p>{t("join.errors.verified_account_required", { defaultValue: "Sign in with a verified email account before validating or accepting this invitation." })}</p>
            <Button asChild className="h-12 w-full rounded-xl bg-[#153B66]"><Link to={`/auth?redirect=${encodeURIComponent(`/join/${normalizedCode}`)}`}><LogIn className="mr-2 h-4 w-4" />{t("auth.signIn")}</Link></Button>
          </div>}
          {verifiedUser && loading && <div className="flex min-h-48 items-center justify-center text-[#39719D]"><Loader2 className="h-7 w-7 animate-spin" /></div>}
          {verifiedUser && !loading && notFound && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-relaxed text-rose-900">{t("join.notFound")}</div>}
          {verifiedUser && !loading && incident && <>
            <p className="mt-4 leading-relaxed text-slate-600">{t("join.description")}</p>
            <div className="my-6 rounded-2xl bg-[#F5F8FA] p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("join.codeLabel")}</p><p className="mt-1 font-mono text-2xl font-bold tracking-[0.18em] text-[#153B66]">{normalizedCode}</p>
            </div>
            <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4">
              <Checkbox checked={consented} onCheckedChange={(checked) => setConsented(checked === true)} className="mt-0.5 h-5 w-5 data-[state=checked]:border-[#153B66] data-[state=checked]:bg-[#153B66]" />
              <span className="text-sm leading-relaxed text-slate-700">{t("join.consent")}</span>
            </label>
            <Button onClick={() => void join()} disabled={joining || !consented} className="h-14 w-full rounded-2xl bg-[#153B66] text-base font-semibold"><ShieldCheck className="mr-2 h-5 w-5" />{t(joining ? "join.joining" : "join.continue")}</Button>
            <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">{t("join.privacyNote")}</p>
          </>}
        </section>
      </main>
    </div>
  );
}
