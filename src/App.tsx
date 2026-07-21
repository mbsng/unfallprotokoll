import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Join from "./pages/Join";
import AuthPage from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function SessionGate() {
  const { t } = useTranslation();
  const { user, profile, loading, profileLoading, isAnonymous } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || profileLoading) return;
    if (user && !isAnonymous && profile && !profile.onboarding_completed && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    } else if (user && !isAnonymous && profile?.onboarding_completed && (location.pathname === "/onboarding" || location.pathname === "/auth")) {
      navigate("/", { replace: true });
    } else if ((!user || isAnonymous) && location.pathname === "/onboarding") {
      navigate("/", { replace: true });
    }
  }, [user, profile, loading, profileLoading, isAnonymous, location.pathname, navigate]);

  if (loading || profileLoading) return <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-5 text-center font-medium text-[#153B66]">{t("auth.loading")}</div>;
  return <Routes><Route path="/" element={<Index />} /><Route path="/join/:code" element={<Join />} /><Route path="/auth" element={<AuthPage />} /><Route path="/onboarding" element={<Onboarding />} /><Route path="*" element={<NotFound />} /></Routes>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider><SessionGate /></AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
