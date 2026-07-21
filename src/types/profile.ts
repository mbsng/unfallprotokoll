export type UserRole = "driver" | "fleet_manager" | "insurer_agent" | "admin";

export interface VehicleProfile {
  plate?: string;
  makeModel?: string;
}

export interface InsuranceProfile {
  company?: string;
  policyNumber?: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  license_no: string | null;
  default_vehicle_json: VehicleProfile;
  insurance_json: InsuranceProfile;
  org_id: string | null;
  role: UserRole;
  locale: "de-CH" | "fr-CH" | "it-CH" | "en";
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}
