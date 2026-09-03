import { supabase } from "@/integrations/supabase/client";
import type { AccidentData } from "@/types/incident";
import type { Profile } from "@/types/profile";

export interface ProfileMasterData {
  fullName: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  birthDate: string;
  licenseNo: string;
  licenseClass: string;
  licenseValidUntil: string;
  makeModel: string;
  plate: string;
  registrationCountry: string;
  insuranceCompany: string;
  policyNumber: string;
  insuranceOffice: string;
  locale: Profile["locale"];
}

export const emptyProfileMasterData = (locale: Profile["locale"] = "en"): ProfileMasterData => ({
  fullName: "",
  phone: "",
  address: "",
  postalCode: "",
  city: "",
  country: "",
  birthDate: "",
  licenseNo: "",
  licenseClass: "",
  licenseValidUntil: "",
  makeModel: "",
  plate: "",
  registrationCountry: "",
  insuranceCompany: "",
  policyNumber: "",
  insuranceOffice: "",
  locale,
});

export const profileToMasterData = (profile: Profile): ProfileMasterData => ({
  fullName: profile.full_name ?? "",
  phone: profile.phone ?? "",
  address: profile.address ?? "",
  postalCode: profile.postal_code ?? "",
  city: profile.city ?? "",
  country: profile.country ?? "",
  birthDate: profile.birth_date ?? "",
  licenseNo: profile.license_no ?? "",
  licenseClass: profile.license_class ?? "",
  licenseValidUntil: profile.license_valid_until ?? "",
  makeModel: profile.default_vehicle_json?.makeModel ?? "",
  plate: profile.default_vehicle_json?.plate ?? "",
  registrationCountry: profile.default_vehicle_json?.registrationCountry ?? "",
  insuranceCompany: profile.insurance_json?.company ?? "",
  policyNumber: profile.insurance_json?.policyNumber ?? "",
  insuranceOffice: profile.insurance_json?.office ?? "",
  locale: profile.locale,
});

export const accidentToMasterData = (data: AccidentData, locale: Profile["locale"]): ProfileMasterData => ({
  fullName: data.driverName,
  phone: data.phone,
  address: data.driverAddress,
  postalCode: data.postalCode,
  city: data.city,
  country: data.country,
  birthDate: data.birthDate,
  licenseNo: data.licenseNo,
  licenseClass: data.licenseClass,
  licenseValidUntil: data.licenseValidUntil,
  makeModel: data.vehicle,
  plate: data.plate,
  registrationCountry: data.vehicleCountry,
  insuranceCompany: data.insurer,
  policyNumber: data.policy,
  insuranceOffice: data.insuranceOffice,
  locale,
});

export const profilePayload = (data: ProfileMasterData) => ({
  full_name: data.fullName.trim() || null,
  phone: data.phone.trim() || null,
  address: data.address.trim() || null,
  postal_code: data.postalCode.trim() || null,
  city: data.city.trim() || null,
  country: data.country.trim() || null,
  birth_date: data.birthDate || null,
  license_no: data.licenseNo.trim() || null,
  license_class: data.licenseClass.trim() || null,
  license_valid_until: data.licenseValidUntil || null,
  default_vehicle_json: {
    makeModel: data.makeModel.trim(),
    plate: data.plate.trim().toUpperCase(),
    registrationCountry: data.registrationCountry.trim(),
  },
  insurance_json: {
    company: data.insuranceCompany.trim(),
    policyNumber: data.policyNumber.trim(),
    office: data.insuranceOffice.trim(),
  },
  locale: data.locale,
  updated_at: new Date().toISOString(),
});

export async function saveProfileMasterData(userId: string, data: ProfileMasterData, onboardingCompleted?: boolean) {
  const values = onboardingCompleted === undefined
    ? profilePayload(data)
    : { ...profilePayload(data), onboarding_completed: onboardingCompleted };
  const { data: updated, error } = await supabase
    .from("profiles")
    .update(values)
    .eq("id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error("profile_update_zero_rows");
  return updated as Profile;
}

const LOCAL_PROFILE_KEY = "upsala-anonymous-profile";

export function loadLocalProfileMasterData(): ProfileMasterData | null {
  const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProfileMasterData;
  } catch {
    return null;
  }
}

export function saveLocalProfileMasterData(data: ProfileMasterData) {
  localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(data));
}

export function clearLocalProfileMasterData() {
  localStorage.removeItem(LOCAL_PROFILE_KEY);
}
