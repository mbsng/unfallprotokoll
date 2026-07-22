import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { localeForLanguage } from "@/i18n";
import i18n from "@/i18n";
import { clearLocalAccidentData } from "@/lib/local-db";
import { pauseSyncWorker } from "@/lib/sync-worker";
import type { Profile } from "@/types/profile";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async (user: User) => {
    if (user.is_anonymous) {
      setProfile(null);
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
    setProfile(nextProfile);
    if (nextProfile?.locale) await i18n.changeLanguage(nextProfile.locale);
    setProfileLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError(null);
      setLoading(false);
      if (!nextSession) setProfile(null);
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
  };

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    profileLoading,
    error,
    isAnonymous: Boolean(session?.user?.is_anonymous),
    startAnonymous,
    refreshProfile,
    signOut,
    clearError: () => setError(null),
  }), [session, profile, loading, profileLoading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
