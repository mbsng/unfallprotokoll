import Dexie, { type EntityTable } from "dexie";
import type { AccidentData, IncidentDraftRef, PendingPhoto } from "@/types/incident";

export type SyncTable = "incidents" | "incident_parties" | "incident_witnesses" | "incident_media";
export type SyncOperation = "create" | "update" | "upload" | "delete" | "complete";

export interface LocalDraft {
  id: string;
  ref: IncidentDraftRef;
  data: AccidentData;
  fieldModifiedAt: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPhoto {
  id: string;
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

const tableForField = (field: keyof AccidentData): SyncTable => {
  if (field === "witnesses") return "incident_witnesses";
  if (["date", "time", "location", "locationLat", "locationLng", "injured", "otherDamage", "sketchDataUrl", "hasSketch"].includes(field)) return "incidents";
  return "incident_parties";
};

const notifyDraft = (draft: LocalDraft) => window.dispatchEvent(new CustomEvent("local-draft-change", { detail: draft }));
export const requestSync = () => window.dispatchEvent(new Event("outbox-change"));

export async function createLocalDraft(data: AccidentData, joinedRef?: IncidentDraftRef) {
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
  const draft: LocalDraft = { id, ref, data, fieldModifiedAt: {}, createdAt: now, updatedAt: now };
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    await db.drafts.add(draft);
    if (!joinedRef) {
      await db.outbox.add({
        id: crypto.randomUUID(), draftId: id, table: "incidents", operation: "create",
        payload: {}, version: 0, device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
      });
    }
  });
  notifyDraft(draft);
  requestSync();
  return draft;
}

export async function saveDraftField<K extends keyof AccidentData>(draftId: string, field: K, value: AccidentData[K]) {
  const modifiedAt = new Date().toISOString();
  let updatedDraft: LocalDraft | undefined;
  await db.transaction("rw", db.drafts, db.outbox, async () => {
    const draft = await db.drafts.get(draftId);
    if (!draft) return;
    draft.data = { ...draft.data, [field]: value };
    draft.fieldModifiedAt = { ...draft.fieldModifiedAt, [field]: modifiedAt };
    draft.updatedAt = modifiedAt;
    const table = tableForField(field);
    const version = table === "incidents" ? draft.ref.incidentVersion : draft.ref.partyVersion;
    await db.drafts.put(draft);
    await db.outbox.add({
      id: crypto.randomUUID(), draftId, table, operation: "update",
      payload: { field, value, modifiedAt }, version, device_id: deviceId,
      attempts: 0, nextAttemptAt: Date.now(), createdAt: modifiedAt,
    });
    updatedDraft = draft;
  });
  if (updatedDraft) notifyDraft(updatedDraft);
  requestSync();
}

export async function saveLocalPhoto(draftId: string, file: File) {
  const draft = await db.drafts.get(draftId);
  if (!draft) return;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const photo: LocalPhoto = { id, draftId, blob: file, fileName: file.name, mimeType: file.type || "image/jpeg", lastModified: file.lastModified };
  draft.data = { ...draft.data, photos: [...draft.data.photos, { id, url: "" }] };
  draft.updatedAt = now;
  await db.transaction("rw", db.drafts, db.photos, db.outbox, async () => {
    await db.photos.add(photo);
    await db.drafts.put(draft);
    await db.outbox.add({
      id: crypto.randomUUID(), draftId, table: "incident_media", operation: "upload",
      payload: { photoId: id }, version: draft.ref.partyVersion, device_id: deviceId,
      attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
    });
  });
  notifyDraft(await hydrateDraft(draft));
  requestSync();
}

export async function deleteLocalPhoto(draftId: string, photoId: string) {
  const draft = await db.drafts.get(draftId);
  const photo = await db.photos.get(photoId);
  if (!draft) return;
  const now = new Date().toISOString();
  draft.data = { ...draft.data, photos: draft.data.photos.filter((item) => item.id !== photoId) };
  draft.updatedAt = now;
  await db.transaction("rw", db.drafts, db.photos, db.outbox, async () => {
    await db.drafts.put(draft);
    await db.photos.delete(photoId);
    await db.outbox.where("draftId").equals(draftId).filter((entry) => entry.operation === "upload" && entry.payload.photoId === photoId).delete();
    if (photo?.storagePath || photo?.mediaId) {
      await db.outbox.add({
        id: crypto.randomUUID(), draftId, table: "incident_media", operation: "delete",
        payload: { storagePath: photo.storagePath, mediaId: photo.mediaId }, version: draft.ref.partyVersion,
        device_id: deviceId, attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
      });
    }
  });
  notifyDraft(draft);
  requestSync();
}

export async function hydrateDraft(draft: LocalDraft) {
  const photos = await db.photos.where("draftId").equals(draft.id).toArray();
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const hydrated: PendingPhoto[] = draft.data.photos.map((item) => {
    const local = byId.get(item.id);
    return local ? { ...item, url: URL.createObjectURL(local.blob), storagePath: local.storagePath, mediaId: local.mediaId } : item;
  });
  return { ...draft, data: { ...draft.data, photos: hydrated } };
}

export async function getLatestDraft() {
  const draft = await db.drafts.orderBy("updatedAt").last();
  return draft ? hydrateDraft(draft) : undefined;
}

export async function markDraftComplete(draftId: string) {
  const draft = await db.drafts.get(draftId);
  if (!draft) return;
  const now = new Date().toISOString();
  await db.outbox.add({
    id: crypto.randomUUID(), draftId, table: "incident_parties", operation: "complete",
    payload: {}, version: draft.ref.partyVersion, device_id: deviceId,
    attempts: 0, nextAttemptAt: Date.now(), createdAt: now,
  });
  requestSync();
}

export async function applyDraftFromSync(draft: LocalDraft) {
  await db.drafts.put(draft);
  notifyDraft(await hydrateDraft(draft));
}
