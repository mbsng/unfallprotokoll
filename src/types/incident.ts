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
}

export interface JoinedIncidentState {
  draftRef: IncidentDraftRef;
  incident: IncidentPreview;
}

export interface IncidentSummaryData {
  incidentVersion: number;
  status: string;
  parties: IncidentPartySummary[];
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
  phone: string;
  plate: string;
  vehicle: string;
  insurer: string;
  policy: string;
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
  phone: string;
  licenseNo?: string;
}

export interface VehicleIncidentData {
  plate: string;
  makeModel: string;
}

export interface InsuranceIncidentData {
  company: string;
  policyNumber: string;
}
