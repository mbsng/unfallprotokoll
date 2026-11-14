import Dexie, { type EntityTable } from "dexie";
import type { AccidentData, IncidentDraftRef, PendingPhoto } from "@/types/incident";

export type SyncTable = "incidents" | "incident_parties" | "incident_witnesses" | "incident_media";
export type SyncOperation = "create" | "update" | "upload" | "delete" | "complete";

// Nature-report fields persisted in incidents.type_details.
export const NATURE_FIELDS = [
  "natureEventType", "naturePeriodFrom", "naturePeriodTo", "natureDiscoveredOn",
  "natureParking", "natureParts", "natureHailDensity", "natureHailSize",
] as const;

export const isNatureField = (field: keyof AccidentData): field is (typeof NATURE_FIELDS)[number] =>
  (NATURE_FIELDS as readonly string[]).includes(field);

export interface LocalDraft {
  id: string;
  ownerId: string;
  ref: IncidentDraftRef;
  data: AccidentData;
  fieldModifiedAt: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPhoto {
  id: string;
  ownerId: string;
  draftId: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  lastModified: number;
  storagePath?: string;
  mediaId?: string;
}

export interface OutboxEntry {
  id: string;
  ownerId: string;
  draftId: string;
  table: SyncTable;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  version: number;
  device_id: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: string;
}

export interface SyncConflict {
  id: string;
  ownerId: string;
  draftId: string;
  table: "incidents" | "incident_parties";
  field: keyof AccidentData;
  localValue: unknown;
  serverValue: unknown;
  serverVersion: number;
  createdAt: string;
}

class AccidentDatabase extends Dexie {
  drafts!: EntityTable<LocalDraft, "id">;
  photos!: EntityTable<LocalPhoto, "id">;
  outbox!: EntityTable<OutboxEntry, "id">;
  conflicts!: EntityTable<SyncConflict, "id">;

  constructor() {
    super("unfallprotokoll");
    this.version(1).stores({
      drafts: "id, ref.incidentId, updatedAt",
      photos: "id, draftId, storagePath",
      outbox: "id, draftId, nextAttemptAt, createdAt",
      conflicts: "id, draftId, createdAt",
    });
    this.version(2).stores({
      drafts: "id, ownerId, [ownerId+updatedAt], ref.incidentId, updatedAt",
      photos: "id, ownerId, draftId, [ownerId+draftId], storagePath",
      outbox: "id, ownerId, draftId, [ownerId+nextAttemptAt], nextAttemptAt, createdAt",
      conflicts: "id, ownerId, draftId, [ownerId+createdAt], createdAt",
    });
    // Legacy records without ownerId remain unassigned and inaccessible to
    // account-scoped queries; upgrading must not delete unsent evidence.
  }
}

export const db = new AccidentDatabase();

const DEVICE_KEY = "unfallprotokoll-device-id";
export const deviceId = (() => {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
})();

export const tableForField = (field: keyof AccidentData): SyncTable => {
  if (field === "witnesses") return "incident_witnesses";
  if (field === "reportType" || isNatureField(field)) return "incidents";
  if (["date", "time", "location", "locationLat", "locationLng", "injured", "otherDamage", "sketchDataUrl", "hasSketch"].includes(field)) return "incidents";
  return "incident_parties";
};

const notifyDraft = (draft: LocalDraft) => window.dispatchEvent(new CustomEvent("local-draft-change", { detail: draft }));
export const requestSync = () => window.dispatchEvent(new Event("outbox-change"));
const owns = (ownerId: string, record?: { ownerId: string }) => record?.ownerId === ownerId;

export async function createLocalDraft(ownerId: string, data: AccidentData, joinedRef?: IncidentDraftRef) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ref = joinedRef ?? {
    incidentId: `local:${id}`,
    partyId: `local-party:${id}`,
    partyLabel: "A" as const,
    shareCode: "OFFLINE",
    incidentVersion: 0,
    partyVersion: 0,
  };
  const draft: LocalDraft = { id, ownerId, ref, data, fieldModifiedAt: {}, createdAt: now, updatedAt: now };
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    await db.drafts.add(draft);
    if (!joinedRef) {
      await db.outbox.add({
        id: crypto.randomUUID(), ownerId, draftId: id, table: "incidents", operation: "create",
        payload: {}, version: 0, device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
      });
    }
  });
  notifyDraft(draft);
  requestSync();
  return draft;
}

export async function saveDraftField<K extends keyof AccidentData>(ownerId: string, draftId: string, field: K, value: AccidentData[K]) {
  let updatedDraft: LocalDraft | undefined;
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    const draft = await db.drafts.get(draftId);
    if (!owns(ownerId, draft)) throw new Error("draft_not_found");
    const previousTime = Date.parse(draft.fieldModifiedAt[field] ?? "") || 0;
    const modifiedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
    draft.data = { ...draft.data, [field]: value };
    draft.fieldModifiedAt = { ...draft.fieldModifiedAt, [field]: modifiedAt };
    draft.updatedAt = modifiedAt;
    const table = tableForField(field);
    const version = table === "incidents" ? draft.ref.incidentVersion : draft.ref.partyVersion;
    await db.drafts.put(draft);
    if (field !== "hasSignature" && field !== "signatureDataUrl") {
      await db.outbox.add({
        id: crypto.randomUUID(), ownerId, draftId, table, operation: "update",
        payload: { field, value, modifiedAt }, version, device_id: deviceId,
        attempts: 0, nextAttemptAt: Date.now(), createdAt: modifiedAt,
      });
    }
    updatedDraft = draft;
  });
  if (updatedDraft) notifyDraft(updatedDraft);
  requestSync();
}

export async function saveLocalPhoto(ownerId: string, draftId: string, file: File) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let updatedDraft: LocalDraft | undefined;
  await db.transaction("rw", db.drafts, db.photos, db.outbox, async () => {
    const draft = await db.drafts.get(draftId);
    if (!owns(ownerId, draft)) throw new Error("draft_not_found");
    await db.photos.add({ id, ownerId, draftId, blob: file, fileName: file.name, mimeType: file.type || "image/jpeg", lastModified: file.lastModified });
    draft.data = { ...draft.data, photos: [...draft.data.photos, { id, url: "" }] };
    draft.updatedAt = now;
    await db.drafts.put(draft);
    await db.outbox.add({
      id: crypto.randomUUID(), ownerId, draftId, table: "incident_media", operation: "upload",
      payload: { photoId: id }, version: draft.ref.partyVersion, device_id: deviceId,
      attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
    });
    updatedDraft = draft;
  });
  if (updatedDraft) notifyDraft(await hydrateDraft(updatedDraft));
  requestSync();
}

export async function deleteLocalPhoto(ownerId: string, draftId: string, photoId: string) {
  const now = new Date().toISOString();
  let updatedDraft: LocalDraft | undefined;
  await db.transaction("rw", db.drafts, db.photos, db.outbox, async () => {
    const draft = await db.drafts.get(draftId);
    const photo = await db.photos.get(photoId);
    if (!owns(ownerId, draft) || (photo && !owns(ownerId, photo))) throw new Error("draft_not_found");
    const item = draft.data.photos.find((item) => item.id === photoId || (photo?.storagePath && item.storagePath === photo.storagePath));
    draft.data = { ...draft.data, photos: draft.data.photos.filter((entry) => entry !== item) };
    draft.updatedAt = now;
    await db.drafts.put(draft);
    await db.photos.delete(photoId);
    await db.outbox.where("draftId").equals(draftId).filter((entry) => entry.ownerId === ownerId && entry.operation === "upload" && entry.payload.photoId === photoId).delete();
    const storagePath = photo?.storagePath ?? item?.storagePath;
    const mediaId = photo?.mediaId ?? item?.mediaId;
    if (storagePath || mediaId) {
      await db.outbox.add({
        id: crypto.randomUUID(), ownerId, draftId, table: "incident_media", operation: "delete",
        payload: { storagePath, mediaId }, version: draft.ref.partyVersion,
        device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
      });
    }
    updatedDraft = draft;
  });
  const url = localPhotoUrls.get(photoId);
  if (url) URL.revokeObjectURL(url);
  localPhotoUrls.delete(photoId);
  if (updatedDraft) notifyDraft(await hydrateDraft(updatedDraft));
  requestSync();
}

const localPhotoUrls = new Map<string, string>();

export async function hydrateDraft(draft: LocalDraft) {
  const photos = await db.photos.where("[ownerId+draftId]").equals([draft.ownerId, draft.id]).toArray();
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const byPath = new Map(photos.filter((photo) => photo.storagePath).map((photo) => [photo.storagePath, photo]));
  const hydrated: PendingPhoto[] = draft.data.photos.map((item) => {
    const local = byId.get(item.id) ?? (item.storagePath ? byPath.get(item.storagePath) : undefined);
    if (!local) return item;
    let url = localPhotoUrls.get(local.id);
    if (!url) {
      url = URL.createObjectURL(local.blob);
      localPhotoUrls.set(local.id, url);
    }
    return { ...item, id: local.id, url, storagePath: local.storagePath, mediaId: local.mediaId };
  });
  return { ...draft, data: { ...draft.data, photos: hydrated } };
}

export async function getLatestDraft(ownerId: string) {
  const drafts = await db.drafts.where("ownerId").equals(ownerId).sortBy("updatedAt");
  const draft = drafts.at(-1);
  return draft ? hydrateDraft(draft) : undefined;
}

export async function markDraftComplete(ownerId: string, draftId: string) {
  const draft = await db.drafts.get(draftId);
  if (!owns(ownerId, draft)) return null;
  const existing = await db.outbox.where("draftId").equals(draftId).filter((entry) => entry.ownerId === ownerId && entry.operation === "complete").first();
  if (existing) {
    await db.outbox.update(existing.id, { attempts: 0, nextAttemptAt: Date.now() });
    requestSync();
    return existing.id;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.outbox.add({
    id, ownerId, draftId, table: "incident_parties", operation: "complete",
    payload: {}, version: draft.ref.partyVersion, device_id: deviceId,
    attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
  });
  requestSync();
  return id;
}

export async function persistSyncedDraft(draft: LocalDraft) {
  const current = await db.drafts.get(draft.id);
  if (!current || current.ownerId !== draft.ownerId) throw new Error("draft_not_found");
  for (const field of Object.keys(current.fieldModifiedAt) as (keyof AccidentData)[]) {
    if ((current.fieldModifiedAt[field] ?? "") > (draft.fieldModifiedAt[field] ?? "")) {
      draft.data = { ...draft.data, [field]: current.data[field] };
      draft.fieldModifiedAt[field] = current.fieldModifiedAt[field];
    }
  }
  draft.data.photos = current.data.photos;
  draft.updatedAt = current.updatedAt > draft.updatedAt ? current.updatedAt : draft.updatedAt;
  await db.drafts.put(draft);
}

export async function applyDraftFromSync(draft: LocalDraft) {
  const current = await db.drafts.get(draft.id);
  if (current?.ownerId === draft.ownerId) notifyDraft(await hydrateDraft(current));
}

export async function deleteLocalDraft(ownerId: string, draftId: string) {
  await db.transaction("rw", db.drafts, db.photos, db.outbox, db.conflicts, async () => {
    const draft = await db.drafts.get(draftId);
    if (!owns(ownerId, draft)) return;
    await db.drafts.delete(draftId);
    await db.photos.where("draftId").equals(draftId).delete();
    await db.outbox.where("draftId").equals(draftId).delete();
    await db.conflicts.where("draftId").equals(draftId).delete();
  });
}

export async function clearLocalAccidentData(ownerId: string) {
  await db.transaction("rw", db.drafts, db.photos, db.outbox, db.conflicts, async () => {
    await Promise.all([
      db.drafts.where("ownerId").equals(ownerId).delete(),
      db.photos.where("ownerId").equals(ownerId).delete(),
      db.outbox.where("ownerId").equals(ownerId).delete(),
      db.conflicts.where("ownerId").equals(ownerId).delete(),
    ]);
  });
}
