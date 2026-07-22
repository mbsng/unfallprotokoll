import { Cable, LogIn, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function UserMenu() {
  const { t } = useTranslation();
  const { user, profile, loading, isAnonymous, signOut } = useAuth();
  if (loading) return null;

  if (!user || isAnonymous) return (
    <Button asChild variant="outline" className="h-10 w-10 rounded-xl border-[#B8CDDC] px-0 text-[#153B66] sm:w-auto sm:px-3"><Link to="/auth" aria-label={t("auth.signInAction")}><LogIn className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">{t("auth.signInAction")}</span></Link></Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-[#B8CDDC]" aria-label={t("auth.account")}><UserRound className="h-5 w-5 text-[#153B66]" /></Button></DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 rounded-xl p-2">
        <DropdownMenuLabel><p className="truncate text-sm font-semibold">{profile?.full_name || user.email}</p><p className="truncate text-xs font-normal text-slate-500">{user.email}</p></DropdownMenuLabel>
        <DropdownMenuSeparator />
        {profile?.org_id && ["insurer_agent", "admin"].includes(profile.role) && <DropdownMenuItem asChild className="min-h-11 cursor-pointer rounded-lg"><Link to="/integrations"><Cable className="mr-2 h-4 w-4" />{t("integrations.menu")}</Link></DropdownMenuItem>}
        <DropdownMenuItem onClick={() => void signOut()} className="min-h-11 cursor-pointer rounded-lg text-red-700"><LogOut className="mr-2 h-4 w-4" />{t("auth.signOut")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
