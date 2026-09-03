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
