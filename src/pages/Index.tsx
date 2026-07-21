import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Car,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  LocateFixed,
  MapPin,
  Menu,
  Plus,
  QrCode,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawingCanvas } from "@/components/DrawingCanvas";

const steps = ["Unfalldaten", "Meine Angaben", "Unfallhergang", "Schäden & Fotos", "Skizze", "Abschluss"];
const situations = [
  "Parkte / hielt an",
  "Verliess einen Parkplatz / öffnete eine Tür",
  "Parkte ein",
  "Fuhr aus einem Parkplatz, Grundstück oder Feldweg",
  "Fuhr auf einen Parkplatz, ein Grundstück oder einen Feldweg",
  "Fuhr in einen Kreisverkehr ein",
  "Fuhr im Kreisverkehr",
  "Fuhr auf das Heck eines Fahrzeugs auf",
  "Fuhr in gleicher Richtung, aber anderer Spur",
  "Wechselte die Spur",
  "Überholte",
  "Bog nach rechts ab",
  "Bog nach links ab",
  "Setzte zurück",
  "Geriet auf die Gegenfahrbahn",
  "Kam von rechts (Kreuzung)",
  "Missachtete Vorfahrt oder Rotlicht",
];

interface AccidentData {
  date: string;
  time: string;
  location: string;
  injured: string;
  witnesses: string;
  driverName: string;
  driverAddress: string;
  phone: string;
  plate: string;
  vehicle: string;
  insurer: string;
  policy: string;
  situations: number[];
  damage: string;
  notes: string;
  photos: string[];
  hasSketch: boolean;
  hasSignature: boolean;
}

interface CaseItem {
  id: string;
  date: string;
  location: string;
  status: string;
  plate: string;
}

const emptyData = (): AccidentData => {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    location: "",
    injured: "nein",
    witnesses: "",
    driverName: "",
    driverAddress: "",
    phone: "",
    plate: "",
    vehicle: "",
    insurer: "",
    policy: "",
    situations: [],
    damage: "",
    notes: "",
    photos: [],
    hasSketch: false,
    hasSignature: false,
  };
};

const initialCases: CaseItem[] = [
  { id: "UK-2408", date: "18. Mai 2025 · 16:42", location: "Zürich, Hardbrücke", status: "Entwurf", plate: "ZH 824 391" },
  { id: "UK-2311", date: "03. Februar 2025 · 08:15", location: "Basel, Aeschenplatz", status: "Abgeschlossen", plate: "BS 118 602" },
  { id: "UK-2194", date: "12. November 2024 · 19:30", location: "Bern, Wankdorf", status: "Abgeschlossen", plate: "BE 544 208" },
];

const fieldClass = "h-12 rounded-xl border-slate-200 bg-white text-base focus-visible:ring-[#153B66]";

export default function Index() {
  const [view, setView] = useState<"home" | "wizard">("home");
  const [step, setStep] = useState(0);
  const [data, setData] = useState<AccidentData>(emptyData);
  const [cases, setCases] = useState(initialCases);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [locating, setLocating] = useState(false);

  const update = <K extends keyof AccidentData>(key: K, value: AccidentData[K]) => setData((prev) => ({ ...prev, [key]: value }));

  const startAccident = () => {
    setData(emptyData());
    setStep(0);
    setView("wizard");
    window.scrollTo(0, 0);
  };

  const next = () => {
    if (step < 5) {
      setStep((value) => value + 1);
      window.scrollTo(0, 0);
    }
  };

  const back = () => {
    if (step === 0) setView("home");
    else {
      setStep((value) => value - 1);
      window.scrollTo(0, 0);
    }
  };

  const locate = () => {
    if (!navigator.geolocation) return toast.error("Standortbestimmung wird nicht unterstützt.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        update("location", `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
        setLocating(false);
        toast.success("Standort wurde übernommen.");
      },
      () => {
        setLocating(false);
        toast.error("Standort konnte nicht ermittelt werden.");
      },
    );
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const urls = Array.from(files).map((file) => URL.createObjectURL(file));
    update("photos", [...data.photos, ...urls]);
  };

  const complete = () => {
    const formatted = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(data.date));
    setCases((prev) => [
      { id: `UK-${Math.floor(1000 + Math.random() * 9000)}`, date: `${formatted} · ${data.time}`, location: data.location || "Ort nicht angegeben", status: "Abgeschlossen", plate: data.plate || "Ohne Kennzeichen" },
      ...prev,
    ]);
    setView("home");
    toast.success("Unfallprotokoll wurde gespeichert.");
  };

  const selectedSummary = useMemo(() => data.situations.map((index) => situations[index]), [data.situations]);

  if (view === "home") {
    return (
      <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <img src="/assets/unfallklar-logo.png" alt="Unfallklar" className="h-11 w-11 rounded-xl object-cover" />
              <div><p className="text-xl font-bold tracking-tight text-[#153B66]">Unfallklar</p><p className="text-xs font-medium text-slate-500">Sicher dokumentiert</p></div>
            </div>
            <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl" aria-label="Menü"><Menu className="h-6 w-6 text-[#153B66]" /></Button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-5 pb-12 pt-8 md:pt-12">
          <section className="mb-8 md:flex md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#39719D]">Guten Tag</p>
              <h1 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-[#102F52] md:text-4xl">Was möchten Sie tun?</h1>
              <p className="mt-3 max-w-lg text-base leading-relaxed text-slate-600">Erfassen Sie einen Unfall Schritt für Schritt – ruhig, vollständig und direkt vor Ort.</p>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 md:mt-0"><ShieldCheck className="h-4 w-4" /> Daten bleiben auf diesem Gerät</div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <button onClick={startAccident} className="group flex min-h-44 flex-col items-start justify-between rounded-3xl bg-[#153B66] p-6 text-left text-white shadow-lg shadow-[#153B66]/15 transition-transform active:scale-[0.98]">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Plus className="h-7 w-7" /></span>
              <span className="flex w-full items-end justify-between gap-4"><span><span className="block text-xl font-bold">Neuen Unfall erfassen</span><span className="mt-1 block text-sm text-blue-100">Protokoll Schritt für Schritt erstellen</span></span><ArrowRight className="mb-1 h-6 w-6 transition-transform group-hover:translate-x-1" /></span>
            </button>
            <button onClick={() => setJoinOpen((value) => !value)} className="group flex min-h-44 flex-col items-start justify-between rounded-3xl border-2 border-[#D8E3EC] bg-white p-6 text-left text-[#153B66] shadow-sm transition-transform active:scale-[0.98]">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF1F6]"><QrCode className="h-7 w-7" /></span>
              <span className="flex w-full items-end justify-between gap-4"><span><span className="block text-xl font-bold">Unfall beitreten</span><span className="mt-1 block text-sm text-slate-500">Mit Code oder QR-Scan verbinden</span></span><ChevronRight className="mb-1 h-6 w-6 transition-transform group-hover:translate-x-1" /></span>
            </button>
          </section>

          {joinOpen && <section className="mt-4 rounded-3xl border border-[#C9D9E5] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-[#153B66]">Beitrittscode eingeben</h2><p className="mt-1 text-sm text-slate-500">Den sechsstelligen Code erhalten Sie von der anderen Partei.</p></div><Button variant="ghost" size="icon" onClick={() => setJoinOpen(false)}><X className="h-5 w-5" /></Button></div><div className="mt-4 flex gap-2"><Input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={6} placeholder="z. B. A7K9P2" className={`${fieldClass} font-mono tracking-[0.2em]`} /><Button className="h-12 rounded-xl bg-[#153B66] px-5" onClick={() => toast.info("Die Verbindung ist erst mit Backend-Anbindung verfügbar.")}>Beitreten</Button></div></section>}

          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-[#102F52]">Meine letzten Fälle</h2><Button variant="ghost" className="text-[#39719D]">Alle anzeigen</Button></div>
            <div className="space-y-3">
              {cases.slice(0, 3).map((item) => <article key={item.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EDF3F7] text-[#153B66]"><FileText className="h-6 w-6" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-bold text-[#153B66]">{item.location}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status === "Entwurf" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{item.status}</span></div><p className="mt-1 truncate text-sm text-slate-500">{item.date} · {item.plate}</p></div><ChevronRight className="h-5 w-5 shrink-0 text-slate-400" /></article>)}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] pb-28 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={back} className="h-11 w-11 rounded-xl" aria-label="Zurück"><ArrowLeft className="h-6 w-6 text-[#153B66]" /></Button>
            <div className="text-center"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Schritt {step + 1} von 6</p><p className="font-bold text-[#153B66]">{steps[step]}</p></div>
            <div className="flex h-11 w-11 items-center justify-center"><img src="/assets/unfallklar-logo.png" alt="" className="h-9 w-9 rounded-lg object-cover" /></div>
          </div>
          <Progress value={((step + 1) / 6) * 100} className="mt-3 h-1.5 bg-slate-200 [&>div]:bg-[#39719D]" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-7">
        <div className="mb-7"><p className="mb-2 text-sm font-semibold text-[#39719D]">{String(step + 1).padStart(2, "0")} — {steps[step]}</p><h1 className="text-2xl font-bold tracking-tight text-[#102F52]">{["Wann und wo ist es passiert?", "Angaben zu Ihnen und Ihrem Fahrzeug", "Was geschah unmittelbar davor?", "Schäden sicher dokumentieren", "Unfallstelle skizzieren", "Prüfen und unterschreiben"][step]}</h1><p className="mt-2 text-sm leading-relaxed text-slate-500">{["Erfassen Sie die grundlegenden Informationen zum Unfall.", "Diese Daten werden für das gemeinsame Protokoll benötigt.", "Wählen Sie alle Situationen aus, die auf Ihr Fahrzeug zutreffen.", "Fotografieren Sie Schäden und relevante Details vor Ort.", "Zeichnen Sie Strassenverlauf, Fahrzeuge und Fahrtrichtung ein.", "Kontrollieren Sie Ihre Angaben vor dem Abschluss."][step]}</p></div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          {step === 0 && <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4"><Field label="Datum"><Input type="date" value={data.date} onChange={(e) => update("date", e.target.value)} className={fieldClass} /></Field><Field label="Uhrzeit"><Input type="time" value={data.time} onChange={(e) => update("time", e.target.value)} className={fieldClass} /></Field></div>
            <Field label="Unfallort"><div className="space-y-2"><Input value={data.location} onChange={(e) => update("location", e.target.value)} placeholder="Strasse, Ort" className={fieldClass} /><Button type="button" variant="outline" onClick={locate} disabled={locating} className="h-12 w-full rounded-xl border-[#B8CDDC] text-[#153B66]"><LocateFixed className={`mr-2 h-5 w-5 ${locating ? "animate-spin" : ""}`} />{locating ? "Standort wird ermittelt …" : "Aktuellen Standort verwenden"}</Button></div></Field>
            <Field label="Gab es Verletzte?"><div className="grid grid-cols-2 gap-3">{["nein", "ja"].map((value) => <button key={value} type="button" onClick={() => update("injured", value)} className={`h-14 rounded-xl border-2 text-base font-semibold capitalize ${data.injured === value ? value === "ja" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-[#153B66] bg-[#EDF3F7] text-[#153B66]" : "border-slate-200 text-slate-600"}`}>{value === "ja" ? "Ja, Verletzte" : "Nein"}</button>)}</div>{data.injured === "ja" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">Bei Verletzten: Unfallstelle sichern und Notruf 112 wählen.</p>}</Field>
            <Field label="Zeugen"><Textarea value={data.witnesses} onChange={(e) => update("witnesses", e.target.value)} placeholder="Name und Kontaktangaben (optional)" className="min-h-24 rounded-xl text-base" /></Field>
          </div>}

          {step === 1 && <div className="space-y-7">
            <SectionTitle icon={<UserRound />} title="Fahrerin / Fahrer" />
            <div className="space-y-5"><Field label="Vor- und Nachname"><Input value={data.driverName} onChange={(e) => update("driverName", e.target.value)} placeholder="Max Mustermann" className={fieldClass} /></Field><Field label="Adresse"><Input value={data.driverAddress} onChange={(e) => update("driverAddress", e.target.value)} placeholder="Strasse, PLZ Ort" className={fieldClass} /></Field><Field label="Telefon"><Input type="tel" value={data.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+41 79 000 00 00" className={fieldClass} /></Field></div>
            <div className="border-t border-slate-100 pt-6"><SectionTitle icon={<Car />} title="Fahrzeug & Versicherung" /></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="Kennzeichen"><Input value={data.plate} onChange={(e) => update("plate", e.target.value.toUpperCase())} placeholder="ZH 123 456" className={`${fieldClass} font-semibold uppercase`} /></Field><Field label="Fahrzeug"><Input value={data.vehicle} onChange={(e) => update("vehicle", e.target.value)} placeholder="Marke und Modell" className={fieldClass} /></Field><Field label="Versicherung"><Input value={data.insurer} onChange={(e) => update("insurer", e.target.value)} placeholder="Versicherungsgesellschaft" className={fieldClass} /></Field><Field label="Policennummer"><Input value={data.policy} onChange={(e) => update("policy", e.target.value)} placeholder="Nummer der Police" className={fieldClass} /></Field></div>
          </div>}

          {step === 2 && <div className="space-y-3">{situations.map((situation, index) => { const selected = data.situations.includes(index); return <label key={situation} className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border-2 p-4 transition-colors ${selected ? "border-[#39719D] bg-[#EDF4F8]" : "border-slate-200 bg-white"}`}><Checkbox checked={selected} onCheckedChange={() => update("situations", selected ? data.situations.filter((value) => value !== index) : [...data.situations, index])} className="h-6 w-6 rounded-md border-slate-300 data-[state=checked]:border-[#153B66] data-[state=checked]:bg-[#153B66]" /><span className="flex-1 text-sm font-medium leading-snug text-slate-700"><span className="mr-2 text-xs font-bold text-[#39719D]">{index + 1}.</span>{situation}</span></label>; })}<p className="pt-3 text-center text-sm font-medium text-slate-500">{data.situations.length} Situation{data.situations.length === 1 ? "" : "en"} ausgewählt</p></div>}

          {step === 3 && <div className="space-y-6"><Field label="Sichtbare Schäden am Fahrzeug"><Textarea value={data.damage} onChange={(e) => update("damage", e.target.value)} placeholder="Beschreiben Sie Lage und Art der Schäden …" className="min-h-28 rounded-xl text-base" /></Field><Field label="Weitere Bemerkungen"><Textarea value={data.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Zusätzliche Beobachtungen (optional)" className="min-h-24 rounded-xl text-base" /></Field><div><Label className="mb-3 block text-sm font-semibold text-slate-700">Fotos</Label><label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#9FBACD] bg-[#F7FAFC] p-5 text-center"><Camera className="mb-2 h-8 w-8 text-[#39719D]" /><span className="font-semibold text-[#153B66]">Fotos aufnehmen oder auswählen</span><span className="mt-1 text-xs text-slate-500">Übersicht, Schäden, Kennzeichen und Spuren</span><input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} /></label></div>{data.photos.length > 0 && <div className="grid grid-cols-3 gap-3">{data.photos.map((photo, index) => <div key={photo} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100"><img src={photo} alt={`Unfallfoto ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => update("photos", data.photos.filter((_, photoIndex) => photoIndex !== index))} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/75 text-white" aria-label="Foto löschen"><Trash2 className="h-4 w-4" /></button></div>)}</div>}</div>}

          {step === 4 && <div className="space-y-5"><div className="rounded-xl bg-[#EDF4F8] p-4 text-sm leading-relaxed text-[#153B66]"><strong>Tipp:</strong> Markieren Sie Strassen, Fahrtrichtungen, Fahrzeuge A und B sowie den Kollisionspunkt.</div><DrawingCanvas label="Unfallskizze" height={320} onChange={(value) => update("hasSketch", value)} /><div className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1.5">A = Mein Fahrzeug</span><span className="rounded-full bg-slate-100 px-3 py-1.5">B = Anderes Fahrzeug</span><span className="rounded-full bg-slate-100 px-3 py-1.5">× = Aufprall</span></div></div>}

          {step === 5 && <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2"><Summary icon={<Clock3 />} label="Datum & Zeit" value={`${data.date || "—"} · ${data.time || "—"}`} /><Summary icon={<MapPin />} label="Unfallort" value={data.location || "Nicht angegeben"} /><Summary icon={<UserRound />} label="Fahrer/in" value={data.driverName || "Nicht angegeben"} /><Summary icon={<Car />} label="Fahrzeug" value={`${data.plate || "Ohne Kennzeichen"}${data.vehicle ? ` · ${data.vehicle}` : ""}`} /><Summary icon={<ShieldCheck />} label="Versicherung" value={data.insurer || "Nicht angegeben"} /><Summary icon={<Camera />} label="Dokumentation" value={`${data.photos.length} Fotos · ${data.hasSketch ? "Skizze vorhanden" : "ohne Skizze"}`} /></div><div className="rounded-2xl border border-slate-200 p-4"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Unfallhergang</p>{selectedSummary.length ? <ul className="space-y-1.5">{selectedSummary.map((item) => <li key={item} className="flex gap-2 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{item}</li>)}</ul> : <p className="text-sm text-slate-500">Keine Standardsituation ausgewählt.</p>}</div><DrawingCanvas label="Unterschrift Fahrer/in" height={170} onChange={(value) => update("hasSignature", value)} /><p className="text-xs leading-relaxed text-slate-500">Mit Ihrer Unterschrift bestätigen Sie die Richtigkeit Ihrer Angaben. Die Unterschrift stellt kein Schuldanerkenntnis dar.</p></div>}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div className="mx-auto flex max-w-3xl gap-3"><Button variant="outline" onClick={back} className="h-14 w-14 shrink-0 rounded-2xl border-slate-300" aria-label="Zurück"><ArrowLeft className="h-5 w-5" /></Button>{step < 5 ? <Button onClick={next} className="h-14 flex-1 rounded-2xl bg-[#153B66] text-base font-semibold hover:bg-[#102F52]">Weiter zu {steps[step + 1]}<ArrowRight className="ml-2 h-5 w-5" /></Button> : <Button onClick={complete} disabled={!data.hasSignature} className="h-14 flex-1 rounded-2xl bg-emerald-700 text-base font-semibold hover:bg-emerald-800 disabled:bg-slate-300"><Check className="mr-2 h-5 w-5" />Protokoll abschliessen</Button>}</div></div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-2 block text-sm font-semibold text-slate-700">{label}</Label>{children}</div>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="mb-4 flex items-center gap-3 text-[#153B66]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDF3F7] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><h2 className="text-lg font-bold">{title}</h2></div>;
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex gap-3 rounded-2xl bg-[#F6F8FA] p-4"><span className="mt-0.5 text-[#39719D] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div></div>;
}
