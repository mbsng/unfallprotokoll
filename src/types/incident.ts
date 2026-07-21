export interface IncidentDraftRef {
  incidentId: string;
  partyId: string;
  shareCode: string;
  incidentVersion: number;
  partyVersion: number;
}

export interface PendingPhoto {
  id: string;
  url: string;
  file?: File;
  storagePath?: string;
  mediaId?: string;
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
