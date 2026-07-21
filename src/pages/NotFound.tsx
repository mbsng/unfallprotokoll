import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] p-5">
      <div className="text-center">
        <div className="mb-8 flex justify-center"><LanguageSwitcher /></div>
        <p className="text-6xl font-bold text-[#153B66]">404</p>
        <h1 className="mb-5 mt-3 text-xl text-slate-600">{t("notFound.title")}</h1>
        <Link to="/" className="font-semibold text-[#39719D] underline underline-offset-4">{t("notFound.home")}</Link>
      </div>
    </div>
  );
}
