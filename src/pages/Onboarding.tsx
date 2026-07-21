import { useEffect, useState } from "react";
import { Car, Check, ShieldCheck, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localeForLanguage } from "@/i18n";

const inputClass = "h-12 rounded-xl border-slate-200 text-base focus-visible:ring-[#153B66]";

export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", licenseNo: "", plate: "", makeModel: "", insurer: "", policy: "" });

  useEffect(() => {
    if (!profile) return;
    setForm({
      fullName: profile.full_name ?? "",
      phone: profile.phone ?? "",
      licenseNo: profile.license_no ?? "",
      plate: profile.default_vehicle_json?.plate ?? "",
      makeModel: profile.default_vehicle_json?.makeModel ?? "",
      insurer: profile.insurance_json?.company ?? "",
      policy: profile.insurance_json?.policyNumber ?? "",
    });
  }, [profile]);

  const update = (key: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.fullName.trim()) return toast.error(t("onboarding.required"));
    if (!user) return;
    setSaving(true);
    const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
    const { error } = await supabase.from("profiles").update({
      full_name: form.fullName.trim(),
      phone: form.phone.trim() || null,
      license_no: form.licenseNo.trim() || null,
      default_vehicle_json: { plate: form.plate.trim().toUpperCase(), makeModel: form.makeModel.trim() },
      insurance_json: { company: form.insurer.trim(), policyNumber: form.policy.trim() },
      locale,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    }).eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(t("onboarding.error"));
    await refreshProfile();
    toast.success(t("onboarding.success"));
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] px-5 py-6 text-slate-900">
      <header className="mx-auto flex max-w-3xl items-center justify-between"><div className="flex items-center gap-3"><img src="/assets/unfallklar-logo.png" alt={t("app.name")} className="h-11 w-11 rounded-xl object-cover" /><span className="font-bold text-[#153B66]">{t("app.name")}</span></div><LanguageSwitcher /></header>
      <main className="mx-auto max-w-2xl py-10 md:py-14">
        <div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-[#39719D]">{t("onboarding.eyebrow")}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#102F52]">{t("onboarding.title")}</h1><p className="mt-3 max-w-xl leading-relaxed text-slate-600">{t("onboarding.subtitle")}</p></div>
        <form onSubmit={save} className="space-y-5">
          <FormSection icon={<UserRound />} title={t("onboarding.profile")}><div className="grid gap-5 sm:grid-cols-2"><Field label={t("onboarding.fullName")}><Input value={form.fullName} onChange={(event) => update("fullName", event.target.value)} placeholder={t("onboarding.fullNamePlaceholder")} autoComplete="name" className={inputClass} /></Field><Field label={t("onboarding.phone")}><Input value={form.phone} onChange={(event) => update("phone", event.target.value)} type="tel" autoComplete="tel" className={inputClass} /></Field><Field label={t("onboarding.license")}><Input value={form.licenseNo} onChange={(event) => update("licenseNo", event.target.value)} placeholder={t("onboarding.licensePlaceholder")} className={inputClass} /></Field></div></FormSection>
          <FormSection icon={<Car />} title={t("onboarding.vehicle")}><div className="grid gap-5 sm:grid-cols-2"><Field label={t("onboarding.plate")}><Input value={form.plate} onChange={(event) => update("plate", event.target.value.toUpperCase())} placeholder={t("onboarding.platePlaceholder")} className={`${inputClass} uppercase`} /></Field><Field label={t("onboarding.makeModel")}><Input value={form.makeModel} onChange={(event) => update("makeModel", event.target.value)} placeholder={t("onboarding.makeModelPlaceholder")} className={inputClass} /></Field></div></FormSection>
          <FormSection icon={<ShieldCheck />} title={t("onboarding.insurance")}><div className="grid gap-5 sm:grid-cols-2"><Field label={t("onboarding.company")}><Input value={form.insurer} onChange={(event) => update("insurer", event.target.value)} placeholder={t("onboarding.companyPlaceholder")} className={inputClass} /></Field><Field label={t("onboarding.policy")}><Input value={form.policy} onChange={(event) => update("policy", event.target.value)} placeholder={t("onboarding.policyPlaceholder")} className={inputClass} /></Field></div></FormSection>
          <Button type="submit" disabled={saving} className="h-14 w-full rounded-2xl bg-[#153B66] text-base font-semibold hover:bg-[#102F52]"><Check className="mr-2 h-5 w-5" />{t(saving ? "onboarding.saving" : "onboarding.save")}</Button>
        </form>
      </main>
    </div>
  );
}

function FormSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7"><div className="mb-5 flex items-center gap-3 text-[#153B66]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E7F0F6] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><h2 className="text-lg font-bold">{title}</h2></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-2 block text-sm font-semibold text-slate-700">{label}</Label>{children}</div>;
}
