import { useEffect, useState } from "react";
import { ArrowLeft, Check, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ProfileFields } from "@/components/ProfileFields";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { localeForLanguage } from "@/i18n";
import { emptyProfileMasterData, profileToMasterData, saveProfileMasterData, type ProfileMasterData } from "@/lib/profile-data";
import type { Profile as ProfileType } from "@/types/profile";

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { user, profile, isAnonymous, refreshProfile } = useAuth();
  const [form, setForm] = useState<ProfileMasterData>(() => emptyProfileMasterData(localeForLanguage(i18n.resolvedLanguage || i18n.language) as ProfileType["locale"]));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setForm(profileToMasterData(profile));
  }, [profile]);

  if (!user || isAnonymous) return <Navigate to="/auth?redirect=%2Fprofil" replace />;

  const update = <K extends keyof ProfileMasterData>(key: K, value: ProfileMasterData[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language) as ProfileType["locale"];
      await saveProfileMasterData(user.id, { ...form, locale });
      await refreshProfile();
      toast.success(t("profile.saved"));
    } catch (error) {
      console.error("[profile] Save failed", { error: error instanceof Error ? error.message : String(error) });
      toast.error(t("profile.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-4">
          <Button asChild variant="ghost" size="icon" className="rounded-xl"><Link to="/" aria-label={t("app.back")}><ArrowLeft className="h-5 w-5" /></Link></Button>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="mb-8 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E7F0F6] text-[#153B66]"><UserRound className="h-6 w-6" /></span>
          <div><h1 className="text-3xl font-bold tracking-tight text-[#102F52]">{t("profile.title")}</h1><p className="mt-2 max-w-2xl leading-relaxed text-slate-600">{t("profile.description")}</p></div>
        </div>
        <form onSubmit={save} className="space-y-5">
          <ProfileFields data={form} onChange={update} />
          <Button type="submit" disabled={saving} className="h-14 w-full rounded-2xl bg-[#153B66] text-base font-semibold"><Check className="mr-2 h-5 w-5" />{t(saving ? "profile.saving" : "profile.save")}</Button>
        </form>
      </main>
    </div>
  );
}
