import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Camera, Car, Check, ChevronRight, Clock3, FileText, LocateFixed, MapPin, Plus, QrCode, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawingCanvas } from "@/components/DrawingCanvas";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { localeForLanguage } from "@/i18n";

interface AccidentData {
  date: string; time: string; location: string; injured: boolean; otherDamage: boolean; witnesses: string;
  driverName: string; driverAddress: string; phone: string; plate: string; vehicle: string;
  insurer: string; policy: string; situations: number[]; damage: string; notes: string;
  photos: string[]; hasSketch: boolean; hasSignature: boolean;
}

interface CaseItem { id: string; date: string; time: string; location: string; status: "draft" | "completed"; plate: string }

const initialCases: CaseItem[] = [
  { id: "UK-2408", date: "2025-05-18", time: "16:42", location: "Zürich, Hardbrücke", status: "draft", plate: "ZH 824 391" },
  { id: "UK-2311", date: "2025-02-03", time: "08:15", location: "Basel, Aeschenplatz", status: "completed", plate: "BS 118 602" },
  { id: "UK-2194", date: "2024-11-12", time: "19:30", location: "Bern, Wankdorf", status: "completed", plate: "BE 544 208" },
];

const emptyData = (): AccidentData => {
  const now = new Date();
  return { date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5), location: "", injured: false, otherDamage: false, witnesses: "", driverName: "", driverAddress: "", phone: "", plate: "", vehicle: "", insurer: "", policy: "", situations: [], damage: "", notes: "", photos: [], hasSketch: false, hasSignature: false };
};

const fieldClass = "h-12 rounded-xl border-slate-200 bg-white text-base focus-visible:ring-[#153B66]";

export default function Index() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const steps = t("wizard.steps", { returnObjects: true }) as string[];
  const titles = t("wizard.titles", { returnObjects: true }) as string[];
  const descriptions = t("wizard.descriptions", { returnObjects: true }) as string[];
  const circumstances = t("circumstances.items", { returnObjects: true }) as string[];
  const [view, setView] = useState<"home" | "wizard">("home");
  const [step, setStep] = useState(0);
  const [data, setData] = useState<AccidentData>(emptyData);
  const [cases, setCases] = useState(initialCases);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [locating, setLocating] = useState(false);

  const update = <K extends keyof AccidentData>(key: K, value: AccidentData[K]) => setData((previous) => ({ ...previous, [key]: value }));
  const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);
  const formatCaseDate = (item: CaseItem) => {
    const date = new Date(`${item.date}T${item.time}:00`);
    return `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" }).format(date)} · ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)}`;
  };

  const startAccident = () => { setData(emptyData()); setStep(0); setView("wizard"); window.scrollTo(0, 0); };
  const back = () => { if (step === 0) setView("home"); else { setStep((value) => value - 1); window.scrollTo(0, 0); } };
  const next = () => {
    if (step === 0 && !data.date) return toast.error(t("validation.dateRequired"));
    if (step === 0 && !data.location.trim()) return toast.error(t("validation.locationRequired"));
    setStep((value) => Math.min(value + 1, 5));
    window.scrollTo(0, 0);
  };

  const locate = () => {
    if (!navigator.geolocation) return toast.error(t("location.unsupported"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { update("location", `${coords.latitude.toLocaleString(locale, { maximumFractionDigits: 5 })}, ${coords.longitude.toLocaleString(locale, { maximumFractionDigits: 5 })}`); setLocating(false); toast.success(t("location.success")); },
      () => { setLocating(false); toast.error(t("location.error")); },
    );
  };

  const addPhotos = (files: FileList | null) => {
    if (files) update("photos", [...data.photos, ...Array.from(files).map((file) => URL.createObjectURL(file))]);
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return toast.error(t("join.invalid"));
    navigate(`/join/${code}`);
  };

  const complete = () => {
    if (!data.hasSignature) return toast.error(t("validation.signatureRequired"));
    setCases((previous) => [{ id: `UK-${Math.floor(1000 + Math.random() * 9000)}`, date: data.date, time: data.time, location: data.location || t("fields.notProvided"), status: "completed", plate: data.plate || t("fields.noPlate") }, ...previous]);
    setView("home");
    toast.success(t("wizard.saved"));
  };

  const selectedSummary = useMemo(() => data.situations.map((index) => circumstances[index]), [data.situations, circumstances]);

  if (view === "home") return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-5 pb-12 pt-8 md:pt-12">
        <section className="mb-8 md:flex md:items-end md:justify-between">
          <div><p className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#39719D]">{t("home.greeting")}</p><h1 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-[#102F52] md:text-4xl">{t("home.title")}</h1><p className="mt-3 max-w-lg text-base leading-relaxed text-slate-600">{t("home.intro")}</p></div>
          <div className="mt-5 flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 md:mt-0"><ShieldCheck className="h-4 w-4" />{t("app.localData")}</div>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <button onClick={startAccident} className="group flex min-h-44 flex-col items-start justify-between rounded-3xl bg-[#153B66] p-6 text-left text-white shadow-lg shadow-[#153B66]/15 active:scale-[0.98]"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Plus className="h-7 w-7" /></span><span className="flex w-full items-end justify-between gap-4"><span><span className="block text-xl font-bold">{t("home.new")}</span><span className="mt-1 block text-sm text-blue-100">{t("home.newHint")}</span></span><ArrowRight className="mb-1 h-6 w-6 group-hover:translate-x-1" /></span></button>
          <button onClick={() => setJoinOpen((value) => !value)} className="group flex min-h-44 flex-col items-start justify-between rounded-3xl border-2 border-[#D8E3EC] bg-white p-6 text-left text-[#153B66] shadow-sm active:scale-[0.98]"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF1F6]"><QrCode className="h-7 w-7" /></span><span className="flex w-full items-end justify-between gap-4"><span><span className="block text-xl font-bold">{t("home.join")}</span><span className="mt-1 block text-sm text-slate-500">{t("home.joinHint")}</span></span><ChevronRight className="mb-1 h-6 w-6 group-hover:translate-x-1" /></span></button>
        </section>
        {joinOpen && <section className="mt-4 rounded-3xl border border-[#C9D9E5] bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><h2 className="font-bold text-[#153B66]">{t("home.joinTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("home.joinDescription")}</p></div><Button variant="ghost" size="icon" onClick={() => setJoinOpen(false)} aria-label={t("app.close")}><X className="h-5 w-5" /></Button></div><div className="mt-4 flex gap-2"><Input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && join()} maxLength={6} placeholder={t("home.joinPlaceholder")} className={`${fieldClass} font-mono tracking-[0.2em]`} /><Button className="h-12 rounded-xl bg-[#153B66] px-5" onClick={join}>{t("home.joinButton")}</Button></div></section>}
        <section className="mt-10"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-[#102F52]">{t("home.recent")}</h2><Button variant="ghost" className="text-[#39719D]">{t("home.showAll")}</Button></div><div className="space-y-3">{cases.slice(0, 3).map((item) => <article key={item.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EDF3F7] text-[#153B66]"><FileText className="h-6 w-6" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-bold text-[#153B66]">{item.location}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{t(`home.${item.status}`)}</span></div><p className="mt-1 truncate text-sm text-slate-500">{formatCaseDate(item)} · {item.plate}</p></div><ChevronRight className="h-5 w-5 shrink-0 text-slate-400" /></article>)}</div></section>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F7FA] pb-28 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto max-w-3xl px-4 py-3"><div className="flex items-center justify-between gap-2"><Button variant="ghost" size="icon" onClick={back} className="h-11 w-11 shrink-0 rounded-xl" aria-label={t("app.back")}><ArrowLeft className="h-6 w-6 text-[#153B66]" /></Button><div className="min-w-0 text-center"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("wizard.stepOf", { current: formatNumber(step + 1), total: formatNumber(6) })}</p><p className="truncate font-bold text-[#153B66]">{steps[step]}</p></div><LanguageSwitcher /></div><Progress value={((step + 1) / 6) * 100} className="mt-3 h-1.5 bg-slate-200 [&>div]:bg-[#39719D]" /></div></header>
      <main className="mx-auto max-w-3xl px-5 py-7"><div className="mb-7"><p className="mb-2 text-sm font-semibold text-[#39719D]">{formatNumber(step + 1).padStart(2, "0")} — {steps[step]}</p><h1 className="text-2xl font-bold tracking-tight text-[#102F52]">{titles[step]}</h1><p className="mt-2 text-sm leading-relaxed text-slate-500">{descriptions[step]}</p></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          {step === 0 && <div className="space-y-6"><div className="grid grid-cols-2 gap-4"><Field number="1" label={t("fields.date")}><Input type="date" value={data.date} onChange={(event) => update("date", event.target.value)} className={fieldClass} /></Field><Field number="1" label={t("fields.time")}><Input type="time" value={data.time} onChange={(event) => update("time", event.target.value)} className={fieldClass} /></Field></div><Field number="2" label={t("fields.place")}><div className="space-y-2"><Input value={data.location} onChange={(event) => update("location", event.target.value)} placeholder={t("fields.placePlaceholder")} className={fieldClass} /><Button type="button" variant="outline" onClick={locate} disabled={locating} className="h-12 w-full rounded-xl border-[#B8CDDC] text-[#153B66]"><LocateFixed className={`mr-2 h-5 w-5 ${locating ? "animate-spin" : ""}`} />{t(locating ? "location.locating" : "location.useCurrent")}</Button></div></Field><Field number="3" label={t("fields.injured")}><div className="grid grid-cols-2 gap-3"><Choice active={!data.injured} onClick={() => update("injured", false)}>{t("fields.no")}</Choice><Choice active={data.injured} warning onClick={() => update("injured", true)}>{t("fields.yesInjured")}</Choice></div>{data.injured && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{t("fields.emergency")}</p>}</Field><Field number="4" label={t("fields.otherDamage")}><div className="grid grid-cols-2 gap-3"><Choice active={!data.otherDamage} onClick={() => update("otherDamage", false)}>{t("fields.no")}</Choice><Choice active={data.otherDamage} warning onClick={() => update("otherDamage", true)}>{t("fields.yesOtherDamage")}</Choice></div></Field><Field number="5" label={t("fields.witnesses")}><Textarea value={data.witnesses} onChange={(event) => update("witnesses", event.target.value)} placeholder={t("fields.witnessesPlaceholder")} className="min-h-24 rounded-xl text-base" /></Field></div>}
          {step === 1 && <div className="space-y-7"><SectionTitle number="6 & 9" icon={<UserRound />} title={t("fields.driver")} /><div className="space-y-5"><Field label={t("fields.fullName")}><Input value={data.driverName} onChange={(event) => update("driverName", event.target.value)} placeholder={t("fields.namePlaceholder")} className={fieldClass} /></Field><Field label={t("fields.address")}><Input value={data.driverAddress} onChange={(event) => update("driverAddress", event.target.value)} placeholder={t("fields.addressPlaceholder")} className={fieldClass} /></Field><Field label={t("fields.phone")}><Input type="tel" value={data.phone} onChange={(event) => update("phone", event.target.value)} placeholder={t("fields.phonePlaceholder")} className={fieldClass} /></Field></div><div className="border-t border-slate-100 pt-6"><SectionTitle number="7–8" icon={<Car />} title={t("fields.vehicleInsurance")} /></div><div className="grid gap-5 sm:grid-cols-2"><Field number="7" label={t("fields.plate")}><Input value={data.plate} onChange={(event) => update("plate", event.target.value.toUpperCase())} placeholder={t("fields.platePlaceholder")} className={`${fieldClass} font-semibold uppercase`} /></Field><Field number="7" label={t("fields.vehicle")}><Input value={data.vehicle} onChange={(event) => update("vehicle", event.target.value)} placeholder={t("fields.vehiclePlaceholder")} className={fieldClass} /></Field><Field number="8" label={t("fields.insurer")}><Input value={data.insurer} onChange={(event) => update("insurer", event.target.value)} placeholder={t("fields.insurerPlaceholder")} className={fieldClass} /></Field><Field number="8" label={t("fields.policy")}><Input value={data.policy} onChange={(event) => update("policy", event.target.value)} placeholder={t("fields.policyPlaceholder")} className={fieldClass} /></Field></div></div>}
          {step === 2 && <div className="space-y-3"><FieldBadge number="12" />{circumstances.map((circumstance, index) => { const selected = data.situations.includes(index); return <label key={index} className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border-2 p-4 ${selected ? "border-[#39719D] bg-[#EDF4F8]" : "border-slate-200"}`}><Checkbox checked={selected} onCheckedChange={() => update("situations", selected ? data.situations.filter((value) => value !== index) : [...data.situations, index])} className="h-6 w-6 rounded-md data-[state=checked]:border-[#153B66] data-[state=checked]:bg-[#153B66]" /><span className="flex-1 text-sm font-medium leading-snug text-slate-700"><span className="mr-2 text-xs font-bold text-[#39719D]">{formatNumber(index + 1)}.</span>{circumstance}</span></label>; })}<p className="pt-3 text-center text-sm font-medium text-slate-500">{t("circumstances.selected", { count: data.situations.length, formattedCount: formatNumber(data.situations.length) })}</p></div>}
          {step === 3 && <div className="space-y-6"><Field number="11" label={t("fields.visibleDamage")}><Textarea value={data.damage} onChange={(event) => update("damage", event.target.value)} placeholder={t("fields.damagePlaceholder")} className="min-h-28 rounded-xl text-base" /></Field><Field number="14" label={t("fields.remarks")}><Textarea value={data.notes} onChange={(event) => update("notes", event.target.value)} placeholder={t("fields.remarksPlaceholder")} className="min-h-24 rounded-xl text-base" /></Field><Field number="11" label={t("fields.photos")}><label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#9FBACD] bg-[#F7FAFC] p-5 text-center"><Camera className="mb-2 h-8 w-8 text-[#39719D]" /><span className="font-semibold text-[#153B66]">{t("fields.photoAction")}</span><span className="mt-1 text-xs text-slate-500">{t("fields.photoHint")}</span><input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(event) => addPhotos(event.target.files)} /></label></Field>{data.photos.length > 0 && <div className="grid grid-cols-3 gap-3">{data.photos.map((photo, index) => <div key={photo} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100"><img src={photo} alt={t("fields.photoAlt", { number: formatNumber(index + 1) })} className="h-full w-full object-cover" /><button type="button" onClick={() => update("photos", data.photos.filter((_, photoIndex) => photoIndex !== index))} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/75 text-white" aria-label={t("fields.deletePhoto")}><Trash2 className="h-4 w-4" /></button></div>)}</div>}</div>}

          {step === 4 && <div className="space-y-5"><div><FieldBadge number="10" /><p className="text-sm font-semibold text-slate-700">{t("fields.initialImpact")}</p></div><FieldBadge number="13" /><div className="rounded-xl bg-[#EDF4F8] p-4 text-sm leading-relaxed text-[#153B66]"><strong>{t("sketch.tipTitle")}</strong> {t("sketch.tip")}</div><DrawingCanvas label={t("fields.sketch")} height={320} onChange={(value) => update("hasSketch", value)} /><div className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1.5">{t("sketch.myVehicle")}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{t("sketch.otherVehicle")}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{t("sketch.impact")}</span></div></div>}
          {step === 5 && <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2"><Summary number="1" icon={<Clock3 />} label={t("fields.dateTime")} value={formatCaseDate({ ...initialCases[0], date: data.date, time: data.time })} /><Summary number="2" icon={<MapPin />} label={t("fields.place")} value={data.location || t("fields.notProvided")} /><Summary number="9" icon={<UserRound />} label={t("fields.driver")} value={data.driverName || t("fields.notProvided")} /><Summary number="7" icon={<Car />} label={t("fields.vehicle")} value={`${data.plate || t("fields.noPlate")}${data.vehicle ? ` · ${data.vehicle}` : ""}`} /><Summary number="8" icon={<ShieldCheck />} label={t("fields.insurer")} value={data.insurer || t("fields.notProvided")} /><Summary number="11–13" icon={<Camera />} label={t("fields.documentation")} value={`${t("fields.photosCount", { formattedCount: formatNumber(data.photos.length) })} · ${t(data.hasSketch ? "fields.sketchAvailable" : "fields.withoutSketch")}`} /></div><div className="rounded-2xl border border-slate-200 p-4"><FieldBadge number="12" /><p className="mb-2 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500">{t("summary.circumstances")}</p>{selectedSummary.length ? <ul className="space-y-1.5">{selectedSummary.map((item) => <li key={item} className="flex gap-2 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{item}</li>)}</ul> : <p className="text-sm text-slate-500">{t("summary.noneSelected")}</p>}</div><FieldBadge number="15" /><DrawingCanvas label={t("fields.signature")} height={170} onChange={(value) => update("hasSignature", value)} /><p className="text-xs leading-relaxed text-slate-500">{t("summary.disclaimer")}</p></div>}
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div className="mx-auto flex max-w-3xl gap-3"><Button variant="outline" onClick={back} className="h-14 w-14 shrink-0 rounded-2xl border-slate-300" aria-label={t("app.back")}><ArrowLeft className="h-5 w-5" /></Button>{step < 5 ? <Button onClick={next} className="h-14 flex-1 rounded-2xl bg-[#153B66] text-base font-semibold hover:bg-[#102F52]">{t("wizard.next", { step: steps[step + 1] })}<ArrowRight className="ml-2 h-5 w-5" /></Button> : <Button onClick={complete} className="h-14 flex-1 rounded-2xl bg-emerald-700 text-base font-semibold hover:bg-emerald-800"><Check className="mr-2 h-5 w-5" />{t("wizard.complete")}</Button>}</div></div>
    </div>
  );
}

export function AppHeader() {
  const { t } = useTranslation();
  return <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><img src="/assets/unfallklar-logo.png" alt={t("app.name")} className="h-11 w-11 shrink-0 rounded-xl object-cover" /><div className="min-w-0"><p className="text-xl font-bold tracking-tight text-[#153B66]">{t("app.name")}</p><p className="truncate text-xs font-medium text-slate-500">{t("app.statement")}</p></div></div><LanguageSwitcher /></div></header>;
}

function Field({ number, label, children }: { number?: string; label: string; children: React.ReactNode }) { return <div>{number && <FieldBadge number={number} />}<Label className="mb-2 block text-sm font-semibold text-slate-700">{label}</Label>{children}</div>; }
function FieldBadge({ number }: { number: string }) { const { t } = useTranslation(); return <span className="mb-1.5 inline-flex rounded-md bg-[#E7F0F6] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#285B82]">{t("fields.number", { number })}</span>; }
function SectionTitle({ number, icon, title }: { number: string; icon: React.ReactNode; title: string }) { return <div className="mb-4 flex items-center gap-3 text-[#153B66]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDF3F7] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><FieldBadge number={number} /><h2 className="text-lg font-bold">{title}</h2></div></div>; }
function Choice({ active, warning, onClick, children }: { active: boolean; warning?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`h-14 rounded-xl border-2 text-base font-semibold ${active ? warning ? "border-amber-500 bg-amber-50 text-amber-900" : "border-[#153B66] bg-[#EDF3F7] text-[#153B66]" : "border-slate-200 text-slate-600"}`}>{children}</button>; }
function Summary({ number, icon, label, value }: { number: string; icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3 rounded-2xl bg-[#F6F8FA] p-4"><span className="mt-0.5 text-[#39719D] [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="min-w-0"><FieldBadge number={number} /><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div></div>; }
