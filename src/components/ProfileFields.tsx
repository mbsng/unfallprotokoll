import { Car, ShieldCheck, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileMasterData } from "@/lib/profile-data";

const inputClass = "h-12 rounded-xl border-slate-200 text-base focus-visible:ring-[#153B66]";

export function ProfileFields({ data, onChange }: { data: ProfileMasterData; onChange: <K extends keyof ProfileMasterData>(key: K, value: ProfileMasterData[K]) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <Section icon={<UserRound />} title={t("profile.personalSection")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("profile.fullName")}><Input value={data.fullName} onChange={(event) => onChange("fullName", event.target.value)} autoComplete="name" className={inputClass} /></Field>
          <Field label={t("profile.phone")}><Input type="tel" value={data.phone} onChange={(event) => onChange("phone", event.target.value)} autoComplete="tel" className={inputClass} /></Field>
          <Field label={t("profile.address")}><Input value={data.address} onChange={(event) => onChange("address", event.target.value)} autoComplete="street-address" className={inputClass} /></Field>
          <Field label={t("profile.postalCode")}><Input value={data.postalCode} onChange={(event) => onChange("postalCode", event.target.value)} autoComplete="postal-code" className={inputClass} /></Field>
          <Field label={t("profile.city")}><Input value={data.city} onChange={(event) => onChange("city", event.target.value)} autoComplete="address-level2" className={inputClass} /></Field>
          <Field label={t("profile.country")}><Input value={data.country} onChange={(event) => onChange("country", event.target.value)} autoComplete="country-name" className={inputClass} /></Field>
          <Field label={t("profile.birthDate")}><Input type="date" value={data.birthDate} onChange={(event) => onChange("birthDate", event.target.value)} className={inputClass} /></Field>
        </div>
      </Section>

      <Section icon={<UserRound />} title={t("profile.licenseSection")}>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={t("profile.licenseNo")}><Input value={data.licenseNo} onChange={(event) => onChange("licenseNo", event.target.value)} className={inputClass} /></Field>
          <Field label={t("profile.licenseClass")}><Input value={data.licenseClass} onChange={(event) => onChange("licenseClass", event.target.value)} className={inputClass} /></Field>
          <Field label={t("profile.licenseValidUntil")}><Input type="date" value={data.licenseValidUntil} onChange={(event) => onChange("licenseValidUntil", event.target.value)} className={inputClass} /></Field>
        </div>
      </Section>

      <Section icon={<Car />} title={t("profile.vehicleSection")}>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={t("profile.makeModel")}><Input value={data.makeModel} onChange={(event) => onChange("makeModel", event.target.value)} className={inputClass} /></Field>
          <Field label={t("profile.plate")}><Input value={data.plate} onChange={(event) => onChange("plate", event.target.value.toUpperCase())} className={`${inputClass} uppercase`} /></Field>
          <Field label={t("profile.registrationCountry")}><Input value={data.registrationCountry} onChange={(event) => onChange("registrationCountry", event.target.value)} className={inputClass} /></Field>
        </div>
      </Section>

      <Section icon={<ShieldCheck />} title={t("profile.insuranceSection")}>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={t("profile.insuranceCompany")}><Input value={data.insuranceCompany} onChange={(event) => onChange("insuranceCompany", event.target.value)} className={inputClass} /></Field>
          <Field label={t("profile.policyNumber")}><Input value={data.policyNumber} onChange={(event) => onChange("policyNumber", event.target.value)} className={inputClass} /></Field>
          <Field label={t("profile.insuranceOffice")}><Input value={data.insuranceOffice} onChange={(event) => onChange("insuranceOffice", event.target.value)} className={inputClass} /></Field>
        </div>
      </Section>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7"><div className="mb-5 flex items-center gap-3 text-[#153B66]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E7F0F6] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><h2 className="text-lg font-bold">{title}</h2></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-2 block text-sm font-semibold text-slate-700">{label}</Label>{children}</div>;
}
