import { supabase } from "@/integrations/supabase/client";

export interface FleetDriver {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export interface FleetInvitation {
  id: string;
  email: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  createdAt: string;
}

export interface FleetIncident {
  id: string;
  shareCode: string;
  status: string;
  occurredAt: string | null;
  createdAt: string;
  location: string | null;
  driverId: string;
  driverName: string;
  plate: string | null;
}

export interface FleetIncidentDetail extends FleetIncident {
  circumstances: { injured?: boolean; otherDamage?: boolean } | null;
  parties: Array<{
    id: string;
    label: string;
    driver: Record<string, string>;
    vehicle: Record<string, string>;
    insurance: Record<string, string>;
    damageDescription: string | null;
    signedAt: string | null;
  }>;
  witnesses: Array<{ id: string; name: string; contact: string | null }>;
  photoCount: number;
}

export class FleetPortalError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("fleet-portal", { body });
  if (error || data?.error) throw new FleetPortalError(data?.error ?? "fleet_portal_failed");
  return data as T;
}

export const loadFleetOverview = () => invoke<{
  incidents: FleetIncident[];
  drivers: FleetDriver[];
  invitations: FleetInvitation[];
}>({ action: "overview" });

export const loadFleetIncident = (incidentId: string) =>
  invoke<{ incident: FleetIncidentDetail }>({ action: "detail", incidentId });

export const inviteFleetDriver = (email: string) =>
  invoke<{ invitation: FleetInvitation }>({ action: "invite_driver", email });
