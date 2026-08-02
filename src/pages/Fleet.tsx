import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, Car, Download, FileText, Loader2, Mail, MapPin, RefreshCw, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FleetPortalError, inviteFleetDriver, loadFleetIncident, loadFleetOverview, type FleetDriver, type FleetIncident, type FleetIncidentDetail, type FleetInvitation } from "@/lib/fleet";
import { generateIncidentPdf } from "@/lib/submissions";

const CLOSED_STATUSES = new Set(["submitted"]);
const statusLabel = (status: string) => ({ draft: "Entwurf", open: "Offen", signed: "Signiert", submitted: "Eingereicht" }[status] ?? status);
const statusClass = (status: string) => status === "submitted" ? "bg-emerald-100 text-emerald-800" : status === "signed" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800";
const formatDate = (value: string | null, withTime = false) => value ? new Intl.DateTimeFormat("de-CH", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(value)) : "—";

export default function Fleet() {
  const { profile, organization } = useAuth();
  const [incidents, setIncidents] = useState<FleetIncident[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [invitations, setInvitations] = useState<FleetInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [driverId, setDriverId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<FleetIncidentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const allowed = Boolean(profile?.org_id && ["fleet_manager", "admin"].includes(profile.role));
  const load = async () => {
    setLoading(true);
    try {
      const result = await loadFleetOverview();
      setIncidents(result.incidents);
      setDrivers(result.drivers);
      setInvitations(result.invitations);
    } catch {
      toast.error("Das Flottenportal konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) void load(); }, [allowed, profile?.org_id]);

  const filtered = useMemo(() => incidents.filter((incident) => {
    const occurred = incident.occurredAt ?? incident.createdAt;
    const query = search.trim().toLowerCase();
    return (status === "all" || incident.status === status)
      && (driverId === "all" || incident.driverId === driverId)
      && (!from || occurred >= `${from}T00:00:00`)
      && (!to || occurred <= `${to}T23:59:59`)
      && (!query || [incident.shareCode, incident.location, incident.driverName, incident.plate].some((value) => value?.toLowerCase().includes(query)));
  }), [incidents, status, driverId, from, to, search]);

  const monthly = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, offset) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return { key, label: new Intl.DateTimeFormat("de-CH", { month: "short" }).format(date), count: incidents.filter((item) => (item.occurredAt ?? item.createdAt).startsWith(key)).length };
    });
  }, [incidents]);
  const maxMonthly = Math.max(1, ...monthly.map((item) => item.count));
  const openCases = incidents.filter((incident) => !CLOSED_STATUSES.has(incident.status)).length;

  if (!allowed) return <Navigate to="/" replace />;

  const openDetail = async (incidentId: string) => {
    setDetailLoading(true);
    try {
      const result = await loadFleetIncident(incidentId);
      setDetail(result.incident);
    } catch {
      toast.error("Die Falldetails konnten nicht geladen werden.");
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadPdf = async (incident: FleetIncident) => {
    setDownloadingId(incident.id);
    try {
      const result = await generateIncidentPdf(incident.id);
      window.location.assign(result.downloadUrl);
    } catch {
      toast.error("Das PDF konnte nicht erstellt werden. Der Fall muss vollständig signiert sein.");
    } finally {
      setDownloadingId(null);
    }
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error("Bitte geben Sie eine gültige E-Mail-Adresse ein.");
    setInviting(true);
    try {
      const result = await inviteFleetDriver(email);
      setInvitations((current) => [result.invitation, ...current.filter((item) => item.email !== email)]);
      setInviteEmail("");
      toast.success("Die Einladung wurde versendet und der Organisation zugeordnet.");
    } catch (error) {
      const code = error instanceof FleetPortalError ? error.code : "fleet_portal_failed";
      toast.error(code === "already_registered" ? "Für diese E-Mail besteht bereits ein Konto." : code === "different_organization" ? "Diese Person gehört bereits einer anderen Organisation an." : "Die Einladung konnte nicht versendet werden.");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <img src={organization?.branding_json?.logo_url || "/assets/upsala-logo.png"} alt="Logo" className="h-11 w-11 rounded-xl object-contain" />
            <div className="min-w-0"><p className="truncate text-sm text-slate-500">{organization?.name ?? "Organisation"}</p><h1 className="truncate text-xl font-bold text-primary">Flotten-Portal</h1></div>
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Aktualisieren"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid h-11 w-full max-w-md grid-cols-2 rounded-xl"><TabsTrigger value="overview">Übersicht</TabsTrigger><TabsTrigger value="drivers">Fahrer-Verwaltung</TabsTrigger></TabsList>
          <TabsContent value="overview" className="space-y-6">
            <section className="grid gap-4 md:grid-cols-3">
              <Metric icon={<FileText />} label="Unfälle gesamt" value={incidents.length} hint="Eigene Organisation" />
              <Metric icon={<AlertTriangle />} label="Offene Fälle" value={openCases} hint="Noch nicht eingereicht" warning={openCases > 0} />
              <Card className="rounded-2xl"><CardContent className="p-5"><div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500"><CalendarDays className="h-4 w-4" />Unfälle pro Monat</div><div className="flex h-20 items-end gap-2">{monthly.map((month) => <div key={month.key} className="flex flex-1 flex-col items-center gap-1"><span className="text-xs font-semibold text-slate-600">{month.count}</span><div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(4, (month.count / maxMonthly) * 48)}px` }} /><span className="text-[10px] uppercase text-slate-400">{month.label}</span></div>)}</div></CardContent></Card>
            </section>

            <Card className="rounded-2xl"><CardContent className="p-5"><div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Fall, Ort, Fahrer, Kennzeichen" className="h-10 pl-9" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">Alle Status</SelectItem><SelectItem value="draft">Entwurf</SelectItem><SelectItem value="signed">Signiert</SelectItem><SelectItem value="submitted">Eingereicht</SelectItem></SelectContent></Select><Select value={driverId} onValueChange={setDriverId}><SelectTrigger><SelectValue placeholder="Fahrer" /></SelectTrigger><SelectContent><SelectItem value="all">Alle Fahrer</SelectItem>{drivers.map((driver) => <SelectItem key={driver.id} value={driver.id}>{driver.fullName ?? driver.email ?? "Unbenannt"}</SelectItem>)}</SelectContent></Select><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Von" /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Bis" /></div></CardContent></Card>

            <Card className="overflow-hidden rounded-2xl">
              {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : filtered.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center"><FileText className="mb-3 h-9 w-9 text-slate-300" /><p className="font-semibold">Keine Unfälle gefunden</p><p className="mt-1 text-sm text-slate-500">Passen Sie die Filter an oder laden Sie die Übersicht neu.</p></div> : <Table><TableHeader><TableRow><TableHead>Fall</TableHead><TableHead>Datum</TableHead><TableHead>Fahrer</TableHead><TableHead className="hidden md:table-cell">Ort / Fahrzeug</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aktionen</TableHead></TableRow></TableHeader><TableBody>{filtered.map((incident) => <TableRow key={incident.id} className="cursor-pointer" onClick={() => void openDetail(incident.id)}><TableCell className="font-mono font-semibold">{incident.shareCode}</TableCell><TableCell>{formatDate(incident.occurredAt ?? incident.createdAt)}</TableCell><TableCell>{incident.driverName}</TableCell><TableCell className="hidden md:table-cell"><p>{incident.location ?? "—"}</p><p className="text-xs text-slate-500">{incident.plate ?? "Kein Kennzeichen"}</p></TableCell><TableCell><Badge className={statusClass(incident.status)}>{statusLabel(incident.status)}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" disabled={!['signed', 'submitted'].includes(incident.status) || downloadingId === incident.id} onClick={(event) => { event.stopPropagation(); void downloadPdf(incident); }}><Download className="mr-1 h-4 w-4" /><span className="hidden sm:inline">PDF</span></Button></TableCell></TableRow>)}</TableBody></Table>}
            </Card>
          </TabsContent>

          <TabsContent value="drivers" className="space-y-6">
            <Card className="rounded-2xl"><CardContent className="p-6"><div className="grid items-end gap-4 md:grid-cols-[1fr_auto]"><div><Label htmlFor="driver-email">Fahrer per E-Mail einladen</Label><p className="mb-3 mt-1 text-sm text-slate-500">Die eingeladene Person wird automatisch Ihrer Organisation zugeordnet.</p><div className="relative"><Mail className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input id="driver-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void invite()} placeholder="fahrer@unternehmen.ch" className="h-11 pl-9" /></div></div><Button onClick={() => void invite()} disabled={inviting || !inviteEmail.trim()} className="h-11"><UserPlus className="mr-2 h-4 w-4" />{inviting ? "Wird eingeladen…" : "Einladung senden"}</Button></div></CardContent></Card>
            <div className="grid gap-6 lg:grid-cols-2"><DriverList drivers={drivers} /><InvitationList invitations={invitations} /></div>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={detailLoading || Boolean(detail)} onOpenChange={(open) => { if (!open && !detailLoading) setDetail(null); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{detail ? `Fall ${detail.shareCode}` : "Fall wird geladen…"}</DialogTitle><DialogDescription>Organisationsgebundene Detailansicht des Unfallprotokolls.</DialogDescription></DialogHeader>{detailLoading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : detail && <IncidentDetail incident={detail} onDownload={() => void downloadPdf(detail)} downloading={downloadingId === detail.id} />}</DialogContent></Dialog>
    </div>
  );
}

function Metric({ icon, label, value, hint, warning = false }: { icon: React.ReactNode; label: string; value: number; hint: string; warning?: boolean }) {
  return <Card className="rounded-2xl"><CardContent className="flex items-center gap-4 p-5"><span className={`flex h-12 w-12 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5 ${warning ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"}`}>{icon}</span><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="text-3xl font-bold">{value}</p><p className="text-xs text-slate-400">{hint}</p></div></CardContent></Card>;
}

function DriverList({ drivers }: { drivers: FleetDriver[] }) {
  return <Card className="rounded-2xl"><CardContent className="p-0"><div className="flex items-center gap-2 border-b p-5"><Users className="h-5 w-5 text-primary" /><h2 className="font-bold">Aktive Fahrer ({drivers.length})</h2></div><div className="divide-y">{drivers.length ? drivers.map((driver) => <div key={driver.id} className="p-5"><p className="font-semibold">{driver.fullName ?? "Profil noch nicht vervollständigt"}</p><p className="mt-1 text-sm text-slate-500">{driver.email ?? "Keine E-Mail sichtbar"}{driver.phone ? ` · ${driver.phone}` : ""}</p></div>) : <p className="p-5 text-sm text-slate-500">Noch keine Fahrer in dieser Organisation.</p>}</div></CardContent></Card>;
}

function InvitationList({ invitations }: { invitations: FleetInvitation[] }) {
  return <Card className="rounded-2xl"><CardContent className="p-0"><div className="flex items-center gap-2 border-b p-5"><Mail className="h-5 w-5 text-primary" /><h2 className="font-bold">Einladungen ({invitations.length})</h2></div><div className="divide-y">{invitations.length ? invitations.map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-3 p-5"><div className="min-w-0"><p className="truncate font-semibold">{invitation.email}</p><p className="mt-1 text-xs text-slate-500">Versendet am {formatDate(invitation.createdAt)}</p></div><Badge variant="outline">{invitation.status === "pending" ? "Ausstehend" : invitation.status === "accepted" ? "Angenommen" : invitation.status}</Badge></div>) : <p className="p-5 text-sm text-slate-500">Noch keine Einladungen versendet.</p>}</div></CardContent></Card>;
}

function IncidentDetail({ incident, onDownload, downloading }: { incident: FleetIncidentDetail; onDownload: () => void; downloading: boolean }) {
  return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Detail icon={<CalendarDays />} label="Datum & Zeit" value={formatDate(incident.occurredAt ?? incident.createdAt, true)} /><Detail icon={<MapPin />} label="Unfallort" value={incident.location ?? "—"} /><Detail icon={<Users />} label="Fahrer" value={incident.driverName} /><Detail icon={<Car />} label="Fahrzeug" value={incident.plate ?? "—"} /></div><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4"><div><p className="text-sm text-slate-500">Status</p><Badge className={`mt-1 ${statusClass(incident.status)}`}>{statusLabel(incident.status)}</Badge></div><div className="text-right text-sm text-slate-500"><p>{incident.photoCount} Fotos</p><p>{incident.witnesses.length} Zeugen</p></div></div><div><h3 className="mb-3 font-bold">Beteiligte Parteien</h3><div className="grid gap-3 sm:grid-cols-2">{incident.parties.map((party) => <div key={party.id} className="rounded-xl border p-4"><div className="mb-3 flex items-center justify-between"><p className="font-bold">Partei {party.label}</p><Badge variant={party.signedAt ? "secondary" : "outline"}>{party.signedAt ? "Signiert" : "Offen"}</Badge></div><dl className="space-y-2 text-sm"><Info label="Fahrer" value={party.driver?.fullName} /><Info label="Fahrzeug" value={[party.vehicle?.plate, party.vehicle?.makeModel].filter(Boolean).join(" · ")} /><Info label="Versicherung" value={party.insurance?.company} /><Info label="Schaden" value={party.damageDescription} /></dl></div>)}</div></div><Button onClick={onDownload} disabled={downloading || !['signed', 'submitted'].includes(incident.status)} className="w-full"><Download className="mr-2 h-4 w-4" />{downloading ? "PDF wird erstellt…" : "Unfallprotokoll als PDF herunterladen"}</Button></div>;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3 rounded-xl border p-4"><span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><p className="text-xs font-medium uppercase text-slate-400">{label}</p><p className="mt-1 font-semibold">{value}</p></div></div>; }
function Info({ label, value }: { label: string; value?: string | null }) { return <div><dt className="text-xs text-slate-400">{label}</dt><dd className="break-words text-slate-700">{value || "—"}</dd></div>; }
