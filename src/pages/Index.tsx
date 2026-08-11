import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";

import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Car, Check, CheckCircle2, ChevronRight, Clock3, Download, FileText, LocateFixed, Mail, MapPin, PenLine, Plus, QrCode, Radio, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2, UserRound, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawingCanvas } from "@/components/DrawingCanvas";
import { InviteParty } from "@/components/InviteParty";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ScenarioBuilder } from "@/components/ScenarioBuilder";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { localeForLanguage } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getPlanEntitlement } from "@/lib/billing";
import { computeCaseStatus, loadIncidentSummary, loadUserIncidents, subscribeToIncident, subscribeToUserIncidents } from "@/lib/incidents";
import { createLocalDraft, db, deleteLocalDraft, deleteLocalPhoto, getLatestDraft, markDraftComplete, saveDraftField, saveLocalPhoto, type LocalDraft } from "@/lib/local-db";
import { captureAccidentPhoto, getCurrentCoordinates, isNativeApp } from "@/lib/native-device";
import { processOutbox } from "@/lib/sync-worker";
import { generateIncidentPdf, SubmissionError, submitIncident } from "@/lib/submissions";

import type { AccidentData, IncidentDraftRef, IncidentPartySummary, IncidentSummaryData, JoinedIncidentState, PendingPhoto } from "@/types/incident";
import type { CaseStatus, UserIncidentItem } from "@/types/incident";

import type { Profile } from "@/types/profile";

interface CaseItem { id: string; date: string; time: string; location: string; plate: string; incidentId: string; partyId: string; partyLabel: "A" | "B"; shareCode: string; caseStatus: CaseStatus }

const emptyData = (profile?: Profile | null): AccidentData => {
  const now = new Date();
  return { date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5), location: "", locationLat: null, locationLng: null, injured: false, otherDamage: false, witnesses: "", driverName: profile?.full_name ?? "", driverAddress: "", phone: profile?.phone ?? "", plate: profile?.default_vehicle_json?.plate ?? "", vehicle: profile?.default_vehicle_json?.makeModel ?? "", insurer: profile?.insurance_json?.company ?? "", policy: profile?.insurance_json?.policyNumber ?? "", situations: [], damage: "", notes: "", photos: [], hasSketch: false, sketchDataUrl: "", hasSignature: false, signatureDataUrl: "" };
};

const joinedData = (joined: JoinedIncidentState, profile?: Profile | null): AccidentData => {
  const data = emptyData(profile);
  if (joined.incident.occurredAt) {
    const occurredAt = new Date(joined.incident.occurredAt);
    data.date = `${occurredAt.getFullYear()}-${String(occurredAt.getMonth() + 1).padStart(2, "0")}-${String(occurredAt.getDate()).padStart(2, "0")}`;
    data.time = `${String(occurredAt.getHours()).padStart(2, "0")}:${String(occurredAt.getMinutes()).padStart(2, "0")}`;
  }
  data.location = joined.incident.locationText ?? "";
  return data;
};

const summaryToData = (summary: IncidentSummaryData, ownParty: IncidentPartySummary, profile?: Profile | null): AccidentData => {
  const data = emptyData(profile);
  if (summary.occurredAt) {
    const occurredAt = new Date(summary.occurredAt);
    data.date = `${occurredAt.getFullYear()}-${String(occurredAt.getMonth() + 1).padStart(2, "0")}-${String(occurredAt.getDate()).padStart(2, "0")}`;
    data.time = `${String(occurredAt.getHours()).padStart(2, "0")}:${String(occurredAt.getMinutes()).padStart(2, "0")}`;
  }
  data.location = summary.locationText ?? "";
  data.driverName = ownParty.driver.fullName ?? "";
  data.driverAddress = ownParty.driver.address ?? "";
  data.phone = ownParty.driver.phone ?? "";
  data.plate = ownParty.vehicle.plate ?? "";
  data.vehicle = ownParty.vehicle.makeModel ?? "";
  data.insurer = ownParty.insurance.company ?? "";
  data.policy = ownParty.insurance.policyNumber ?? "";
  data.damage = ownParty.damageDescription ?? "";
  data.situations = ownParty.circumstancesChecked ?? [];
  data.hasSignature = Boolean(ownParty.signedAt);
  return data;
};

const hasText = (value?: string | null) => Boolean(value?.trim());
const partyRequiredFieldsComplete = (party: IncidentPartySummary) =>
  hasText(party.driver.fullName) && hasText(party.driver.address) && hasText(party.driver.phone)
  && hasText(party.vehicle.plate) && hasText(party.vehicle.makeModel)
  && hasText(party.insurance.company) && hasText(party.insurance.policyNumber)
  && hasText(party.damageDescription);

const fieldClass = "h-12 rounded-xl border-slate-200 bg-white text-base focus-visible:ring-[#153B66]";

const statusColors: Record<CaseStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  waiting: "bg-amber-100 text-amber-800",
  action_needed: "bg-orange-100 text-orange-900 ring-2 ring-orange-300",
  signed: "bg-emerald-100 text-emerald-700",
  submitted: "bg-blue-100 text-blue-700",
};

const toCaseItem = (item: UserIncidentItem): CaseItem => {
  const occurredAt = item.occurredAt ? new Date(item.occurredAt) : new Date();
  return {
    id: item.incidentId,
    incidentId: item.incidentId,
    partyId: item.partyId,
    partyLabel: item.partyLabel,
    shareCode: item.shareCode,
    date: occurredAt.toISOString().slice(0, 10),
    time: occurredAt.toTimeString().slice(0, 5),
    location: item.locationText ?? "",
    plate: item.plate ?? "",
    caseStatus: computeCaseStatus(item),
  };
};

export default function Index() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const joinedIncident = (location.state as { joinedIncident?: JoinedIncidentState } | null)?.joinedIncident;
  const { user, profile, isAnonymous, startAnonymous } = useAuth();

  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const steps = t("wizard.steps", { returnObjects: true }) as string[];
  const titles = t("wizard.titles", { returnObjects: true }) as string[];
  const descriptions = t("wizard.descriptions", { returnObjects: true }) as string[];
  const circumstances = t("circumstances.items", { returnObjects: true }) as string[];
  const [view, setView] = useState<"home" | "wizard" | "signed">(joinedIncident ? "wizard" : "home");
  const [step, setStep] = useState(joinedIncident ? 1 : 0);
  const [data, setData] = useState<AccidentData>(() => joinedIncident ? joinedData(joinedIncident, profile) : emptyData(profile));
  const [draftRef, setDraftRef] = useState<IncidentDraftRef | null>(joinedIncident?.draftRef ?? null);
  const [localDraftId, setLocalDraftId] = useState<string | null>(null);

  const [parties, setParties] = useState<IncidentPartySummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState(navigator.onLine);
  const [liveUpdatesActive, setLiveUpdatesActive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [signedJustNow, setSignedJustNow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [serverCases, setServerCases] = useState<UserIncidentItem[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState(false);
  const [ensuringServerCase, setEnsuringServerCase] = useState(false);
  const [caseLoading, setCaseLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CaseItem | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [sketchMode, setSketchMode] = useState<"builder" | "freehand">("builder");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const localDrafts = useLiveQuery(
    () => user ? db.drafts.where("ownerId").equals(user.id).reverse().sortBy("updatedAt") : [],
    [user?.id],
    [] as LocalDraft[],
  );

  const applyLocalDraft = (draft: LocalDraft) => {
    setLocalDraftId(draft.id);
    setDraftRef(draft.ref);
    setData(draft.data);
  };

  const update = <K extends keyof AccidentData>(key: K, value: AccidentData[K]) => {
    setDirty(true);
    setData((previous) => ({ ...previous, [key]: value }));
    if (user && localDraftId) void saveDraftField(user.id, localDraftId, key, value);
  };

  const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);

  const formatCaseDate = (item: { date: string; time: string }) => {
    const date = new Date(`${item.date}T${item.time}:00`);
    if (isNaN(date.getTime())) return "";
    return `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" }).format(date)} · ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)}`;
  };

  useEffect(() => {
    let active = true;
    if (!user) {
      setLocalDraftId(null);
      setDraftRef(null);
      setView("home");
      return;
    }
    void getLatestDraft(user.id).then(async (latest) => {
      if (!active) return;
      if (joinedIncident && latest?.ref.partyId !== joinedIncident.draftRef.partyId) {
        const created = await createLocalDraft(user.id, joinedData(joinedIncident, profile), joinedIncident.draftRef);
        if (active) applyLocalDraft(created);
      } else if (latest) {
        applyLocalDraft(latest);
      }
    });
    const onDraftChange = (event: Event) => {
      const draft = (event as CustomEvent<LocalDraft>).detail;
      if (draft.ownerId === user.id && draft.id === localDraftId) applyLocalDraft(draft);
    };
    window.addEventListener("local-draft-change", onDraftChange);
    return () => {
      active = false;
      window.removeEventListener("local-draft-change", onDraftChange);
    };
  }, [user?.id, joinedIncident?.draftRef.partyId]);

  useEffect(() => {
    // Independent connectivity check — NOT tied to Realtime channel status
    let active = true;
    const check = async () => {
      if (!navigator.onLine) { if (active) setServerOnline(false); return; }
      try {
        const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).limit(1);
        if (active) setServerOnline(!error);
      } catch { if (active) setServerOnline(false); }
    };
    void check();
    const interval = window.setInterval(check, 30_000);
    const handleOnline = () => void check();
    const handleOffline = () => { if (active) setServerOnline(false); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, []);

  useEffect(() => {
    const showUpgrade = () => navigate("/upgrade?reason=limit");
    window.addEventListener("plan-limit-reached", showUpgrade);
    return () => window.removeEventListener("plan-limit-reached", showUpgrade);
  }, [navigate]);

  useEffect(() => {
    if (view !== "wizard" || !draftRef || draftRef.incidentId.startsWith("local:")) return;

    let active = true;
    let refreshing = false;
    let refreshQueued = false;
    setSummaryLoading(true);

    const refreshIncident = async () => {
      if (refreshing) { refreshQueued = true; return; }
      refreshing = true;
      try {
        const summary = await loadIncidentSummary(draftRef);
        if (!active) return;
        setParties(summary.parties);
        setDraftRef((current) => {
          if (!current) return current;
          const ownParty = summary.parties.find((party) => party.id === current.partyId);
          return { ...current, incidentVersion: summary.incidentVersion, partyVersion: ownParty?.version ?? current.partyVersion };
        });
      } catch {
        /* offline or error — local data still usable */
      } finally {
        refreshing = false;
        if (active) setSummaryLoading(false);
        if (active && refreshQueued) { refreshQueued = false; void refreshIncident(); }
      }
    };

    void refreshIncident();
    const unsubscribe = subscribeToIncident(draftRef.incidentId, () => void refreshIncident(), (status) => {
      if (active) setLiveUpdatesActive(status === "connected");
    });
    return () => { active = false; unsubscribe(); };
  }, [view, draftRef?.incidentId]);

  useEffect(() => {
    if (view !== "home" || !user) return;
    let active = true;
    const loadCases = async () => {
      setCasesLoading(true);
      setCasesError(false);
      try {
        const cases = await loadUserIncidents(user.id);
        if (active) setServerCases(cases);
      } catch {
        if (active) setCasesError(true);
      } finally {
        if (active) setCasesLoading(false);
      }
    };
    void loadCases();
    const unsubscribe = subscribeToUserIncidents(() => { if (active) void loadCases(); });
    return () => { active = false; unsubscribe(); };
  }, [view, user?.id, signedJustNow]);

  const allCases = useMemo<CaseItem[]>(() => {
    const items = serverCases.map(toCaseItem);
    for (const draft of localDrafts ?? []) {
      if (draft.ref.incidentId.startsWith("local:") && !items.some((item) => item.incidentId === draft.ref.incidentId)) {
        items.unshift({
          id: draft.id, incidentId: draft.ref.incidentId, partyId: draft.ref.partyId, partyLabel: draft.ref.partyLabel,
          shareCode: draft.ref.shareCode, date: draft.data.date, time: draft.data.time,
          location: draft.data.location, plate: draft.data.plate, caseStatus: "draft",
        });
      }
    }
    return items.sort((a, b) => {
      if (a.caseStatus === "action_needed" && b.caseStatus !== "action_needed") return -1;
      if (b.caseStatus === "action_needed" && a.caseStatus !== "action_needed") return 1;
      return new Date(`${b.date}T${b.time}`).getTime() - new Date(`${a.date}T${a.time}`).getTime();
    });
  }, [serverCases, localDrafts]);

  useEffect(() => {
    if (step !== 5 || !draftRef || !draftRef.incidentId.startsWith("local:") || !user || !localDraftId || ensuringServerCase) return;
    if (!serverOnline) return;
    let active = true;
    setEnsuringServerCase(true);
    const timeout = window.setTimeout(() => {
      if (active && ensuringServerCase) {
        console.warn("[step5] Server case sync timed out after 15s");
        setEnsuringServerCase(false);
      }
    }, 15_000);
    void processOutbox().then(() => {
      if (active) { window.clearTimeout(timeout); setEnsuringServerCase(false); }
    }).catch(() => {
      if (active) { window.clearTimeout(timeout); setEnsuringServerCase(false); }
    });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [step, draftRef?.incidentId, user?.id, localDraftId, ensuringServerCase, serverOnline]);

  const retrySync = async () => {
    if (!navigator.onLine || !user) return;
    setEnsuringServerCase(true);
    try {
      await processOutbox();
      await refreshFromServer();
    } catch {
      toast.error(t("incident.saveError"));
    } finally {
      setEnsuringServerCase(false);
    }
  };

  const saveSketch = async (dataUrl: string) => {
    if (!draftRef || draftRef.incidentId.startsWith("local:") || !user) {
      update("hasSketch", true);
      update("sketchDataUrl", dataUrl);
      return;
    }
    try {
      const { error } = await supabase.from("incidents")
        .update({ sketch_data_url: dataUrl, sketch_updated_by: user.id, sketch_updated_at: new Date().toISOString() })
        .eq("id", draftRef.incidentId);
      if (error) throw error;
      update("hasSketch", true);
      update("sketchDataUrl", dataUrl);
      await refreshFromServer();
    } catch {
      update("hasSketch", true);
      update("sketchDataUrl", dataUrl);
    }
  };

  const confirmSketch = async () => {
    if (!draftRef || !user || draftRef.incidentId.startsWith("local:")) return;
    try {
      const { error } = await supabase.from("incident_parties")
        .update({ sketch_confirmed_at: new Date().toISOString() })
        .eq("id", draftRef.partyId);
      if (error) throw error;
      await refreshFromServer();
      toast.success(t("sketch.confirmed"));
    } catch {
      toast.error(t("incident.saveError"));
    }
  };

  const refreshFromServer = async () => {
    if (!draftRef || draftRef.incidentId.startsWith("local:")) return;
    setSummaryLoading(true);
    try {
      const summary = await loadIncidentSummary(draftRef);
      setParties(summary.parties);
      setDraftRef((current) => {
        if (!current) return current;
        const ownParty = summary.parties.find((party) => party.id === current.partyId);
        return { ...current, incidentVersion: summary.incidentVersion, partyVersion: ownParty?.version ?? current.partyVersion };
      });
    } catch { /* offline or error */ } finally {
      setSummaryLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !user) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      if (target.incidentId.startsWith("local:")) {
        await deleteLocalDraft(user.id, target.id);
      } else if (target.partyLabel === "A") {
        const { error } = await supabase.from("incidents").delete().eq("id", target.incidentId);
        if (error) throw error;
        await deleteLocalDraft(user.id, localDrafts?.find((d) => d.ref.incidentId === target.incidentId)?.id ?? "");
      } else {
        const { error } = await supabase.from("incident_parties").delete().eq("id", target.partyId);
        if (error) throw error;
        const localId = localDrafts?.find((d) => d.ref.incidentId === target.incidentId)?.id;
        if (localId) await deleteLocalDraft(user.id, localId);
      }
      setServerCases((prev) => prev.filter((c) => c.incidentId !== target.incidentId));
      toast.success(t(target.partyLabel === "A" ? "delete.caseDeleted" : "delete.participationRemoved"));
    } catch {
      toast.error(t("incident.saveError"));
    }
  };

  const withdrawSignature = async () => {
    setWithdrawOpen(false);
    if (!user || !draftRef || !localDraftId) return;
    try {
      update("hasSignature", false);
      update("signatureDataUrl", "");
      if (!draftRef.incidentId.startsWith("local:")) {
        const { error } = await supabase.from("incident_parties")
          .update({ signed_at: null, signature_storage_path: null, version: draftRef.partyVersion + 1, updated_at: new Date().toISOString() })
          .eq("id", draftRef.partyId)
          .eq("version", draftRef.partyVersion);
        if (error) throw error;
        await refreshFromServer();
      }
      toast.success(t("signature.withdrawn"));
    } catch {
      toast.error(t("incident.saveError"));
    }
  };

  const startAccident = async () => {
    if (creating) return;
    setCreating(true);
    const initial = emptyData(profile);
    try {
      let ownerId = user?.id;
      if (!ownerId) {
        if (!navigator.onLine || !(await startAnonymous())) throw new Error("authentication_required");
        ownerId = (await supabase.auth.getUser()).data.user?.id;
      }
      if (!ownerId) throw new Error("authentication_required");
      if (navigator.onLine) {
        const entitlement = await getPlanEntitlement();
        if (!entitlement.canCreate) {
          navigate("/upgrade?reason=limit");
          return;
        }
      }
      const created = await createLocalDraft(ownerId, initial);
      applyLocalDraft(created);
      setParties([]);
      setLiveUpdatesActive(false);
      setDirty(false);
      setSignedJustNow(false);
      setStep(0);
      setView("wizard");
      window.scrollTo(0, 0);
    } catch {
      toast.error(t("incident.createError"));
    } finally {
      setCreating(false);
    }
  };

  const openCase = async (item: CaseItem, requestedStep?: number) => {
    if (item.incidentId.startsWith("local:")) {
      const draft = localDrafts?.find((d) => d.id === item.id);
      if (draft) {
        applyLocalDraft(draft);
        setStep(requestedStep ?? 0);
        setSignedJustNow(false);
        setView("wizard");
        window.scrollTo(0, 0);
      }
      return;
    }
    setCaseLoading(true);
    try {
      const ref: IncidentDraftRef = {
        incidentId: item.incidentId, partyId: item.partyId, partyLabel: item.partyLabel,
        shareCode: item.shareCode, incidentVersion: 0, partyVersion: 0,
      };
      const summary = await loadIncidentSummary(ref);
      const ownParty = summary.parties.find((p) => p.id === item.partyId);
      if (!ownParty) throw new Error("party_not_found");
      const serverData = summaryToData(summary, ownParty, profile);
      const existingDraft = localDrafts?.find((d) => d.ref.incidentId === item.incidentId);
      let draft: LocalDraft;
      if (existingDraft) {
        draft = existingDraft;
        draft.ref = { ...ref, incidentVersion: summary.incidentVersion, partyVersion: ownParty.version };
        draft.data = { ...draft.data, ...serverData };
      } else {
        draft = await createLocalDraft(user!.id, serverData, { ...ref, incidentVersion: summary.incidentVersion, partyVersion: ownParty.version });
      }
      applyLocalDraft(draft);
      setParties(summary.parties);
      // Determine entry step: use requested step, or find first incomplete step
      const entryStep = requestedStep ?? (ownParty.signedAt ? 5 : 0);
      setStep(entryStep);
      setSignedJustNow(false);
      setView("wizard");
      window.scrollTo(0, 0);
    } catch {
      toast.error(t("incident.saveError"));
    } finally {
      setCaseLoading(false);
    }
  };

  const back = () => { if (step === 0) setView("home"); else { setStep((value) => value - 1); window.scrollTo(0, 0); } };

  const next = async () => {
    if (step === 0 && !data.date) return toast.error(t("validation.dateRequired"));
    if (step === 0 && !data.location.trim()) return toast.error(t("validation.locationRequired"));
    if (step === 1 && ![data.driverName, data.driverAddress, data.phone, data.plate, data.vehicle, data.insurer, data.policy].every(hasText)) return toast.error(t("validation.requiredFields"));
    if (step === 3 && !hasText(data.damage)) return toast.error(t("validation.damageRequired"));
    setDirty(false);
    toast.success(t("incident.saved"));
    setStep((value) => Math.min(value + 1, 5));
    window.scrollTo(0, 0);
  };

  const locate = async () => {
    setLocating(true);
    try {
      const coords = await getCurrentCoordinates();
      const loc = `${coords.latitude.toLocaleString(locale, { maximumFractionDigits: 5 })}, ${coords.longitude.toLocaleString(locale, { maximumFractionDigits: 5 })}`;
      update("location", loc);
      update("locationLat", coords.latitude);
      update("locationLng", coords.longitude);
      toast.success(t("location.success"));
    } catch (error) {
      toast.error(error instanceof Error && error.message === "location_unsupported" ? t("location.unsupported") : t("location.error"));
    } finally {
      setLocating(false);
    }
  };

  const addPhotos = (files: FileList | null) => {
    if (!files || !user || !localDraftId) return;
    for (const file of Array.from(files)) void saveLocalPhoto(user.id, localDraftId, file);
  };

  const takePhoto = async () => {
    if (!isNativeApp()) { photoInputRef.current?.click(); return; }
    if (!user || !localDraftId) return;
    try {
      const file = await captureAccidentPhoto();
      if (file) await saveLocalPhoto(user.id, localDraftId, file);
    } catch { toast.error(t("incident.saveError")); }
  };

  const removePhoto = async (photo: PendingPhoto) => {
    if (!user || !localDraftId) return;
    try { await deleteLocalPhoto(user.id, localDraftId, photo.id); } catch { toast.error(t("incident.saveError")); }
  };

  const ownRequiredFieldsComplete = [data.driverName, data.driverAddress, data.phone, data.plate, data.vehicle, data.insurer, data.policy, data.damage].every(hasText);
  const ownParty = parties.find((party) => party.id === draftRef?.partyId);
  const counterpart = parties.find((party) => party.id !== draftRef?.partyId);
  const alreadySigned = Boolean(ownParty?.signedAt || data.hasSignature);
  const hasMultiParty = parties.length > 1;

  const missingRequiredFields = useMemo(() => {
    const fields: { key: string; step: number }[] = [];
    if (!hasText(data.driverName)) fields.push({ key: "fields.fullName", step: 1 });
    if (!hasText(data.driverAddress)) fields.push({ key: "fields.address", step: 1 });
    if (!hasText(data.phone)) fields.push({ key: "fields.phone", step: 1 });
    if (!hasText(data.plate)) fields.push({ key: "fields.plate", step: 1 });
    if (!hasText(data.vehicle)) fields.push({ key: "fields.vehicle", step: 1 });
    if (!hasText(data.insurer)) fields.push({ key: "fields.insurer", step: 1 });
    if (!hasText(data.policy)) fields.push({ key: "fields.policy", step: 1 });
    if (!hasText(data.damage)) fields.push({ key: "fields.visibleDamage", step: 3 });
    return fields;
  }, [data]);

  const complete = async () => {
    if (!ownRequiredFieldsComplete) return;
    if (!data.hasSignature || !data.signatureDataUrl) return toast.error(t("validation.signatureRequired"));
    if (!user || !draftRef || !localDraftId || saving) return;
    if (!serverOnline || draftRef.incidentId.startsWith("local:")) {
      toast.error(t("signature.onlineRequired"));
      return;
    }
    setSaving(true);
    try {
      const partyId = draftRef.partyId;
      const incidentId = draftRef.incidentId;
      console.log("[complete] Starting direct signature save", { partyId, incidentId });

      // Step a: Canvas as PNG-Blob
      const blob = await (await fetch(data.signatureDataUrl)).blob();
      console.log("[complete] Step a: Blob created", { size: blob.size, type: blob.type });

      // Step b: Upload to Storage
      const storagePath = `${incidentId}/${partyId}/signature.png`;
      const { error: uploadError } = await supabase.storage.from("incident-media").upload(storagePath, blob, { upsert: true, contentType: "image/png" });
      if (uploadError) {
        console.error("[complete] Step b FAILED: Storage upload", { storagePath, error: uploadError.message });
        throw new Error(`upload:${uploadError.message}`);
      }
      console.log("[complete] Step b: Storage upload succeeded", { storagePath });

      // Step c-d: Update incident_parties WITHOUT version check (RLS protects ownership)
      const signedAt = new Date().toISOString();
      console.log("[complete] Step c: Updating DB", { partyId, storagePath, signedAt });

      const { data: updated, error: updateError } = await supabase.from("incident_parties")
        .update({ signature_storage_path: storagePath, signed_at: signedAt, updated_at: signedAt })
        .eq("id", partyId)
        .select("id, version, signed_at, signature_storage_path");

      if (updateError) {
        console.error("[complete] Step c FAILED: DB update error", { partyId, error: updateError.message, code: updateError.code });
        throw new Error(`db:${updateError.message}`);
      }
      console.log("[complete] Step c: DB update returned", { rowCount: updated?.length, data: updated });

      // Step e: Verify exactly one row returned
      if (!updated || updated.length === 0) {
        console.error("[complete] Step e FAILED: 0 rows affected — RLS blocked the update", { partyId });
        throw new Error("zero_rows_rls_blocked");
      }

      const updatedRow = updated[0];
      console.log("[complete] Step e: Verified — signature saved", { partyId, version: updatedRow.version, signedAt: updatedRow.signed_at, path: updatedRow.signature_storage_path });

      // Step f: Update local Dexie copy
      if (localDraftId) {
        const draft = await db.drafts.get(localDraftId);
        if (draft) {
          draft.ref = { ...draft.ref, partyVersion: updatedRow.version };
          draft.data.hasSignature = true;
          await db.drafts.put(draft);
        }
      }

      // Step g: Reload from server
      const summary = await loadIncidentSummary(draftRef);
      setParties(summary.parties);
      const ownPartyAfter = summary.parties.find((p) => p.id === partyId);
      setDraftRef((current) => current ? { ...current, incidentVersion: summary.incidentVersion, partyVersion: ownPartyAfter?.version ?? current.partyVersion } : current);
      const allSigned = summary.parties.length > 0 && summary.parties.every((p) => p.signedAt);
      console.log("[complete] Step g: Server reload complete", { allSigned, status: summary.status, parties: summary.parties.map(p => ({ label: p.partyLabel, signedAt: p.signedAt })) });

      toast.success(allSigned ? t("signature.allSigned") : t("signature.saved"));
      setSignedJustNow(true);
      setView("signed");
      window.scrollTo(0, 0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[complete] Signature save FAILED", { error: msg });
      if (msg.includes("zero_rows")) {
        toast.error(t("signature.rlsBlocked"));
      } else {
        toast.error(t("signature.uploadError"));
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedSummary = useMemo(() => data.situations.map((index) => circumstances[index]), [data.situations, circumstances]);

  if (view === "signed") return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-lg px-5 py-16">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-9 w-9 text-emerald-600" /></span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-[#102F52]">{t("signature.confirmTitle")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{t(hasMultiParty && !counterpart?.signedAt ? "signature.confirmWaiting" : "signature.confirmComplete")}</p>
          <Button onClick={() => setView("home")} className="mt-6 h-14 w-full rounded-2xl bg-[#153B66] text-base font-semibold">{t("signature.backHome")}</Button>
        </div>
      </main>
    </div>
  );

  if (view === "home") return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-5 pb-12 pt-8 md:pt-12">
        <section className="mb-8 md:flex md:items-end md:justify-between">
          <div><p className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#39719D]">{t("home.greeting")}</p><h1 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-[#102F52] md:text-4xl">{t("home.title")}</h1><p className="mt-3 max-w-lg text-base leading-relaxed text-slate-600">{t("home.intro")}</p></div>
          <div className="mt-5 flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 md:mt-0"><ShieldCheck className="h-4 w-4" />{t("incident.secureStorage")}</div>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <button onClick={() => void startAccident()} disabled={creating} className="group flex min-h-44 flex-col items-start justify-between rounded-3xl bg-[#153B66] p-6 text-left text-white shadow-lg shadow-[#153B66]/15 active:scale-[0.98] disabled:cursor-wait disabled:opacity-75"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Plus className="h-7 w-7" /></span><span className="flex w-full items-end justify-between gap-4"><span><span className="block text-xl font-bold">{t(creating ? "incident.creating" : "home.new")}</span><span className="mt-1 block text-sm text-blue-100">{t("home.newHint")}</span></span><ArrowRight className="mb-1 h-6 w-6 group-hover:translate-x-1" /></span></button>
          <button onClick={() => navigate("/join")} className="group flex min-h-44 flex-col items-start justify-between rounded-3xl border-2 border-[#D8E3EC] bg-white p-6 text-left text-[#153B66] shadow-sm active:scale-[0.98]"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF1F6]"><QrCode className="h-7 w-7" /></span><span className="flex w-full items-end justify-between gap-4"><span><span className="block text-xl font-bold">{t("home.join")}</span><span className="mt-1 block text-sm text-slate-500">{t("home.joinHint")}</span></span><ChevronRight className="mb-1 h-6 w-6 group-hover:translate-x-1" /></span></button>
        </section>

        {casesLoading && (
          <section className="mt-10">
            <div className="mb-4"><h2 className="text-xl font-bold text-[#102F52]">{t("home.recent")}</h2></div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="h-12 w-12 shrink-0 rounded-2xl bg-slate-200" /><div className="flex-1 space-y-2"><div className="h-4 w-1/3 rounded bg-slate-200" /><div className="h-3 w-1/2 rounded bg-slate-200" /></div></div>)}
            </div>
          </section>
        )}

        {!casesLoading && casesError && (
          <section className="mt-10 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
            <p className="text-sm font-semibold text-rose-900">{t("home.loadError")}</p>
            <Button variant="outline" onClick={() => { setCasesError(false); setSignedJustNow((v) => !v); }} className="mt-3 rounded-xl border-rose-300 bg-white text-rose-900">{t("home.retry")}</Button>
          </section>
        )}

        {!casesLoading && !casesError && allCases.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-[#102F52]">{t("home.recent")}</h2></div>
            <div className="space-y-3">
              {allCases.map((item) => {
                return (
                  <div key={item.id} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
                    <button onClick={() => void openCase(item)} className="flex min-w-0 flex-1 items-center gap-4 text-left active:scale-[0.99]">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EDF3F7] text-[#153B66]"><FileText className="h-6 w-6" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><h3 className="truncate font-bold text-[#153B66]">{item.location || t("fields.notProvided")}</h3>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColors[item.caseStatus]}`}>{t(`caseStatus.${item.caseStatus}`)}</span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">{formatCaseDate(item) || t("fields.notProvided")} · {item.plate || t("fields.noPlate")}</p>
                      </div>
                      {item.caseStatus === "action_needed" && <PenLine className="h-5 w-5 shrink-0 text-orange-500" />}
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                    </button>
                    {item.caseStatus !== "signed" && item.caseStatus !== "submitted" && (
                      <button onClick={() => setDeleteTarget(item)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500" aria-label={t(item.partyLabel === "A" ? "delete.case" : "delete.participation")}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!casesLoading && !casesError && allCases.length === 0 && (
          <section className="mt-10 flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-600">{t("home.noCases")}</p>
            <p className="mt-1 text-sm text-slate-400">{t("home.noCasesHint")}</p>
            <Button onClick={() => void startAccident()} className="mt-4 rounded-xl bg-[#153B66]"><Plus className="mr-2 h-4 w-4" />{t("home.new")}</Button>
          </section>
        )}
      </main>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t(deleteTarget?.partyLabel === "A" ? "delete.caseTitle" : "delete.participationTitle")}</DialogTitle>
            <DialogDescription>{t(deleteTarget?.partyLabel === "A" ? "delete.caseConfirm" : "delete.participationConfirm")}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="h-11 flex-1 rounded-xl">{t("app.close")}</Button>
            <Button onClick={() => void confirmDelete()} className="h-11 flex-1 rounded-xl bg-rose-600 hover:bg-rose-700"><Trash2 className="mr-2 h-4 w-4" />{t(deleteTarget?.partyLabel === "A" ? "delete.case" : "delete.participation")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F7FA] pb-28 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto max-w-3xl px-4 py-3"><div className="flex items-center justify-between gap-2"><Button variant="ghost" size="icon" onClick={back} className="h-11 w-11 shrink-0 rounded-xl" aria-label={t("app.back")}><ArrowLeft className="h-6 w-6 text-[#153B66]" /></Button><div className="min-w-0 text-center"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("wizard.stepOf", { current: formatNumber(step + 1), total: formatNumber(6) })}</p><p className="truncate font-bold text-[#153B66]">{steps[step]}</p></div><div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => void refreshFromServer()} disabled={summaryLoading} className="h-9 w-9 rounded-lg" aria-label={t("home.refresh")}><RefreshCw className={`h-4 w-4 text-[#153B66] ${summaryLoading ? "animate-spin" : ""}`} /></Button><LanguageSwitcher /></div></div><div className="mt-3 flex items-center gap-3"><Progress value={((step + 1) / 6) * 100} className="h-1.5 flex-1 bg-slate-200 [&>div]:bg-[#39719D]" /><div className="flex items-center gap-2"><span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${serverOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${serverOnline ? "bg-emerald-500" : "bg-slate-400"}`} />{t(serverOnline ? "connection.online" : "connection.offline")}</span>{liveUpdatesActive && <span className="hidden items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 sm:flex"><Radio className="h-2.5 w-2.5 animate-pulse" />{t("connection.live")}</span>}</div></div><div className="mt-2 flex gap-1 overflow-x-auto pb-1">{steps.map((label, index) => <button key={index} onClick={() => setStep(index)} className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${index === step ? "bg-[#153B66] text-white" : index < step ? "bg-[#E7F0F6] text-[#153B66]" : "bg-slate-100 text-slate-400"}`}>{index + 1}</button>)}</div></div></header>
      <main className="mx-auto max-w-3xl px-5 py-7">{caseLoading ? <div className="flex min-h-64 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-[#39719D]" /></div> : <>
      <div className="mb-7"><div className="mb-2 flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[#39719D]">{formatNumber(step + 1).padStart(2, "0")} — {steps[step]}</p>{draftRef && <span className="rounded-full bg-[#E7F0F6] px-2.5 py-1 font-mono text-xs font-bold tracking-wider text-[#153B66]">{t("incident.shareCode")}: {draftRef.shareCode}</span>}</div><h1 className="text-2xl font-bold tracking-tight text-[#102F52]">{titles[step]}</h1><p className="mt-2 text-sm leading-relaxed text-slate-500">{descriptions[step]}</p></div>

        {(!user || isAnonymous) && <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><p className="font-semibold">{t("guest.notice")}</p><p className="mt-1 text-sm leading-relaxed text-amber-800">{t("guest.detail")}</p><Button asChild variant="link" className="mt-1 h-auto p-0 font-semibold text-amber-900"><Link to="/auth">{t("guest.createAccount")}</Link></Button></div></div></div>}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">

          {step === 0 && <div className="space-y-6"><div className="grid grid-cols-2 gap-4"><Field number="1" label={t("fields.date")}><Input type="date" value={data.date} onChange={(event) => update("date", event.target.value)} className={fieldClass} /></Field><Field number="1" label={t("fields.time")}><Input type="time" value={data.time} onChange={(event) => update("time", event.target.value)} className={fieldClass} /></Field></div><Field number="2" label={t("fields.place")}><div className="space-y-2"><Input value={data.location} onChange={(event) => { update("location", event.target.value); update("locationLat", null); update("locationLng", null); }} placeholder={t("fields.placePlaceholder")} className={fieldClass} /><Button type="button" variant="outline" onClick={locate} disabled={locating} className="h-12 w-full rounded-xl border-[#B8CDDC] text-[#153B66]"><LocateFixed className={`mr-2 h-5 w-5 ${locating ? "animate-spin" : ""}`} />{t(locating ? "location.locating" : "location.useCurrent")}</Button></div></Field><Field number="3" label={t("fields.injured")}><div className="grid grid-cols-2 gap-3"><Choice active={!data.injured} onClick={() => update("injured", false)}>{t("fields.no")}</Choice><Choice active={data.injured} warning onClick={() => update("injured", true)}>{t("fields.yesInjured")}</Choice></div>{data.injured && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{t("fields.emergency")}</p>}</Field><Field number="4" label={t("fields.otherDamage")}><div className="grid grid-cols-2 gap-3"><Choice active={!data.otherDamage} onClick={() => update("otherDamage", false)}>{t("fields.no")}</Choice><Choice active={data.otherDamage} warning onClick={() => update("otherDamage", true)}>{t("fields.yesOtherDamage")}</Choice></div></Field><Field number="5" label={t("fields.witnesses")}><Textarea value={data.witnesses} onChange={(event) => update("witnesses", event.target.value)} placeholder={t("fields.witnessesPlaceholder")} className="min-h-24 rounded-xl text-base" /></Field></div>}

          {step === 1 && <div className="space-y-7"><SectionTitle number="6 & 9" icon={<UserRound />} title={t("fields.driver")} /><div className="space-y-5"><Field label={t("fields.fullName")}><Input value={data.driverName} onChange={(event) => update("driverName", event.target.value)} placeholder={t("fields.namePlaceholder")} className={fieldClass} /></Field><Field label={t("fields.address")}><Input value={data.driverAddress} onChange={(event) => update("driverAddress", event.target.value)} placeholder={t("fields.addressPlaceholder")} className={fieldClass} /></Field><Field label={t("fields.phone")}><Input type="tel" value={data.phone} onChange={(event) => update("phone", event.target.value)} placeholder={t("fields.phonePlaceholder")} className={fieldClass} /></Field></div><div className="border-t border-slate-100 pt-6"><SectionTitle number="7–8" icon={<Car />} title={t("fields.vehicleInsurance")} /></div><div className="grid gap-5 sm:grid-cols-2"><Field number="7" label={t("fields.plate")}><Input value={data.plate} onChange={(event) => update("plate", event.target.value.toUpperCase())} placeholder={t("fields.platePlaceholder")} className={`${fieldClass} font-semibold uppercase`} /></Field><Field number="7" label={t("fields.vehicle")}><Input value={data.vehicle} onChange={(event) => update("vehicle", event.target.value)} placeholder={t("fields.vehiclePlaceholder")} className={fieldClass} /></Field><Field number="8" label={t("fields.insurer")}><Input value={data.insurer} onChange={(event) => update("insurer", event.target.value)} placeholder={t("fields.insurerPlaceholder")} className={fieldClass} /></Field><Field number="8" label={t("fields.policy")}><Input value={data.policy} onChange={(event) => update("policy", event.target.value)} placeholder={t("fields.policyPlaceholder")} className={fieldClass} /></Field></div></div>}
          {step === 2 && <div className="space-y-3"><FieldBadge number="12" />{circumstances.map((circumstance, index) => { const selected = data.situations.includes(index); return <label key={index} className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border-2 p-4 ${selected ? "border-[#39719D] bg-[#EDF4F8]" : "border-slate-200"}`}><Checkbox checked={selected} onCheckedChange={() => update("situations", selected ? data.situations.filter((value) => value !== index) : [...data.situations, index])} className="h-6 w-6 rounded-md data-[state=checked]:border-[#153B66] data-[state=checked]:bg-[#153B66]" /><span className="flex-1 text-sm font-medium leading-snug text-slate-700"><span className="mr-2 text-xs font-bold text-[#39719D]">{formatNumber(index + 1)}.</span>{circumstance}</span></label>; })}<p className="pt-3 text-center text-sm font-medium text-slate-500">{t("circumstances.selected", { count: data.situations.length, formattedCount: formatNumber(data.situations.length) })}</p></div>}
          {step === 3 && <div className="space-y-6"><Field number="11" label={t("fields.visibleDamage")}><Textarea value={data.damage} onChange={(event) => update("damage", event.target.value)} placeholder={t("fields.damagePlaceholder")} className="min-h-28 rounded-xl text-base" /></Field><Field number="14" label={t("fields.remarks")}><Textarea value={data.notes} onChange={(event) => update("notes", event.target.value)} placeholder={t("fields.remarksPlaceholder")} className="min-h-24 rounded-xl text-base" /></Field><Field number="11" label={t("fields.photos")}><button type="button" onClick={() => void takePhoto()} className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#9FBACD] bg-[#F7FAFC] p-5 text-center"><Camera className="mb-2 h-8 w-8 text-[#39719D]" /><span className="font-semibold text-[#153B66]">{t("fields.photoAction")}</span><span className="mt-1 text-xs text-slate-500">{t("fields.photoHint")}</span></button><input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></Field>{data.photos.length > 0 && <div className="grid grid-cols-3 gap-3">{data.photos.map((photo, index) => <div key={photo.id} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100"><img src={photo.url} alt={t("fields.photoAlt", { number: formatNumber(index + 1) })} className="h-full w-full object-cover" /><button type="button" onClick={() => void removePhoto(photo)} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/75 text-white" aria-label={t("fields.deletePhoto")}><Trash2 className="h-4 w-4" /></button></div>)}</div>}</div>}

          {step === 4 && <div className="space-y-5">
            <div><FieldBadge number="10" /><p className="text-sm font-semibold text-slate-700">{t("fields.initialImpact")}</p></div>
            <FieldBadge number="13" />
            <div className="rounded-xl bg-[#EDF4F8] p-4 text-sm leading-relaxed text-[#153B66]"><strong>{t("sketch.tipTitle")}</strong> {t("sketch.tip")}</div>

            {/* Mode switcher */}
            <div className="flex gap-2 rounded-xl border border-slate-200 p-1">
              <button onClick={() => { if (sketchMode !== "builder" && data.hasSketch) { if (!confirm(t("sketch.switchWarning"))) return; } setSketchMode("builder"); }} className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${sketchMode === "builder" ? "bg-[#153B66] text-white" : "text-slate-600"}`}>{t("sketch.modeBuilder")}</button>
              <button onClick={() => { if (sketchMode !== "freehand" && data.hasSketch) { if (!confirm(t("sketch.switchWarning"))) return; } setSketchMode("freehand"); }} className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${sketchMode === "freehand" ? "bg-[#153B66] text-white" : "text-slate-600"}`}>{t("sketch.modeFreehand")}</button>
            </div>

            {draftRef && !draftRef.incidentId.startsWith("local:") && ownParty?.sketchConfirmedAt && counterpart && !counterpart.sketchConfirmedAt && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" />{t("sketch.counterpartMustConfirm")}</div>
            )}

            {sketchMode === "builder"
              ? <ScenarioBuilder checkedCircumstances={data.situations} onSave={(s) => { update("hasSketch", true); update("sketchDataUrl", ""); if (draftRef && !draftRef.incidentId.startsWith("local:") && user) void saveSketch(JSON.stringify(s)); }} />
              : <DrawingCanvas label={t("fields.sketch")} height={320} initialDataUrl={data.sketchDataUrl} onChange={(value, dataUrl) => { if (value && dataUrl) void saveSketch(dataUrl); else { update("hasSketch", value); update("sketchDataUrl", dataUrl ?? ""); } }} />}

            <div className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1.5">{t("sketch.myVehicle")}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{t("sketch.otherVehicle")}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{t("sketch.impact")}</span></div>
            {draftRef && !draftRef.incidentId.startsWith("local:") && data.hasSketch && (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="text-sm">
                  <p className="font-semibold text-slate-700">{ownParty?.sketchConfirmedAt ? `✓ ${t("sketch.confirmedByYou")}` : t("sketch.confirmPrompt")}</p>
                  {counterpart && <p className="text-xs text-slate-500">{counterpart.sketchConfirmedAt ? `✓ ${t("sketch.confirmedByCounterpart")}` : t("sketch.counterpartNotConfirmed")}</p>}
                </div>
                {!ownParty?.sketchConfirmedAt && <Button type="button" size="sm" onClick={() => void confirmSketch()} className="rounded-lg bg-[#153B66]"><Check className="mr-1 h-4 w-4" />{t("sketch.confirm")}</Button>}
              </div>
            )}
          </div>}
          {step === 5 && <div className="space-y-6">
            {draftRef?.partyLabel === "A" && !alreadySigned && (draftRef.incidentId.startsWith("local:")
              ? (ensuringServerCase
                  ? <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-8"><RefreshCw className="mr-2 h-5 w-5 animate-spin text-[#39719D]" /><span className="text-sm font-semibold text-slate-600">{t("invite.savingCase")}</span></div>
                  : !navigator.onLine
                    ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center"><p className="text-sm font-semibold text-amber-900">{t("invite.offlineHint")}</p><p className="mt-1 text-xs text-amber-700">{t("invite.offlineDetail")}</p></div>
                    : <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center"><p className="text-sm font-semibold text-rose-900">{t("invite.saveFailed")}</p><Button variant="outline" onClick={() => void retrySync()} className="mt-3 rounded-xl border-rose-300 bg-white text-rose-900">{t("home.retry")}</Button></div>)
              : <InviteParty shareCode={draftRef.shareCode} loading={false} />)}
            <div className="grid gap-3 sm:grid-cols-2"><Summary number="1" icon={<Clock3 />} label={t("fields.dateTime")} value={formatCaseDate(data)} /><Summary number="2" icon={<MapPin />} label={t("fields.place")} value={data.location || t("fields.notProvided")} /><Summary number="9" icon={<UserRound />} label={t("fields.driver")} value={data.driverName || t("fields.notProvided")} /><Summary number="7" icon={<Car />} label={t("fields.vehicle")} value={`${data.plate || t("fields.noPlate")}${data.vehicle ? ` · ${data.vehicle}` : ""}`} /><Summary number="8" icon={<ShieldCheck />} label={t("fields.insurer")} value={data.insurer || t("fields.notProvided")} /><Summary number="11–13" icon={<Camera />} label={t("fields.documentation")} value={`${t("fields.photosCount", { formattedCount: formatNumber(data.photos.length) })} · ${t(data.hasSketch ? "fields.sketchAvailable" : "fields.withoutSketch")}`} /></div>
            <div className="rounded-2xl border border-slate-200 p-4"><FieldBadge number="12" /><p className="mb-2 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500">{t("summary.circumstances")}</p>{selectedSummary.length ? <ul className="space-y-1.5">{selectedSummary.map((item) => <li key={item} className="flex gap-2 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{item}</li>)}</ul> : <p className="text-sm text-slate-500">{t("summary.noneSelected")}</p>}</div>
            {counterpart && <CounterpartSummary party={counterpart} loading={summaryLoading} />}
            <FieldBadge number="15" />
            {alreadySigned
              ? <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
                  <p className="mt-2 font-bold text-emerald-900">{t("signature.alreadySigned")}</p>
                  {!counterpart?.signedAt && <Button variant="outline" onClick={() => setWithdrawOpen(true)} className="mt-3 rounded-xl border-emerald-300 text-emerald-800"><RotateCcw className="mr-2 h-4 w-4" />{t("signature.withdraw")}</Button>}
                </div>
              : !ownRequiredFieldsComplete
                ? <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-5"><p className="text-sm font-semibold text-amber-900">{t("signature.missingFieldsTitle")}</p><div className="mt-3 flex flex-wrap gap-2">{missingRequiredFields.map((field) => <button key={field.key} onClick={() => setStep(field.step)} className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-200">{t(field.key)}</button>)}</div></div>
                : !serverOnline || draftRef?.incidentId.startsWith("local:")
                  ? <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center"><WifiOff className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-2 text-sm font-semibold text-slate-600">{t("signature.onlineRequired")}</p></div>
                  : <DrawingCanvas label={t("fields.signature")} height={170} confirmable onChange={(value, dataUrl) => { update("hasSignature", value); update("signatureDataUrl", dataUrl ?? ""); }} />}
            {alreadySigned && draftRef && !draftRef.incidentId.startsWith("local:") && <SubmissionPanel incidentId={draftRef.incidentId} />}
            <p className="text-xs leading-relaxed text-slate-500">{t("summary.disclaimer")}</p>
          </div>}

          {step === 5 && draftRef && !draftRef.incidentId.startsWith("local:") && <CaseDiagnostics incidentId={draftRef.incidentId} />}

        </div>
      </>}</main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div className="mx-auto flex max-w-3xl gap-3">
        {step < 5
          ? <><Button variant="outline" onClick={back} disabled={saving} className="h-14 w-14 shrink-0 rounded-2xl border-slate-300" aria-label={t("app.back")}><ArrowLeft className="h-5 w-5" /></Button><Button onClick={() => void next()} disabled={saving} className="h-14 flex-1 rounded-2xl bg-[#153B66] text-base font-semibold hover:bg-[#102F52]">{saving ? t("incident.saving") : t("wizard.next", { step: steps[step + 1] })}<ArrowRight className="ml-2 h-5 w-5" /></Button></>
          : alreadySigned
            ? <Button onClick={() => setView("home")} className="h-14 flex-1 rounded-2xl bg-[#153B66] text-base font-semibold"><ArrowLeft className="mr-2 h-5 w-5" />{t("summary.toOverview")}</Button>
            : <><Button variant="outline" onClick={back} disabled={saving} className="h-14 w-14 shrink-0 rounded-2xl border-slate-300" aria-label={t("app.back")}><ArrowLeft className="h-5 w-5" /></Button><Button onClick={() => void complete()} disabled={saving || !ownRequiredFieldsComplete || !data.hasSignature} className="h-14 flex-1 rounded-2xl bg-emerald-700 text-base font-semibold hover:bg-emerald-800"><Check className="mr-2 h-5 w-5" />{saving ? t("incident.saving") : t("wizard.complete")}</Button></>}
      </div></div>
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("signature.withdrawTitle")}</DialogTitle><DialogDescription>{t("signature.withdrawConfirm")}</DialogDescription></DialogHeader>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" onClick={() => setWithdrawOpen(false)} className="h-11 flex-1 rounded-xl">{t("app.close")}</Button>
            <Button onClick={() => void withdrawSignature()} className="h-11 flex-1 rounded-xl bg-amber-600 hover:bg-amber-700"><RotateCcw className="mr-2 h-4 w-4" />{t("signature.withdraw")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubmissionPanel({ incidentId }: { incidentId: string }) {
  const { t } = useTranslation();
  const [targetEmail, setTargetEmail] = useState("");
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setGenerating(true);
    try {
      const result = await generateIncidentPdf(incidentId);
      const anchor = document.createElement("a");
      anchor.href = result.downloadUrl;
      anchor.rel = "noopener";
      anchor.click();
    } catch (error) {
      const code = error instanceof SubmissionError ? error.code : "pdf_generation_failed";
      console.error("[SubmissionPanel] PDF download failed", { code, error });
      toast.error(t(`submission.errors.${code}`, { defaultValue: t("submission.errors.pdf_generation_failed") }));
    } finally {
      setGenerating(false);
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(targetEmail)) return toast.error(t("submission.invalidEmail"));
    setConfirmOpen(false);
    setBusy(true);
    setSubmitting(true);
    try {
      await submitIncident(incidentId, targetEmail);
      setSubmitted(true);
      toast.success(t("submission.success"));
    } catch (error) {
      const code = error instanceof SubmissionError ? error.code : "submission_failed";
      console.error("[SubmissionPanel] Submission failed", { code, error });
      toast.error(t(`submission.errors.${code}`, { defaultValue: t("submission.errors.submission_failed") }));
    } finally {
      setSubmitting(false);
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#B8CDDC] bg-[#F4F8FB] p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#153B66]"><Mail className="h-5 w-5" /></span>
        <div>
          <h3 className="font-bold text-[#153B66]">{t("submission.title")}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{t("submission.description")}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Input type="email" value={targetEmail} onChange={(event) => setTargetEmail(event.target.value)} placeholder={t("submission.emailPlaceholder")} className={fieldClass} disabled={submitted} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={() => void download()} disabled={busy} className="h-12 rounded-xl border-[#9FBACD] text-[#153B66]">
            {generating ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />{t("submission.generating")}</> : <><Download className="mr-2 h-4 w-4" />{t(submitted ? "submission.downloadAgain" : "submission.download")}</>}
          </Button>
          <Button type="button" onClick={() => submitted ? void download() : setConfirmOpen(true)} disabled={busy || submitted} className="h-12 rounded-xl bg-[#153B66]">
            {submitting ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />{t("submission.submitting")}</> : submitted ? <><Check className="mr-2 h-4 w-4" />{t("submission.submitted")}</> : <><Send className="mr-2 h-4 w-4" />{t("submission.submit")}</>}
          </Button>
        </div>
        {submitted && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{t("submission.submittedHint")}</p>}
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("submission.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("submission.confirmText", { email: targetEmail })}</DialogDescription>
          </DialogHeader>
          <div className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{t("submission.confirmIrreversible")}</div>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="h-11 flex-1 rounded-xl">{t("app.close")}</Button>
            <Button onClick={() => void submit()} className="h-11 flex-1 rounded-xl bg-[#153B66]"><Send className="mr-2 h-4 w-4" />{t("submission.submit")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function AppHeader() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const name = organization?.name ?? t("app.name");
  return <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-4"><div className="flex min-w-0 items-center gap-3"><img src={organization?.branding_json?.logo_url || "/assets/upsala-logo.png"} alt={name} className="h-[48px] w-[48px] shrink-0 rounded-xl object-contain" /><div className="hidden min-w-0 md:block"><p className="text-xl font-bold tracking-tight text-primary">{name}</p><p className="truncate text-xs font-medium text-slate-500">{t("app.statement")}</p></div></div><div className="flex items-center gap-2"><LanguageSwitcher /><UserMenu /></div></div></header>;
}

function Field({ number, label, children }: { number?: string; label: string; children: React.ReactNode }) { return <div>{number && <FieldBadge number={number} />}<Label className="mb-2 block text-sm font-semibold text-slate-700">{label}</Label>{children}</div>; }

function FieldBadge({ number }: { number: string }) { const { t } = useTranslation(); return <span className="mb-1.5 inline-flex rounded-md bg-[#E7F0F6] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#285B82]">{t("fields.number", { number })}</span>; }
function SectionTitle({ number, icon, title }: { number: string; icon: React.ReactNode; title: string }) { return <div className="mb-4 flex items-center gap-3 text-[#153B66]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDF3F7] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><FieldBadge number={number} /><h2 className="text-lg font-bold">{title}</h2></div></div>; }

function Choice({ active, warning, onClick, children }: { active: boolean; warning?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`h-14 rounded-xl border-2 text-base font-semibold ${active ? warning ? "border-amber-500 bg-amber-50 text-amber-900" : "border-[#153B66] bg-[#EDF3F7] text-[#153B66]" : "border-slate-200 text-slate-600"}`}>{children}</button>; }
function Summary({ number, icon, label, value }: { number: string; icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3 rounded-2xl bg-[#F6F8FA] p-4"><span className="mt-0.5 text-[#39719D] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="min-w-0"><FieldBadge number={number} /><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div></div>; }

function CounterpartSummary({ party, loading }: { party?: IncidentPartySummary; loading: boolean }) {
  const { t } = useTranslation();
  const circumstances = t("circumstances.items", { returnObjects: true }) as string[];
  return <section className="rounded-2xl border-2 border-[#C9D9E5] bg-[#F7FAFC] p-5"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-[#39719D]">{t("summary.counterpartEyebrow")}</p><h2 className="mt-1 text-lg font-bold text-[#153B66]">{t("summary.counterpartTitle", { label: party?.partyLabel ?? "–" })}</h2></div><span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">{t("summary.readOnly")}</span></div>{loading ? <p className="text-sm text-slate-500">{t("auth.loading")}</p> : !party ? <p className="rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-600">{t("summary.waitingForParty")}</p> : <div className="grid gap-3 sm:grid-cols-2"><Summary number="9" icon={<UserRound />} label={t("fields.driver")} value={party.driver.fullName || t("fields.notProvided")} /><Summary number="7" icon={<Car />} label={t("fields.vehicle")} value={`${party.vehicle.plate || t("fields.noPlate")}${party.vehicle.makeModel ? ` · ${party.vehicle.makeModel}` : ""}`} /><Summary number="8" icon={<ShieldCheck />} label={t("fields.insurer")} value={`${party.insurance.company || t("fields.notProvided")}${party.insurance.policyNumber ? ` · ${party.insurance.policyNumber}` : ""}`} /><Summary number="11" icon={<FileText />} label={t("fields.visibleDamage")} value={party.damageDescription || t("fields.notProvided")} /><div className="rounded-2xl bg-white p-4 sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("summary.circumstances")}</p><p className="mt-2 text-sm leading-relaxed text-slate-700">{party.circumstancesChecked.length ? party.circumstancesChecked.map((index) => circumstances[index]).filter(Boolean).join(" · ") : t("summary.noneSelected")}</p></div></div>}</section>;
}

function CaseDiagnostics({ incidentId }: { incidentId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ status: string; parties: { party_label: string; has_profile: boolean; signed_at: string | null; signature_storage_path: string | null; version: number }[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [incidentRes, partiesRes] = await Promise.all([
        supabase.from("incidents").select("id, status").eq("id", incidentId).maybeSingle(),
        supabase.from("incident_parties").select("party_label, profile_id, signed_at, signature_storage_path, version").eq("incident_id", incidentId).order("party_label"),
      ]);
      if (incidentRes.data && partiesRes.data) {
        setData({
          status: incidentRes.data.status,
          parties: partiesRes.data.map((p) => ({
            party_label: p.party_label,
            has_profile: Boolean(p.profile_id),
            signed_at: p.signed_at,
            signature_storage_path: p.signature_storage_path,
            version: p.version,
          })),
        });
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50">
      <button onClick={() => { setOpen(!open); if (!open && !data) void load(); }} className="flex w-full items-center justify-between p-3 text-left">
        <span className="text-xs font-semibold text-slate-600">{t("diagnostics.title")}</span>
        <ChevronRight className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-slate-200 p-3">
          {loading && <p className="text-xs text-slate-500">{t("diagnostics.loading")}</p>}
          {!loading && data && (
            <div className="space-y-1 text-xs">
              <p className="font-mono text-slate-600">incident_id: <span className="text-slate-900">{incidentId}</span></p>
              <p className="font-mono text-slate-600">status: <span className={`font-bold ${data.status === "signed" ? "text-emerald-600" : data.status === "submitted" ? "text-blue-600" : "text-amber-600"}`}>{data.status}</span></p>
              <div className="mt-2">
                <p className="font-semibold text-slate-500 uppercase">Parties</p>
                {data.parties.map((p, i) => (
                  <div key={i} className="mt-1 rounded-lg bg-white p-2 font-mono">
                    <p>Partei {p.party_label}: profile={p.has_profile ? "✓" : "✗"} signed={p.signed_at ? `✓ ${new Date(p.signed_at).toLocaleString()}` : "✗"} path={p.signature_storage_path ?? "null"} v={p.version}</p>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => void load()} className="mt-2 h-7 text-xs text-[#39719D]">{t("diagnostics.refresh")}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
