// Report types introduced with the damage-report triage. Theft and vandalism
// are deliberately NOT available yet.
export type ReportType = "collision" | "single_vehicle" | "nature";

export const REPORT_TYPES: ReportType[] = ["collision", "single_vehicle", "nature"];

export const normalizeReportType = (value: unknown): ReportType =>
  value === "single_vehicle" || value === "nature" ? value : "collision";

// Event kinds for the "Wetter, Natur und Tier" report type.
export const NATURE_EVENT_TYPES = [
  "hail", "storm", "flood", "snow_pressure", "rockfall", "wildlife", "marten", "other",
] as const;
export type NatureEventType = (typeof NATURE_EVENT_TYPES)[number];

// Weather-like events get a from/to period instead of an exact timestamp,
// because hail or storms span time and are often noticed only later.
export const NATURE_PERIOD_EVENT_TYPES: readonly string[] = ["hail", "storm", "flood", "snow_pressure", "rockfall"];

// Affected vehicle parts (multiple choice) for nature reports.
export const NATURE_PART_KEYS = [
  "roof", "hood", "trunk_lid", "windshield", "rear_window", "side_windows",
  "fender_left", "fender_right", "doors_left", "doors_right", "mirrors", "lights", "underbody", "other_part",
] as const;
export type NaturePartKey = (typeof NATURE_PART_KEYS)[number];

export const NATURE_HAIL_DENSITIES = ["few", "moderate", "many"] as const;
export const NATURE_HAIL_SIZES = ["small", "medium", "large"] as const;

// Type-specific details persisted in incidents.type_details (nature reports).
export interface NatureTypeDetails {
  eventType: string;
  periodFrom: string;
  periodTo: string;
  discoveredOn: string;
  parking: string;
  parts: string[];
  hailDensity: string;
  hailSize: string;
}

export interface IncidentDraftRef {
  incidentId: string;
  partyId: string;
  partyLabel: "A" | "B";
  shareCode: string;
  incidentVersion: number;
  partyVersion: number;
}

export interface IncidentPreview {
  shareCode: string;
  occurredAt: string | null;
  locationText: string | null;
}

export interface IncidentPartySummary {
  id: string;
  partyLabel: "A" | "B";
  version: number;
  driver: DriverIncidentData;
  vehicle: VehicleIncidentData;
  insurance: InsuranceIncidentData;
  damageDescription: string | null;
  circumstancesChecked: number[];
  signedAt: string | null;
  sketchConfirmedAt: string | null;
}

export interface JoinedIncidentState {
  draftRef: IncidentDraftRef;
  incident: IncidentPreview;
}

export interface IncidentSummaryData {
  incidentVersion: number;
  status: string;
  occurredAt: string | null;
  locationText: string | null;
  sketchDataUrl: string | null;
  sketchUpdatedBy: string | null;
  sketchUpdatedAt: string | null;
  reportType: ReportType;
  typeDetails: Partial<NatureTypeDetails>;
  parties: IncidentPartySummary[];
}

// Mirrors the database-derived incident status maintained by the
// sync_incident_status_from_parties trigger (plus the terminal "submitted").
export type CaseStatus = "draft" | "joined" | "partially_signed" | "signed" | "submitted";

export interface UserIncidentItem {
  incidentId: string;
  partyId: string;
  partyLabel: "A" | "B";
  shareCode: string;
  status: string;
  reportType: ReportType;
  ownSignedAt: string | null;
  counterpartSignedAt: string | null;
  counterpartExists: boolean;
  ownFieldsComplete: boolean;
  occurredAt: string | null;
  locationText: string | null;
  plate: string;
}

export interface PendingPhoto {
  id: string;
  url: string;
  file?: File;
  storagePath?: string;
  mediaId?: string;
}

export interface AccidentData {
  reportType: ReportType;
  date: string;
  time: string;
  location: string;
  locationLat: number | null;
  locationLng: number | null;
  injured: boolean;
  otherDamage: boolean;
  witnesses: string;
  driverName: string;
  driverAddress: string;
  postalCode: string;
  city: string;
  country: string;
  birthDate: string;
  phone: string;
  licenseNo: string;
  licenseClass: string;
  licenseValidUntil: string;
  plate: string;
  vehicle: string;
  vehicleCountry: string;
  insurer: string;
  policy: string;
  insuranceOffice: string;
  situations: number[];
  damage: string;
  notes: string;
  photos: PendingPhoto[];
  hasSketch: boolean;
  sketchDataUrl: string;
  hasSignature: boolean;
  signatureDataUrl: string;
  natureEventType: string;
  naturePeriodFrom: string;
  naturePeriodTo: string;
  natureDiscoveredOn: string;
  natureParking: string;
  natureParts: string[];
  natureHailDensity: string;
  natureHailSize: string;
}

export interface DriverIncidentData {
  fullName: string;
  address: string;
  postalCode?: string;
  city?: string;
  country?: string;
  birthDate?: string;
  phone: string;
  licenseNo?: string;
  licenseClass?: string;
  licenseValidUntil?: string;
}

export interface VehicleIncidentData {
  plate: string;
  makeModel: string;
  registrationCountry?: string;
}

export interface InsuranceIncidentData {
  company: string;
  policyNumber: string;
  office?: string;
}
