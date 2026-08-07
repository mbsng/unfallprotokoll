import Dexie from "dexie";
import { supabase } from "@/integrations/supabase/client";
import { db, deviceId, applyDraftFromSync, requestSync, type LocalDraft, type OutboxEntry, type SyncConflict } from "@/lib/local-db";
import type { AccidentData } from "@/types/incident";

let activeRun: Promise<void> | null = null;
let started = false;
let activeOwnerId: string | null = null;
const processingEntries = new Set<string>();
const MAX_ATTEMPTS = 5;

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const extensionForPhoto = (mimeType: string) => {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
};

const incidentPatch = (data: AccidentData, field: keyof AccidentData) => {
  if (field === "date" || field === "time") return { occurred_at: new Date(`${data.date}T${data.time}:00`).toISOString() };
  if (["location", "locationLat", "locationLng"].includes(field)) return { location_text: data.location, location_lat: data.locationLat, location_lng: data.locationLng };
  if (field === "injured" || field === "otherDamage") return { circumstances_json: { injured: data.injured, otherDamage: data.otherDamage } };
  if (field === "sketchDataUrl" || field === "hasSketch") return { sketch_json: data.sketchDataUrl ? { storagePath: "pending" } : {} };
  return {};
};

const partyPatch = (data: AccidentData, field: keyof AccidentData) => {
  if (["driverName", "driverAddress", "phone"].includes(field)) return { driver_json: { fullName: data.driverName, address: data.driverAddress, phone: data.phone } };
  if (["plate", "vehicle"].includes(field)) return { vehicle_json: { plate: data.plate, makeModel: data.vehicle } };
  if (["insurer", "policy"].includes(field)) return { insurance_json: { company: data.insurer, policyNumber: data.policy } };
  if (field === "situations") return { circumstances_checked: data.situations };
  if (field === "damage" || field === "notes") return { damage_description: [data.damage, data.notes].filter(Boolean).join("\n\n") };
  return {};
};

function serverFields(table: "incidents" | "incident_parties", row: Record<string, unknown>, field: keyof AccidentData) {
  if (table === "incidents") {
    if (field === "date" || field === "time") {
      const date = row.occurred_at ? new Date(row.occurred_at as string) : null;
      return field === "date" ? date?.toISOString().slice(0, 10) ?? "" : date?.toTimeString().slice(0, 5) ?? "";
    }
    if (field === "location") return row.location_text ?? "";
    if (field === "locationLat") return row.location_lat ?? null;
    if (field === "locationLng") return row.location_lng ?? null;
    if (field === "injured") return Boolean((row.circumstances_json as Record<string, unknown>)?.injured);
    if (field === "otherDamage") return Boolean((row.circumstances_json as Record<string, unknown>)?.otherDamage);
    if (field === "hasSketch") return Boolean((row.sketch_json as Record<string, unknown>)?.storagePath);
    if (field === "sketchDataUrl") return "";
  } else {
    const driver = row.driver_json as Record<string, unknown>;
    const vehicle = row.vehicle_json as Record<string, unknown>;
    const insurance = row.insurance_json as Record<string, unknown>;
    if (field === "driverName") return driver?.fullName ?? "";
    if (field === "driverAddress") return driver?.address ?? "";
    if (field === "phone") return driver?.phone ?? "";
    if (field === "plate") return vehicle?.plate ?? "";
    if (field === "vehicle") return vehicle?.makeModel ?? "";
    if (field === "insurer") return insurance?.company ?? "";
    if (field === "policy") return insurance?.policyNumber ?? "";
    if (field === "situations") return row.circumstances_checked ?? [];
    if (field === "damage" || field === "notes") {
      const [damage = "", ...notes] = String(row.damage_description ?? "").split("\n\n");
      return field === "damage" ? damage : notes.join("\n\n");
    }
  }
  return undefined;
}

async function assertOwner(ownerId: string) {
  const { data } = await supabase.auth.getSession();
  if (activeOwnerId !== ownerId || data.session?.user.id !== ownerId) throw new Error("sync_owner_changed");
}

async function createRemoteDraft(draft: LocalDraft, entry: OutboxEntry) {
  await assertOwner(draft.ownerId);
  const { data, error } = await supabase.rpc("create_incident_with_party", {
    initial_driver: { fullName: draft.data.driverName, address: draft.data.driverAddress, phone: draft.data.phone },
    initial_vehicle: { plate: draft.data.plate, makeModel: draft.data.vehicle },
    initial_insurance: { company: draft.data.insurer, policyNumber: draft.data.policy },
  });
  const row = data?.[0];
  if (error || !row || !row.share_code) throw error ?? new Error("create_failed");
  draft.ref = {
    incidentId: row.incident_id,
    partyId: row.party_id,
    partyLabel: "A",
    shareCode: row.share_code,
    incidentVersion: row.incident_version,
    partyVersion: row.party_version,
  };
  const now = new Date().toISOString();
  const snapshotFields: (keyof AccidentData)[] = [
    "date", "time", "location", "locationLat", "locationLng", "injured", "otherDamage", "witnesses",
    "driverName", "driverAddress", "phone", "plate", "vehicle", "insurer", "policy", "situations", "damage", "notes",
  ];
  const snapshotEntries: OutboxEntry[] = snapshotFields.map((field, index) => {
    const table = field === "witnesses" ? "incident_witnesses" : ["date", "time", "location", "locationLat", "locationLng", "injured", "otherDamage"].includes(field) ? "incidents" : "incident_parties";
    return {
      id: crypto.randomUUID(), ownerId: draft.ownerId, draftId: draft.id, table, operation: "update",
      payload: { field, value: draft.data[field], modifiedAt: draft.fieldModifiedAt[field] ?? now },
      version: table === "incidents" ? draft.ref.incidentVersion : draft.ref.partyVersion,
      device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: new Date(Date.now() + index).toISOString(),
    };
  });
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    await db.drafts.put(draft);
    await db.outbox.delete(entry.id);
    await db.outbox.bulkAdd(snapshotEntries);
  });
  await applyDraftFromSync(draft);
  requestSync();
}

async function uploadCanvas(draft: LocalDraft, kind: "sketch" | "signature", dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${draft.ref.incidentId}/${draft.ref.partyId}/${kind}.png`;
  console.log("[sync-worker] Uploading canvas", { kind, path, size: blob.size });
  const { error } = await supabase.storage.from("incident-media").upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) {
    console.error("[sync-worker] Storage upload failed", { kind, path, error: error.message });
    throw new Error(`storage_upload_failed:${error.message}`);
  }
  const { error: mediaError } = await supabase.from("incident_media").upsert({
    incident_id: draft.ref.incidentId, party_id: draft.ref.partyId, storage_path: path,
    kind: kind === "sketch" ? "sketch" : "document",
  }, { onConflict: "storage_path" });
  if (mediaError) {
    console.error("[sync-worker] Media DB insert failed", { kind, path, error: mediaError.message });
    throw new Error(`media_db_failed:${mediaError.message}`);
  }
  console.log("[sync-worker] Canvas uploaded successfully", { kind, path });
  return path;
}

async function writeVersioned(draft: LocalDraft, entry: OutboxEntry) {
  const field = entry.payload.field as keyof AccidentData;
  const table = entry.table as "incidents" | "incident_parties";
  const id = table === "incidents" ? draft.ref.incidentId : draft.ref.partyId;
  let version = table === "incidents" ? draft.ref.incidentVersion : draft.ref.partyVersion;
  let patch = table === "incidents" ? incidentPatch(draft.data, field) : partyPatch(draft.data, field);

  if (table === "incidents" && (field === "sketchDataUrl" || field === "hasSketch") && draft.data.sketchDataUrl) {
    // Only upload if not already uploaded for this entry (avoid re-upload on retry)
    const cachedPath = entry.payload.storagePath as string | undefined;
    const storagePath = cachedPath ?? await uploadCanvas(draft, "sketch", draft.data.sketchDataUrl);
    await db.outbox.update(entry.id, { payload: { ...entry.payload, storagePath } });
    patch = { sketch_json: { storagePath } };
  }
  if (!Object.keys(patch).length) {
    await db.outbox.delete(entry.id);
    return;
  }

  const attemptUpdate = async (baseVersion: number, values: Record<string, unknown>) => supabase
    .from(table).update({ ...values, version: baseVersion + 1, updated_at: new Date().toISOString() })
    .eq("id", id).eq("version", baseVersion).select("version").maybeSingle();

  let result = await attemptUpdate(version, patch);
  if (result.error) throw result.error;
  if (!result.data) {
    const { data: server, error } = await supabase.from(table).select("*").eq("id", id).single();
    if (error) throw error;
    const serverValue = serverFields(table, server, field);
    const localValue = draft.data[field];
    if (sameValue(serverValue, localValue)) {
      version = server.version;
    } else {
      const localTime = new Date(draft.fieldModifiedAt[field] ?? entry.createdAt).getTime();
      const serverTime = new Date(server.updated_at).getTime();
      if (Math.abs(localTime - serverTime) < 1000) {
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
    await db.drafts.put(draft);
    await db.outbox.delete(entry.id);
  });
  await applyDraftFromSync(draft);
}

async function replaceWitness(draft: LocalDraft, entry: OutboxEntry) {
  const { error: deleteError } = await supabase.from("incident_witnesses").delete().eq("incident_id", draft.ref.incidentId);
  if (deleteError) throw deleteError;
  if (draft.data.witnesses.trim()) {
    const { error } = await supabase.from("incident_witnesses").insert({ incident_id: draft.ref.incidentId, name: draft.data.witnesses.trim(), contact: null });
    if (error) throw error;
  }
  await db.outbox.delete(entry.id);
}

async function syncMedia(draft: LocalDraft, entry: OutboxEntry) {
  if (entry.operation === "delete") {
    const path = entry.payload.storagePath as string | undefined;
    const mediaId = entry.payload.mediaId as string | undefined;
    if (path) {
      const { error } = await supabase.storage.from("incident-media").remove([path]);
      if (error) throw error;
    }
    if (mediaId) {
      const { error } = await supabase.from("incident_media").delete().eq("id", mediaId);
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
  const { error } = await supabase.storage.from("incident-media").upload(path, photo.blob, { upsert: true, contentType: photo.mimeType });
  if (error) throw error;
  const { data: media, error: mediaError } = await supabase.from("incident_media").upsert({
    incident_id: draft.ref.incidentId, party_id: draft.ref.partyId, storage_path: path,
    kind: "photo", taken_at: new Date(photo.lastModified).toISOString(),
  }, { onConflict: "storage_path" }).select("id").single();
  if (mediaError) throw mediaError;
  await db.transaction("rw", db.photos, db.outbox, async () => {
    await db.photos.update(photoId, { storagePath: path, mediaId: media.id });
    await db.outbox.delete(entry.id);
  });
}

async function completeDraft(draft: LocalDraft, entry: OutboxEntry) {
  if (!draft.data.signatureDataUrl) throw new Error("signature_missing");

  const partyId = draft.ref.partyId;
  console.log("[sync-worker] completeDraft starting", { partyId, incidentId: draft.ref.incidentId, draftId: draft.id });

  // Step 1: Upload signature PNG to storage as a Blob
  const dataUrl = draft.data.signatureDataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const storagePath = `${draft.ref.incidentId}/${partyId}/signature.png`;
  console.log("[sync-worker] Uploading signature", { storagePath, blobSize: blob.size, blobType: blob.type });

  const { error: uploadError } = await supabase.storage
    .from("incident-media")
    .upload(storagePath, blob, { upsert: true, contentType: "image/png" });
  if (uploadError) {
    console.error("[sync-worker] Signature storage upload FAILED", { storagePath, error: uploadError.message });
    throw new Error(`signature_upload_failed:${uploadError.message}`);
  }
  console.log("[sync-worker] Signature storage upload succeeded", { storagePath });

  // Step 2: Fetch current version of the party row
  const { data: currentParty, error: fetchError } = await supabase
    .from("incident_parties")
    .select("version, signed_at, signature_storage_path")
    .eq("id", partyId)
    .maybeSingle();

  if (fetchError) {
    console.error("[sync-worker] Failed to fetch party row for signing", { partyId, error: fetchError.message });
    throw new Error(`party_fetch_failed:${fetchError.message}`);
  }
  if (!currentParty) {
    console.error("[sync-worker] Party row not found", { partyId });
    throw new Error("party_not_found");
  }
  console.log("[sync-worker] Current party state", { partyId, version: currentParty.version, signedAt: currentParty.signed_at });

  // Already signed — idempotent success
  if (currentParty.signed_at && currentParty.signature_storage_path === storagePath) {
    console.log("[sync-worker] Party already signed with same path, treating as success", { partyId });
    draft.ref = { ...draft.ref, partyVersion: currentParty.version };
    await db.transaction("rw", db.drafts, db.outbox, async () => {
      await db.drafts.put(draft);
      await db.outbox.delete(entry.id);
    });
    await applyDraftFromSync(draft);
    window.dispatchEvent(new CustomEvent("incident-signature-synced", { detail: { draftId: draft.id, incidentId: draft.ref.incidentId } }));
    return;
  }

  // Step 3: Update incident_parties with signed_at and signature_storage_path
  const signedAt = new Date().toISOString();
  const updatePayload = {
    signature_storage_path: storagePath,
    signed_at: signedAt,
    version: currentParty.version + 1,
    updated_at: signedAt,
  };
  console.log("[sync-worker] Updating party row", { partyId, targetVersion: currentParty.version, newVersion: currentParty.version + 1, updatePayload });

  const { data: updatedRow, error: updateError } = await supabase
    .from("incident_parties")
    .update(updatePayload)
    .eq("id", partyId)
    .eq("version", currentParty.version)
    .select("version, signed_at, signature_storage_path")
    .maybeSingle();

  if (updateError) {
    console.error("[sync-worker] Party UPDATE returned error", { partyId, error: updateError.message, code: updateError.code });
    throw new Error(`party_update_failed:${updateError.message}`);
  }
  if (!updatedRow) {
    console.error("[sync-worker] Party UPDATE affected 0 rows — version conflict or RLS blocked", {
      partyId, attemptedVersion: currentParty.version,
    });
    throw new Error("party_update_zero_rows");
  }

  // Step 4: Success — persist to local DB and remove outbox entry
  console.log("[sync-worker] signature row updated SUCCESSFULLY", { partyId, version: updatedRow.version, signedAt: updatedRow.signed_at, storagePath: updatedRow.signature_storage_path });
  draft.ref = { ...draft.ref, partyVersion: updatedRow.version };
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    await db.drafts.put(draft);
    await db.outbox.delete(entry.id);
  });
  await applyDraftFromSync(draft);
  window.dispatchEvent(new CustomEvent("incident-signature-synced", { detail: { draftId: draft.id, incidentId: draft.ref.incidentId } }));
  console.log("[sync-worker] completeDraft finished successfully", { partyId });
}

async function processEntry(entry: OutboxEntry) {
  if (entry.ownerId !== activeOwnerId) return;
  if (processingEntries.has(entry.id)) return;
  if (entry.attempts >= MAX_ATTEMPTS) {
    console.error("[sync-worker] Entry exceeded max attempts, marking as failed", { id: entry.id, operation: entry.operation, attempts: entry.attempts });
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
    if (entry.table === "incident_media") return await syncMedia(draft, entry);
    if (entry.table === "incident_witnesses") return await replaceWitness(draft, entry);
    // Signatures are now handled directly by the UI, not through the outbox
    if (entry.operation === "complete") {
      console.log("[sync-worker] Removing stale 'complete' outbox entry — signatures are now direct");
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
        if (entry.operation === "create" && message.includes("plan_limit_reached")) {
          window.dispatchEvent(new CustomEvent("plan-limit-reached", { detail: { draftId: entry.draftId } }));
        }
        if (entry.operation === "complete") {
          window.dispatchEvent(new CustomEvent("incident-signature-error", { detail: { draftId: entry.draftId, message } }));
        }
        if (activeOwnerId === ownerId) await defer(entry);
        failed++;
        // Continue to next entry instead of returning — one failed entry must not block others
      }
    }
    // If every entry failed, stop to avoid a busy loop
    if (processed === 0 && failed > 0) break;
  }
}

export function processOutbox() {
  if (activeRun) return activeRun;
  activeRun = runOutbox().finally(() => { activeRun = null; });
  return activeRun;
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
      await db.drafts.put(draft);
      await db.conflicts.delete(conflict.id);
    });
    await applyDraftFromSync(draft);
  } else {
    const now = new Date().toISOString();
    const version = conflict.serverVersion;
    await db.transaction("rw", db.outbox, db.conflicts, async () => {
      await db.outbox.add({
        id: crypto.randomUUID(), ownerId: draft.ownerId, draftId: draft.id, table: conflict.table, operation: "update",
        payload: { field: conflict.field, value: conflict.localValue, modifiedAt: now }, version,
        device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
      });
      await db.conflicts.delete(conflict.id);
    });
    requestSync();
  }
}
