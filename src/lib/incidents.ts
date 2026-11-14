import { supabase } from "@/integrations/supabase/client";
import { normalizeShareCode } from "@/lib/share-code";
import type { CaseStatus, IncidentDraftRef, IncidentPreview, IncidentSummaryData, JoinedIncidentState, PendingPhoto, ReportType, UserIncidentItem } from "@/types/incident";
import { normalizeReportType } from "@/types/incident";

const hasText = (value?: string | null) => Boolean(value?.trim());

const isPartyComplete = (driver: unknown, vehicle: unknown, insurance: unknown, damage: string | null) => {
  const d = driver as Record<string, string> | null;
  const v = vehicle as Record<string, string> | null;
  const i = insurance as Record<string, string> | null;
  return hasText(d?.fullName) && hasText(d?.address) && hasText(d?.phone)
    && hasText(v?.plate) && hasText(v?.makeModel)
    && hasText(i?.company) && hasText(i?.policyNumber)
    && hasText(damage);
};

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

export async function createIncidentWithParty(driver: object, vehicle: object, insurance: object, reportType: ReportType = "collision"): Promise<IncidentDraftRef> {

  const { data, error } = await supabase.rpc("create_incident_with_party", {
    initial_driver: driver,
    initial_vehicle: vehicle,
    initial_insurance: insurance,
    initial_report_type: reportType,
  });
  const row = data?.[0];
  if (error || !row || !row.share_code) throw new IncidentSaveError("create");
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
  const normalizedCode = normalizeShareCode(code);
  const { data, error } = await supabase.functions.invoke("join-incident", { body: { action: "preview", code: normalizedCode } });
  if (error) throw new IncidentJoinError(await functionErrorCode(error, "not_found"));
  if (!data?.incident) throw new IncidentJoinError(data?.error ?? "not_found");
  return data.incident as IncidentPreview;
}

export async function joinIncident(code: string): Promise<JoinedIncidentState> {
  const normalizedCode = normalizeShareCode(code);
  const { data, error } = await supabase.functions.invoke("join-incident", { body: { action: "join", code: normalizedCode } });
  if (error) throw new IncidentJoinError(await functionErrorCode(error, "join_failed"));
  if (!data?.draftRef || !data?.incident) throw new IncidentJoinError(data?.error ?? "join_failed");
  return data as JoinedIncidentState;
}

export async function loadIncidentSummary(ref: IncidentDraftRef): Promise<IncidentSummaryData> {
  const [incidentResult, partiesResult, witnessesResult, mediaResult] = await Promise.all([
    supabase.from("incidents").select("version, status, occurred_at, location_text, location_lat, location_lng, circumstances_json, sketch_json, sketch_data_url, sketch_updated_by, sketch_updated_at, report_type, type_details").eq("id", ref.incidentId).single(),
    supabase.from("incident_parties").select("id, party_label, version, driver_json, vehicle_json, insurance_json, damage_description, circumstances_checked, signed_at, sketch_confirmed_at").eq("incident_id", ref.incidentId).order("party_label"),
    supabase.from("incident_witnesses").select("name, contact").eq("incident_id", ref.incidentId),
    supabase.from("incident_media").select("id, storage_path, kind, party_id").eq("incident_id", ref.incidentId).order("uploaded_at"),
  ]);
  if (incidentResult.error || partiesResult.error || witnessesResult.error || mediaResult.error) throw new IncidentSaveError("save");
  const photos = await Promise.all((mediaResult.data ?? []).filter((item) => item.kind === "photo" && item.party_id === ref.partyId).map(async (item) => {
    const { data, error } = await supabase.storage.from("incident-media").createSignedUrl(item.storage_path, 3600);
    if (error || !data) throw new IncidentSaveError("save");
    return { id: item.id, mediaId: item.id, storagePath: item.storage_path, url: data.signedUrl };
  }));
  let sketchDataUrl = incidentResult.data.sketch_data_url;
  const sketchPath = (incidentResult.data.sketch_json as { storagePath?: string } | null)?.storagePath;
  if (!sketchDataUrl && sketchPath && sketchPath !== "pending") {
    const { data, error } = await supabase.storage.from("incident-media").download(sketchPath);
    if (error || !data) throw new IncidentSaveError("save");
    sketchDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new IncidentSaveError("save"));
      reader.readAsDataURL(data);
    });
  }
  return {
    incidentVersion: incidentResult.data.version,
    status: incidentResult.data.status,
    occurredAt: incidentResult.data.occurred_at,
    locationText: incidentResult.data.location_text,
    locationLat: incidentResult.data.location_lat,
    locationLng: incidentResult.data.location_lng,
    injured: Boolean(incidentResult.data.circumstances_json?.injured),
    otherDamage: Boolean(incidentResult.data.circumstances_json?.otherDamage),
    witnesses: (witnessesResult.data ?? []).map((item) => [item.name, item.contact].filter(Boolean).join(" ")).join("\n"),
    photos,
    sketchDataUrl,
    sketchUpdatedBy: incidentResult.data.sketch_updated_by,
    sketchUpdatedAt: incidentResult.data.sketch_updated_at,
    reportType: normalizeReportType(incidentResult.data.report_type),
    typeDetails: (incidentResult.data.type_details ?? {}) as IncidentSummaryData["typeDetails"],
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
      sketchConfirmedAt: party.sketch_confirmed_at,
    })),
  };
}

export async function loadUserIncidents(userId: string): Promise<UserIncidentItem[]> {
  const { data: incidents, error: incidentsError } = await supabase
    .from("incidents")
    .select("id, share_code, status, report_type, occurred_at, location_text, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (incidentsError) throw incidentsError;
  if (!incidents?.length) return [];

  const { data: allParties, error: partiesError } = await supabase
    .from("incident_parties")
    .select("id, incident_id, party_label, profile_id, signed_at, driver_json, vehicle_json, insurance_json, damage_description")
    .in("incident_id", incidents.map((i) => i.id));

  if (partiesError) throw partiesError;

  return incidents
    .map((incident) => {
      const partiesForIncident = (allParties ?? []).filter((p) => p.incident_id === incident.id);
      const own = partiesForIncident.find((p) => p.profile_id === userId);
      if (!own) return null;
      const others = partiesForIncident.filter((p) => p.id !== own.id);
      return {
        incidentId: incident.id,
        partyId: own.id,
        partyLabel: own.party_label as "A" | "B",
        shareCode: incident.share_code,
        status: incident.status,
        reportType: normalizeReportType(incident.report_type),
        ownSignedAt: own.signed_at,
        counterpartSignedAt: others[0]?.signed_at ?? null,
        counterpartExists: others.length > 0,
        ownFieldsComplete: isPartyComplete(own.driver_json, own.vehicle_json, own.insurance_json, own.damage_description),
        occurredAt: incident.occurred_at,
        locationText: incident.location_text,
        plate: (own.vehicle_json as Record<string, string> | null)?.plate ?? "",
      };
    })
    .filter((item): item is UserIncidentItem => item !== null);
}

export function computeCaseStatus(item: UserIncidentItem): CaseStatus {
  const status = item.status as CaseStatus;
  if (status === "draft" || status === "joined" || status === "partially_signed" || status === "signed" || status === "submitted") return status;
  return "draft";
}

export function subscribeToUserIncidents(onChange: () => void) {
  const channel = supabase
    .channel(`user-incidents:${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "incident_parties" }, onChange)
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export type RealtimeConnectionStatus = "connected" | "connecting" | "offline";

export function subscribeToIncident(incidentId: string, onChange: () => void, onStatus: (status: RealtimeConnectionStatus) => void) {
  let stopped = false;
  let retryTimer: number | null = null;
  let attempt = 0;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const clearChannel = () => {
    const current = channel;
    channel = null;
    if (current) void supabase.removeChannel(current);
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null || !navigator.onLine) return;
    onStatus("offline");
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    attempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    if (!navigator.onLine) {
      onStatus("offline");
      return;
    }
    clearChannel();
    onStatus("connecting");
    const current = supabase
      .channel(`incident:${incidentId}:${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `id=eq.${incidentId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "incident_parties", filter: `incident_id=eq.${incidentId}` }, onChange);
    channel = current;
    current.subscribe((status) => {
      if (stopped || channel !== current) return;
      if (status === "SUBSCRIBED") {
        attempt = 0;
        onStatus("connected");
        onChange();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearChannel();
        scheduleReconnect();
      }
    });
  };

  const handleOnline = () => {
    attempt = 0;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    connect();
  };
  const handleOffline = () => {
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    clearChannel();
    onStatus("offline");
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  connect();

  return () => {
    stopped = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    clearChannel();
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

export async function replaceWitness(ref: IncidentDraftRef, witness: string, newId: string = crypto.randomUUID()) {
  const { data: existing, error: loadError } = await supabase.from("incident_witnesses").select("id, name, contact").eq("incident_id", ref.incidentId).order("id");
  if (loadError) throw new IncidentSaveError("save");
  const matching = existing?.find((row) => row.name === witness.trim() && !row.contact);
  const id = matching?.id ?? (existing?.some((row) => row.id === newId) ? crypto.randomUUID() : newId);
  if (witness.trim() && !matching) {
    const { data, error } = await supabase.from("incident_witnesses").insert({ id, incident_id: ref.incidentId, name: witness.trim(), contact: null }).select("id").single();
    if (error || !data) throw new IncidentSaveError("save");
  }
  // Only remove the previous rows after the replacement was saved successfully.
  const obsoleteIds = (existing ?? []).filter((row) => !witness.trim() || row.id !== id).map((row) => row.id);
  if (obsoleteIds.length) {
    const { error } = await supabase.from("incident_witnesses").delete().eq("incident_id", ref.incidentId).in("id", obsoleteIds);
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
