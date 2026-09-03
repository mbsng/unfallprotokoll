export type UserRole = "driver" | "fleet_manager" | "insurer_agent" | "admin";

export interface VehicleProfile {
  plate?: string;
  makeModel?: string;
  registrationCountry?: string;
}

export interface InsuranceProfile {
  company?: string;
  policyNumber?: string;
  office?: string;
}

export interface OrganizationBranding {
  logo_url?: string;
  primary_color?: string;
}

export interface Organization {
  id: string;
  name: string;
  branding_json: OrganizationBranding | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  birth_date: string | null;
  license_no: string | null;
  license_class: string | null;
  license_valid_until: string | null;
  default_vehicle_json: VehicleProfile;
  insurance_json: InsuranceProfile;
  org_id: string | null;
  role: UserRole;
  locale: "de-CH" | "fr-CH" | "it-CH" | "en";
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}
