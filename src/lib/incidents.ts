import { supabase } from "@/integrations/supabase/client";
import type { IncidentDraftRef, IncidentPreview, IncidentSummaryData, JoinedIncidentState, PendingPhoto } from "@/types/incident";

export class IncidentSaveError extends Error {
  constructor(public code: "save" | "conflict" | "create") {
    super(code);
  }
}

export class IncidentJoinError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function functionErrorCode(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return fallback;
  try {
    const body = await context.clone().json() as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function createIncidentWithParty(driver: object, vehicle: object, insurance: object): Promise<IncidentDraftRef> {

  const { data, error } = await supabase.rpc("create_incident_with_party", {
    initial_driver: driver,
    initial_vehicle: vehicle,
    initial_insurance: insurance,
  });
  const row = data?.[0];
  if (error || !row) throw new IncidentSaveError("create");
  return {
    incidentId: row.incident_id,
    partyId: row.party_id,
    partyLabel: "A",
    shareCode: row.share_code,
    incidentVersion: row.incident_version,
    partyVersion: row.party_version,
  };
}

export async function previewIncident(code: string): Promise<IncidentPreview> {
  const { data, error } = await supabase.functions.invoke("join-incident", { body: { action: "preview", code } });
  if (error) throw new IncidentJoinError(await functionErrorCode(error, "not_found"));
  if (!data?.incident) throw new IncidentJoinError(data?.error ?? "not_found");
  return data.incident as IncidentPreview;
}

export async function joinIncident(code: string): Promise<JoinedIncidentState> {
  const { data, error } = await supabase.functions.invoke("join-incident", { body: { action: "join", code } });
  if (error) throw new IncidentJoinError(await functionErrorCode(error, "join_failed"));
  if (!data?.draftRef || !data?.incident) throw new IncidentJoinError(data?.error ?? "join_failed");
  return data as JoinedIncidentState;
}

export async function loadIncidentSummary(ref: IncidentDraftRef): Promise<IncidentSummaryData> {
  const [incidentResult, partiesResult] = await Promise.all([
    supabase.from("incidents").select("version, status").eq("id", ref.incidentId).single(),
    supabase.from("incident_parties").select("id, party_label, version, driver_json, vehicle_json, insurance_json, damage_description, circumstances_checked, signed_at").eq("incident_id", ref.incidentId).order("party_label"),
  ]);
  if (incidentResult.error || partiesResult.error) throw new IncidentSaveError("save");
  return {
    incidentVersion: incidentResult.data.version,
    status: incidentResult.data.status,
    parties: partiesResult.data.map((party) => ({
      id: party.id,
      partyLabel: party.party_label as "A" | "B",
      version: party.version,
      driver: party.driver_json,

      vehicle: party.vehicle_json,
      insurance: party.insurance_json,
      damageDescription: party.damage_description,
      circumstancesChecked: party.circumstances_checked,
      signedAt: party.signed_at,
    })),
  };
}

export async function updateIncident(ref: IncidentDraftRef, updates: Record<string, unknown>) {

  const nextVersion = ref.incidentVersion + 1;
  const { data, error } = await supabase
    .from("incidents")
    .update({ ...updates, version: nextVersion, updated_at: new Date().toISOString() })
    .eq("id", ref.incidentId)
    .eq("version", ref.incidentVersion)
    .select("version")
    .maybeSingle();
  if (error) throw new IncidentSaveError("save");
  if (!data) throw new IncidentSaveError("conflict");
  return data.version as number;
}

export async function updateParty(ref: IncidentDraftRef, updates: Record<string, unknown>) {
  const nextVersion = ref.partyVersion + 1;
  const { data, error } = await supabase
    .from("incident_parties")
    .update({ ...updates, version: nextVersion, updated_at: new Date().toISOString() })
    .eq("id", ref.partyId)
    .eq("version", ref.partyVersion)
    .select("version")
    .maybeSingle();
  if (error) throw new IncidentSaveError("save");
  if (!data) throw new IncidentSaveError("conflict");
  return data.version as number;
}

export async function replaceWitness(ref: IncidentDraftRef, witness: string) {
  const { error: deleteError } = await supabase.from("incident_witnesses").delete().eq("incident_id", ref.incidentId);
  if (deleteError) throw new IncidentSaveError("save");
  if (witness.trim()) {
    const { error } = await supabase.from("incident_witnesses").insert({ incident_id: ref.incidentId, name: witness.trim(), contact: null });
    if (error) throw new IncidentSaveError("save");
  }
}

const extensionForFile = (file: File) => {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic") return "heic";
  if (file.type === "image/heif") return "heif";
  if (file.type === "application/pdf") return "pdf";
  return "jpg";
};

async function registerMedia(ref: IncidentDraftRef, path: string, kind: "photo" | "sketch" | "document", takenAt?: string) {
  const { data, error } = await supabase.from("incident_media").upsert({ incident_id: ref.incidentId, party_id: ref.partyId, storage_path: path, kind, taken_at: takenAt ?? null }, { onConflict: "storage_path" }).select("id").single();
  if (error) throw new IncidentSaveError("save");
  return data.id as string;
}

export async function uploadPendingPhotos(ref: IncidentDraftRef, photos: PendingPhoto[]) {
  const result: PendingPhoto[] = [];
  for (const photo of photos) {
    if (!photo.file || photo.storagePath) {
      result.push(photo);
      continue;
    }
    const path = `${ref.incidentId}/${ref.partyId}/photo-${photo.id}.${extensionForFile(photo.file)}`;
    const { error } = await supabase.storage.from("incident-media").upload(path, photo.file, { upsert: true, contentType: photo.file.type });
    if (error) throw new IncidentSaveError("save");
    const mediaId = await registerMedia(ref, path, "photo", new Date(photo.file.lastModified).toISOString());
    result.push({ ...photo, storagePath: path, mediaId, file: undefined });
  }
  return result;
}

const dataUrlToBlob = async (dataUrl: string) => {

  const response = await fetch(dataUrl);
  return response.blob();
};

export async function uploadCanvas(ref: IncidentDraftRef, dataUrl: string, name: "sketch" | "signature") {
  const path = `${ref.incidentId}/${ref.partyId}/${name}.png`;
  const blob = await dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage.from("incident-media").upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) throw new IncidentSaveError("save");
  await registerMedia(ref, path, name === "sketch" ? "sketch" : "document");
  return path;
}

export async function deleteIncidentPhoto(photo: PendingPhoto) {
  if (photo.storagePath) {
    const { error } = await supabase.storage.from("incident-media").remove([photo.storagePath]);
    if (error) throw new IncidentSaveError("save");
  }
  if (photo.mediaId) {
    const { error } = await supabase.from("incident_media").delete().eq("id", photo.mediaId);
    if (error) throw new IncidentSaveError("save");
  }
  URL.revokeObjectURL(photo.url);
}
