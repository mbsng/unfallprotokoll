import Dexie from "dexie";
import { supabase } from "@/integrations/supabase/client";
import { db, deviceId, applyDraftFromSync, persistSyncedDraft, requestSync, tableForField, NATURE_FIELDS, type LocalDraft, type OutboxEntry, type SyncConflict } from "@/lib/local-db";
import type { AccidentData } from "@/types/incident";
import { replaceWitness as saveWitness } from "@/lib/incidents";

let activeRun: Promise<void> | null = null;
let started = false;
let activeOwnerId: string | null = null;
const processingEntries = new Set<string>();
const MAX_ATTEMPTS = 5;
const CALL_TIMEOUT = 15_000;

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function withTimeout<T>(promise: PromiseLike<T> | Promise<T>, ms = CALL_TIMEOUT): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

const extensionForPhoto = (mimeType: string) => {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
};

const natureTypeDetails = (data: AccidentData) => ({
  eventType: data.natureEventType,
  periodFrom: data.naturePeriodFrom,
  periodTo: data.naturePeriodTo,
  discoveredOn: data.natureDiscoveredOn,
  parking: data.natureParking,
  parts: data.natureParts,
  hailDensity: data.natureEventType === "hail" ? data.natureHailDensity : "",
  hailSize: data.natureEventType === "hail" ? data.natureHailSize : "",
});

const natureDetailsKey = (field: string) => {
  const stripped = field.replace(/^nature/, "");
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
};

const incidentTimestamp = (data: AccidentData) => {
  const date = data.reportType === "nature" && ["hail", "storm", "flood", "snow_pressure", "rockfall"].includes(data.natureEventType)
    ? data.naturePeriodFrom : data.date;
  if (!date) return null;
  const timestamp = new Date(`${date}T${data.reportType === "nature" && date === data.naturePeriodFrom ? "00:00" : data.time || "00:00"}:00`);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

const incidentPatch = (data: AccidentData, field: keyof AccidentData): Record<string, unknown> => {
  if (field === "reportType") return { report_type: data.reportType, type_details: natureTypeDetails(data), occurred_at: incidentTimestamp(data) };
  if (typeof field === "string" && NATURE_FIELDS.includes(field as (typeof NATURE_FIELDS)[number])) {
    const patch: Record<string, unknown> = { type_details: natureTypeDetails(data), occurred_at: incidentTimestamp(data) };
    return patch;
  }
  if (field === "date" || field === "time") return { occurred_at: incidentTimestamp(data) };
  if (["location", "locationLat", "locationLng"].includes(field)) return { location_text: data.location, location_lat: data.locationLat, location_lng: data.locationLng };
  if (field === "injured" || field === "otherDamage") return { circumstances_json: { injured: data.injured, otherDamage: data.otherDamage } };
  if (field === "sketchDataUrl" || field === "hasSketch") return { sketch_data_url: data.sketchDataUrl || null, sketch_updated_by: activeOwnerId, sketch_updated_at: new Date().toISOString() };
  throw new Error(`unmapped_incident_field:${field}`);
};

const partyPatch = (data: AccidentData, field: keyof AccidentData) => {
  if (["driverName", "driverAddress", "postalCode", "city", "country", "birthDate", "phone", "licenseNo", "licenseClass", "licenseValidUntil", "damage", "notes"].includes(field)) return {
    driver_json: {
      fullName: data.driverName, address: data.driverAddress, postalCode: data.postalCode, city: data.city, country: data.country,
      birthDate: data.birthDate, phone: data.phone, licenseNo: data.licenseNo, licenseClass: data.licenseClass, licenseValidUntil: data.licenseValidUntil,
      reportDamage: data.damage, reportRemarks: data.notes,
    },
    damage_description: [data.damage, data.notes].filter(Boolean).join("\n\n"),
  };
  if (["plate", "vehicle", "vehicleCountry"].includes(field)) return { vehicle_json: { plate: data.plate, makeModel: data.vehicle, registrationCountry: data.vehicleCountry } };
  if (["insurer", "policy", "insuranceOffice"].includes(field)) return { insurance_json: { company: data.insurer, policyNumber: data.policy, office: data.insuranceOffice } };
  if (field === "situations") return { circumstances_checked: data.situations };
  throw new Error(`unmapped_party_field:${field}`);
};

function serverFields(table: "incidents" | "incident_parties", row: Record<string, unknown>, field: keyof AccidentData) {
  if (table === "incidents") {
    if (typeof field === "string" && NATURE_FIELDS.includes(field as (typeof NATURE_FIELDS)[number])) {
      const details = (row.type_details ?? {}) as Record<string, unknown>;
      const key = natureDetailsKey(field);
      return key === "parts" ? details[key] ?? [] : details[key] ?? "";
    }
    if (field === "reportType") return row.report_type ?? "collision";
    if (field === "date" || field === "time") {
      const date = row.occurred_at ? new Date(row.occurred_at as string) : null;
      return field === "date" ? date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "" : date?.toTimeString().slice(0, 5) ?? "";
    }
    if (field === "location") return row.location_text ?? "";
    if (field === "locationLat") return row.location_lat ?? null;
    if (field === "locationLng") return row.location_lng ?? null;
    if (field === "injured") return Boolean((row.circumstances_json as Record<string, unknown>)?.injured);
    if (field === "otherDamage") return Boolean((row.circumstances_json as Record<string, unknown>)?.otherDamage);
    if (field === "hasSketch") return Boolean(row.sketch_data_url);
    if (field === "sketchDataUrl") return row.sketch_data_url ?? "";
  } else {
    const driver = row.driver_json as Record<string, unknown>;
    const vehicle = row.vehicle_json as Record<string, unknown>;
    const insurance = row.insurance_json as Record<string, unknown>;
    if (field === "driverName") return driver?.fullName ?? "";
    if (field === "driverAddress") return driver?.address ?? "";
    if (field === "postalCode") return driver?.postalCode ?? "";
    if (field === "city") return driver?.city ?? "";
    if (field === "country") return driver?.country ?? "";
    if (field === "birthDate") return driver?.birthDate ?? "";
    if (field === "phone") return driver?.phone ?? "";
    if (field === "licenseNo") return driver?.licenseNo ?? "";
    if (field === "licenseClass") return driver?.licenseClass ?? "";
    if (field === "licenseValidUntil") return driver?.licenseValidUntil ?? "";
    if (field === "plate") return vehicle?.plate ?? "";
    if (field === "vehicle") return vehicle?.makeModel ?? "";
    if (field === "vehicleCountry") return vehicle?.registrationCountry ?? "";
    if (field === "insurer") return insurance?.company ?? "";
    if (field === "policy") return insurance?.policyNumber ?? "";
    if (field === "insuranceOffice") return insurance?.office ?? "";
    if (field === "situations") return row.circumstances_checked ?? [];
    if (field === "damage" || field === "notes") {
      return field === "damage" ? driver?.reportDamage ?? row.damage_description ?? "" : driver?.reportRemarks ?? "";
    }
  }
  return undefined;
}

async function assertOwner(ownerId: string) {
  const { data } = await withTimeout(supabase.auth.getSession());
  if (activeOwnerId !== ownerId || data.session?.user.id !== ownerId) throw new Error("sync_owner_changed");
}

async function createRemoteDraft(draft: LocalDraft, entry: OutboxEntry) {
  await assertOwner(draft.ownerId);
  console.log("[sync-worker] createRemoteDraft: calling RPC create_incident_with_party");
  const { data, error } = await withTimeout(supabase.rpc("create_incident_with_party", {
    initial_driver: {
      fullName: draft.data.driverName, address: draft.data.driverAddress, postalCode: draft.data.postalCode, city: draft.data.city, country: draft.data.country,
      birthDate: draft.data.birthDate, phone: draft.data.phone, licenseNo: draft.data.licenseNo, licenseClass: draft.data.licenseClass, licenseValidUntil: draft.data.licenseValidUntil,
    },
    initial_vehicle: { plate: draft.data.plate, makeModel: draft.data.vehicle, registrationCountry: draft.data.vehicleCountry },
    initial_insurance: { company: draft.data.insurer, policyNumber: draft.data.policy, office: draft.data.insuranceOffice },
    initial_report_type: draft.data.reportType ?? "collision",
  }));
  const row = data?.[0];
  if (error) {
    console.error("[sync-worker] createRemoteDraft: RPC error", { error: error.message });
    throw error;
  }
  if (!row || !row.share_code) {
    console.error("[sync-worker] createRemoteDraft: RPC returned no data", { data });
    throw new Error("create_returned_nothing");
  }
  console.log("[sync-worker] createRemoteDraft: success", { incidentId: row.incident_id, shareCode: row.share_code });
  draft.ref = {
    incidentId: row.incident_id,
    partyId: row.party_id,
    partyLabel: "A",
    shareCode: row.share_code,
    incidentVersion: row.incident_version,
    partyVersion: row.party_version,
  };
  const now = new Date().toISOString();
  // Each patch writes its complete field group, so one entry per group is
  // sufficient for the initial snapshot rather than dozens of duplicate writes.
  const snapshotFields: (keyof AccidentData)[] = [
    "date", "location", "injured", "witnesses", "driverName", "plate", "insurer", "situations",
  ];
  if (draft.data.sketchDataUrl) snapshotFields.push("sketchDataUrl");
  if ((draft.data.reportType ?? "collision") === "nature") snapshotFields.push("natureEventType");
  const snapshotEntries: OutboxEntry[] = snapshotFields.map((field, index) => {
    const table = tableForField(field);
    return {
      id: crypto.randomUUID(), ownerId: draft.ownerId, draftId: draft.id, table, operation: "update",
      payload: { field, value: draft.data[field], modifiedAt: draft.fieldModifiedAt[field] ?? now },
      version: table === "incidents" ? draft.ref.incidentVersion : draft.ref.partyVersion,
      device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: new Date(Date.now() + index).toISOString(),
    };
  });
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    await persistSyncedDraft(draft);
    await db.outbox.delete(entry.id);
    await db.outbox.bulkAdd(snapshotEntries);
  });
  await applyDraftFromSync(draft);
  requestSync();
}

async function writeVersioned(draft: LocalDraft, entry: OutboxEntry) {
  const field = entry.payload.field as keyof AccidentData;
  const table = entry.table as "incidents" | "incident_parties";
  const id = table === "incidents" ? draft.ref.incidentId : draft.ref.partyId;
  let version = table === "incidents" ? draft.ref.incidentVersion : draft.ref.partyVersion;
  const patch = table === "incidents" ? incidentPatch(draft.data, field) : partyPatch(draft.data, field);

  const attemptUpdate = async (baseVersion: number, values: Record<string, unknown>) => {
    const result = await withTimeout(supabase
      .from(table).update({ ...values, version: baseVersion + 1, updated_at: new Date().toISOString() })
      .eq("id", id).eq("version", baseVersion).select("version").maybeSingle());
    return result;
  };

  let result = await attemptUpdate(version, patch);
  if (result.error) throw result.error;
  if (!result.data) {
    // Version mismatch — fetch current server version and retry
    const { data: server, error } = await withTimeout(supabase.from(table).select("*").eq("id", id).maybeSingle());
    if (error) throw error;
    if (!server) {
      console.error("[sync-worker] writeVersioned: row not found", { table, id });
      throw new Error("row_not_found");
    }
    const serverValue = serverFields(table, server, field);
    const localValue = draft.data[field];
    if (sameValue(serverValue, localValue)) {
      version = server.version;
    } else {
      const localTime = new Date(draft.fieldModifiedAt[field] ?? entry.createdAt).getTime();
      const serverTime = new Date(server.updated_at).getTime();
      if (serverTime > localTime || Math.abs(localTime - serverTime) < 1000) {
        const conflict: SyncConflict = {
          id: crypto.randomUUID(), ownerId: draft.ownerId, draftId: draft.id, table, field, localValue,
          serverValue, serverVersion: server.version, createdAt: new Date().toISOString(),
        };
        await db.transaction("rw", db.conflicts, db.outbox, async () => {
          await db.conflicts.add(conflict);
          await db.outbox.delete(entry.id);
        });
        return;
      }
      if (serverTime > localTime) {
        draft.data = { ...draft.data, [field]: serverValue };
        draft.fieldModifiedAt = { ...draft.fieldModifiedAt, [field]: server.updated_at };
        version = server.version;
      } else {
        version = server.version;
        result = await attemptUpdate(version, patch);
        if (result.error || !result.data) throw result.error ?? new Error("conflict_retry_failed");
        version = result.data.version;
      }
    }
  } else {
    version = result.data.version;
  }

  if (table === "incidents") draft.ref = { ...draft.ref, incidentVersion: version };
  else draft.ref = { ...draft.ref, partyVersion: version };
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    await persistSyncedDraft(draft);
    await db.outbox.delete(entry.id);
  });
  await applyDraftFromSync(draft);
}

async function replaceWitness(draft: LocalDraft, entry: OutboxEntry) {
  await withTimeout(saveWitness(draft.ref, draft.data.witnesses, entry.id));
  await db.outbox.delete(entry.id);
}

async function syncMedia(draft: LocalDraft, entry: OutboxEntry) {
  if (entry.operation === "delete") {
    const path = entry.payload.storagePath as string | undefined;
    const mediaId = entry.payload.mediaId as string | undefined;
    if (path) {
      const { error } = await withTimeout(supabase.storage.from("incident-media").remove([path]));
      if (error) throw error;
    }
    if (mediaId || path) {
      const query = supabase.from("incident_media").delete();
      const { error } = await withTimeout(mediaId ? query.eq("id", mediaId) : query.eq("storage_path", path!));
      if (error) throw error;
    }
    await db.outbox.delete(entry.id);
    return;
  }
  const photoId = entry.payload.photoId as string;
  const photo = await db.photos.get(photoId);
  if (!photo || photo.ownerId !== draft.ownerId) {
    await db.outbox.delete(entry.id);
    return;
  }
  const path = `${draft.ref.incidentId}/${draft.ref.partyId}/photo-${photo.id}.${extensionForPhoto(photo.mimeType)}`;
  await db.photos.update(photoId, { storagePath: path });
  const { error } = await withTimeout(supabase.storage.from("incident-media").upload(path, photo.blob, { upsert: true, contentType: photo.mimeType }));
  if (error) throw error;
  const { data: media, error: mediaError } = await withTimeout(supabase.from("incident_media").upsert({
    incident_id: draft.ref.incidentId, party_id: draft.ref.partyId, storage_path: path,
    kind: "photo", taken_at: new Date(photo.lastModified).toISOString(),
  }, { onConflict: "storage_path" }).select("id").maybeSingle());
  if (mediaError) throw mediaError;
  if (!media) throw new Error("media_upsert_zero_rows");
  await db.transaction("rw", db.photos, db.outbox, async () => {
    await db.photos.update(photoId, { storagePath: path, mediaId: media.id });
    await db.outbox.delete(entry.id);
  });
  await applyDraftFromSync(draft);
}

async function processEntry(entry: OutboxEntry) {
  if (entry.ownerId !== activeOwnerId) return;
  if (processingEntries.has(entry.id)) return;
  if (entry.attempts >= MAX_ATTEMPTS) {
    console.error("[sync-worker] Entry exceeded max attempts", { id: entry.id, operation: entry.operation, attempts: entry.attempts });
    await db.outbox.update(entry.id, { nextAttemptAt: Date.now() + 86_400_000 });
    if (entry.operation === "complete") {
      window.dispatchEvent(new CustomEvent("incident-signature-error", { detail: { draftId: entry.draftId, message: "max_retries_exceeded" } }));
    }
    return;
  }
  processingEntries.add(entry.id);
  try {
    await assertOwner(entry.ownerId);
    const draft = await db.drafts.get(entry.draftId);
    if (!draft || draft.ownerId !== entry.ownerId) {
      await db.outbox.delete(entry.id);
      return;
    }
    if (entry.operation !== "create" && draft.ref.incidentId.startsWith("local:")) {
      await db.outbox.update(entry.id, { nextAttemptAt: Date.now() + 2_000 });
      return;
    }
    if (entry.operation === "create") return await createRemoteDraft(draft, entry);
    const conflict = await db.conflicts.where("draftId").equals(draft.id).filter((item) => item.ownerId === draft.ownerId && item.table === entry.table).first();
    if (conflict) {
      await db.outbox.update(entry.id, { nextAttemptAt: Date.now() + 2_000 });
      return;
    }
    if (entry.table === "incident_media") return await syncMedia(draft, entry);
    if (entry.table === "incident_witnesses") return await replaceWitness(draft, entry);
    if (entry.operation === "complete") {
      console.log("[sync-worker] Removing stale complete entry — signatures are now direct");
      await db.outbox.delete(entry.id);
      return;
    }
    return await writeVersioned(draft, entry);
  } finally {
    processingEntries.delete(entry.id);
  }
}

async function defer(entry: OutboxEntry) {
  const attempts = entry.attempts + 1;
  const delay = Math.min(300_000, 2_000 * 2 ** Math.min(attempts, 7));
  await db.outbox.update(entry.id, { attempts, nextAttemptAt: Date.now() + delay });
}

async function runOutbox() {
  const ownerId = activeOwnerId;
  if (!navigator.onLine || !ownerId) return;

  let processed = 0;
  let failed = 0;
  while (activeOwnerId === ownerId) {
    const entries = await db.outbox.where("[ownerId+nextAttemptAt]").between([ownerId, Dexie.minKey], [ownerId, Date.now()]).sortBy("createdAt");
    if (!entries.length) break;
    processed = 0;
    failed = 0;
    for (const entry of entries) {
      if (activeOwnerId !== ownerId) return;
      try {
        await processEntry(entry);
        processed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[sync-worker] Outbox entry failed", { operation: entry.operation, draftId: entry.draftId, error: message });
        if (entry.table === "incident_media") {
          // Photo transfers must never fail silently — surface the real error
          // to the UI so it can be retried.
          window.dispatchEvent(new CustomEvent("photo-sync-failed", { detail: { message, draftId: entry.draftId } }));
        }
        if (entry.operation === "create" && message.includes("plan_limit_reached")) {
          window.dispatchEvent(new CustomEvent("plan-limit-reached", { detail: { draftId: entry.draftId } }));
        }
        if (entry.operation === "complete") {
          window.dispatchEvent(new CustomEvent("incident-signature-error", { detail: { draftId: entry.draftId, message } }));
        }
        if (activeOwnerId === ownerId) await defer(entry);
        failed++;
      }
    }
    if (processed === 0 && failed > 0) break;
  }
}

export function processOutbox() {
  if (activeRun) return activeRun;
  activeRun = runOutbox().finally(() => { activeRun = null; });
  return activeRun;
}

export async function retryDraftSync(ownerId: string, draftId: string) {
  await assertOwner(ownerId);
  if (activeRun) await activeRun;
  await db.outbox.where("draftId").equals(draftId).filter((entry) => entry.ownerId === ownerId).modify({ attempts: 0, nextAttemptAt: Date.now() });
  await processOutbox();
}

export function startSyncWorker(ownerId: string) {
  activeOwnerId = ownerId;
  if (started) return () => { if (activeOwnerId === ownerId) activeOwnerId = null; };
  started = true;
  const sync = () => void processOutbox();
  window.addEventListener("online", sync);
  window.addEventListener("outbox-change", sync);
  const interval = window.setInterval(sync, 30_000);
  sync();
  return () => {
    activeOwnerId = null;
    started = false;
    window.removeEventListener("online", sync);
    window.removeEventListener("outbox-change", sync);
    window.clearInterval(interval);
  };
}

export function pauseSyncWorker() {
  activeOwnerId = null;
}

export async function resolveConflict(conflict: SyncConflict, choice: "local" | "server") {
  if (conflict.ownerId !== activeOwnerId) return;
  const draft = await db.drafts.get(conflict.draftId);
  if (!draft || draft.ownerId !== conflict.ownerId) return;
  if (choice === "server") {
    draft.data = { ...draft.data, [conflict.field]: conflict.serverValue };
    draft.fieldModifiedAt = { ...draft.fieldModifiedAt, [conflict.field]: new Date().toISOString() };
    if (conflict.table === "incidents") draft.ref.incidentVersion = conflict.serverVersion;
    else draft.ref.partyVersion = conflict.serverVersion;
    await db.transaction("rw", db.drafts, db.conflicts, async () => {
      await persistSyncedDraft(draft);
      await db.conflicts.delete(conflict.id);
    });
    await applyDraftFromSync(draft);
  } else {
    const modifiedAt = new Date().toISOString();
    draft.data = { ...draft.data, [conflict.field]: conflict.localValue };
    draft.fieldModifiedAt = { ...draft.fieldModifiedAt, [conflict.field]: modifiedAt };
    if (conflict.table === "incidents") draft.ref.incidentVersion = conflict.serverVersion;
    else draft.ref.partyVersion = conflict.serverVersion;
    await db.transaction("rw", db.drafts, db.outbox, db.conflicts, async () => {
      await persistSyncedDraft(draft);
      await db.outbox.add({
        id: crypto.randomUUID(), ownerId: draft.ownerId, draftId: draft.id,
        table: conflict.table, operation: "update",
        payload: { field: conflict.field, value: conflict.localValue, modifiedAt },
        version: conflict.serverVersion, device_id: deviceId,
        attempts: 0, nextAttemptAt: Date.now(), createdAt: modifiedAt,
      });
      await db.conflicts.delete(conflict.id);
    });
    await applyDraftFromSync(draft);
    requestSync();
  }
}
