import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { localeForLanguage } from "@/i18n";
import i18n from "@/i18n";
import { clearLocalAccidentData } from "@/lib/local-db";
import { clearLocalProfileMasterData, loadLocalProfileMasterData, saveProfileMasterData } from "@/lib/profile-data";
import { pauseSyncWorker } from "@/lib/sync-worker";
import type { Organization, Profile } from "@/types/profile";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  loading: boolean;

  profileLoading: boolean;
  error: string | null;
  isAnonymous: boolean;
  startAnonymous: () => Promise<boolean>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const brandingHue = (hex: string) => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) return `0 0% ${Math.round(lightness * 100)}%`;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return `${Math.round(hue < 0 ? hue + 360 : hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async (user: User) => {
    if (user.is_anonymous) {
      setProfile(null);
      setOrganization(null);
      setProfileLoading(false);
      return;

    }
    setProfileLoading(true);
    const { data, error: selectError } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (selectError) {
      setError(selectError.message);
      setProfileLoading(false);
      return;
    }
    let nextProfile = data as Profile | null;
    if (!nextProfile) {
      const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language) as Profile["locale"];
      const { data: inserted, error: insertError } = await supabase.from("profiles").insert({ id: user.id, locale, role: "driver", org_id: null }).select("*").single();
      if (insertError) setError(insertError.message);
      else nextProfile = inserted as Profile;
    }

    const localMasterData = loadLocalProfileMasterData();
    if (nextProfile && localMasterData) {
      try {
        nextProfile = await saveProfileMasterData(user.id, localMasterData);
        clearLocalProfileMasterData();
      } catch (transferError) {
        setError(transferError instanceof Error ? transferError.message : "profile_transfer_failed");
      }
    }

    setProfile(nextProfile);
    if (nextProfile?.org_id) {
      const { data: org, error: orgError } = await supabase.from("organizations").select("id, name, branding_json").eq("id", nextProfile.org_id).maybeSingle();
      if (orgError) setError(orgError.message);
      setOrganization(org as Organization | null);
    } else {
      setOrganization(null);
    }
    if (nextProfile?.locale) await i18n.changeLanguage(nextProfile.locale);
    setProfileLoading(false);
  };

  useEffect(() => {
    const primaryColor = organization?.branding_json?.primary_color;
    const hsl = primaryColor ? brandingHue(primaryColor) : null;
    if (hsl && primaryColor) {
      document.documentElement.style.setProperty("--primary", hsl);
      document.documentElement.style.setProperty("--ring", hsl);
      document.documentElement.style.setProperty("--org-primary", primaryColor);
      document.documentElement.dataset.orgBranding = "true";
    } else {
      document.documentElement.style.removeProperty("--primary");
      document.documentElement.style.removeProperty("--ring");
      document.documentElement.style.removeProperty("--org-primary");
      delete document.documentElement.dataset.orgBranding;
    }
  }, [organization]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {

      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError(null);
      setLoading(false);
      if (!nextSession) {
        setProfile(null);
        setOrganization(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) void loadProfile(session.user);
    else setProfileLoading(false);
  }, [session?.user.id, session?.user.is_anonymous]);

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user);
  };

  const startAnonymous = async () => {
    if (session) return true;
    const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
    const { error: signInError } = await supabase.auth.signInAnonymously({ options: { data: { locale } } });
    if (signInError) {
      setError(signInError.message);
      return false;
    }
    return true;
  };

  const signOut = async () => {
    setError(null);
    const ownerId = session?.user.id;
    pauseSyncWorker();
    if (ownerId) await clearLocalAccidentData(ownerId);
    await supabase.auth.signOut();
    setProfile(null);
    setOrganization(null);
  };

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    organization,
    loading,

    profileLoading,
    error,
    isAnonymous: Boolean(session?.user?.is_anonymous),
    startAnonymous,
    refreshProfile,
    signOut,
    clearError: () => setError(null),
  }), [session, profile, organization, loading, profileLoading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;

}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
