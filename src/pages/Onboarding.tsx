import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ProfileFields } from "@/components/ProfileFields";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { localeForLanguage } from "@/i18n";
import { emptyProfileMasterData, profileToMasterData, saveProfileMasterData, type ProfileMasterData } from "@/lib/profile-data";
import type { Profile } from "@/types/profile";

export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileMasterData>(() => emptyProfileMasterData(localeForLanguage(i18n.resolvedLanguage || i18n.language) as Profile["locale"]));

  useEffect(() => {
    if (profile) setForm(profileToMasterData(profile));
  }, [profile]);

  const update = <K extends keyof ProfileMasterData>(key: K, value: ProfileMasterData[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.fullName.trim()) return toast.error(t("onboarding.required"));
    if (!user) return;
    setSaving(true);
    try {
      const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language) as Profile["locale"];
      await saveProfileMasterData(user.id, { ...form, locale }, true);
      await refreshProfile();
      toast.success(t("onboarding.success"));
      navigate("/", { replace: true });
    } catch (error) {
      console.error("[onboarding] Save failed", { error: error instanceof Error ? error.message : String(error) });
      toast.error(t("onboarding.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] px-5 py-6 text-slate-900">
      <header className="mx-auto flex max-w-4xl items-center justify-between"><div className="flex items-center gap-3"><img src="/assets/upsala-logo.png" alt={t("app.name")} className="h-11 w-11 rounded-xl object-cover" /><span className="font-bold text-[#153B66]">{t("app.name")}</span></div><LanguageSwitcher /></header>
      <main className="mx-auto max-w-4xl py-10 md:py-14">
        <div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-[#39719D]">{t("onboarding.eyebrow")}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#102F52]">{t("onboarding.title")}</h1><p className="mt-3 max-w-xl leading-relaxed text-slate-600">{t("onboarding.subtitle")}</p></div>
        <form onSubmit={save} className="space-y-5">
          <ProfileFields data={form} onChange={update} />
          <Button type="submit" disabled={saving} className="h-14 w-full rounded-2xl bg-[#153B66] text-base font-semibold hover:bg-[#102F52]"><Check className="mr-2 h-5 w-5" />{t(saving ? "onboarding.saving" : "onboarding.save")}</Button>
        </form>
      </main>
    </div>
  );
}
