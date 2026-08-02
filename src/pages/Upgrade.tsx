import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Check, CreditCard, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BillingError, createCheckout, getPlanEntitlement, type Plan, type PlanEntitlement } from "@/lib/billing";

const planNames: Record<Plan, string> = { free: "Free", pro: "Pro", fleet: "Fleet" };

export default function Upgrade() {
  const { user, profile, isAnonymous } = useAuth();
  const [params] = useSearchParams();
  const [entitlement, setEntitlement] = useState<PlanEntitlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<"pro" | "fleet" | null>(null);
  const [vehicles, setVehicles] = useState(1);
  const fleetEligible = Boolean(profile?.org_id && ["fleet_manager", "admin"].includes(profile.role));

  const load = async () => {
    if (!user) { setLoading(false); return; }
    try { setEntitlement(await getPlanEntitlement()); } catch { setEntitlement(null); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [user?.id]);
  useEffect(() => {
    if (params.get("checkout") === "success") toast.success("Zahlung abgeschlossen. Ihr Plan wird synchronisiert.");
    if (params.get("checkout") === "cancelled") toast.info("Der Checkout wurde abgebrochen.");
  }, [params]);

  const checkout = async (plan: "pro" | "fleet") => {
    if (!user || isAnonymous) return;
    setCheckoutPlan(plan);
    try {
      window.location.assign(await createCheckout(plan, plan === "fleet" ? vehicles : 1));
    } catch (error) {
      const code = error instanceof BillingError ? error.code : "checkout_failed";
      toast.error(code === "billing_not_configured" ? "Stripe ist noch nicht vollständig konfiguriert." : "Der Checkout konnte nicht gestartet werden.");
      setCheckoutPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b bg-white"><div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4"><Button asChild variant="ghost" size="icon"><Link to="/" aria-label="Zurück"><ArrowLeft className="h-5 w-5" /></Link></Button><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Pläne & Abrechnung</p><h1 className="text-xl font-bold">Passenden Plan wählen</h1></div></div></header>
      <main className="mx-auto max-w-6xl px-5 py-10">
        {params.get("reason") === "limit" && <div className="mb-7 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-bold">Free-Limit erreicht</p><p className="mt-1 text-sm text-amber-800">Im Free-Plan ist ein Unfallfall enthalten. Wählen Sie Pro oder Fleet, um weitere Fälle zu erstellen.</p></div></div>}
        <div className="mb-8 text-center"><h2 className="text-3xl font-bold tracking-tight">Ein Plan für jede Nutzung</h2><p className="mx-auto mt-3 max-w-2xl text-slate-600">Starten Sie kostenlos und wechseln Sie bei Bedarf zu unbegrenzten Fällen oder flottenbasierter Abrechnung.</p>{loading ? <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-primary" /> : entitlement && <Badge variant="secondary" className="mt-4">Aktueller Plan: {planNames[entitlement.plan]}</Badge>}</div>
        <section className="grid gap-5 lg:grid-cols-3">
          <PlanCard icon={<CreditCard />} title="Free" subtitle="Für den ersten Unfall" features={["1 Unfallfall", "Digitales Unfallprotokoll", "PDF nach Abschluss"]} current={entitlement?.plan === "free"}><Button variant="outline" className="w-full" disabled>Inklusive</Button></PlanCard>
          <PlanCard icon={<UserRound />} title="Pro" subtitle="Für Privatpersonen" features={["Unbegrenzte Unfallfälle", "Geräteübergreifende Speicherung", "PDF-Downloads"]} highlighted current={entitlement?.plan === "pro"}>{entitlement?.plan === "pro" ? <Button className="w-full" disabled>Aktueller Plan</Button> : <CheckoutButton signedIn={Boolean(user && !isAnonymous)} loading={checkoutPlan === "pro"} onClick={() => void checkout("pro")} label="Pro mit Stripe wählen" />}</PlanCard>
          <PlanCard icon={<Building2 />} title="Fleet" subtitle="Pro Fahrzeug und Monat" features={["Unbegrenzte Organisationsfälle", "Flotten-Portal & Fahrer", "Abrechnung nach Fahrzeuganzahl"]} current={entitlement?.plan === "fleet"}><div className="mb-3"><Label htmlFor="vehicle-count">Anzahl Fahrzeuge</Label><Input id="vehicle-count" type="number" min={1} max={500} value={vehicles} onChange={(event) => setVehicles(Math.min(500, Math.max(1, Number(event.target.value) || 1)))} className="mt-2" disabled={!fleetEligible || entitlement?.plan === "fleet"} /></div>{entitlement?.plan === "fleet" ? <Button className="w-full" disabled>Aktueller Plan</Button> : fleetEligible ? <CheckoutButton signedIn={Boolean(user && !isAnonymous)} loading={checkoutPlan === "fleet"} onClick={() => void checkout("fleet")} label="Fleet mit Stripe wählen" /> : <Button variant="outline" className="w-full" disabled>Nur für Flottenmanager</Button>}</PlanCard>

        </section>
        {(!user || isAnonymous) && <Card className="mx-auto mt-7 max-w-xl rounded-2xl"><CardContent className="p-5 text-center"><p className="font-semibold">Für ein Upgrade benötigen Sie ein Konto.</p><p className="mt-1 text-sm text-slate-500">Melden Sie sich an; Ihr Free-Fall bleibt auf diesem Gerät erhalten.</p><Button asChild className="mt-4"><Link to="/auth?redirect=/upgrade">Anmelden und upgraden</Link></Button></CardContent></Card>}
      </main>
    </div>
  );
}

function PlanCard({ icon, title, subtitle, features, highlighted = false, current = false, children }: { icon: React.ReactNode; title: string; subtitle: string; features: string[]; highlighted?: boolean; current?: boolean; children: React.ReactNode }) {
  return <Card className={`relative rounded-3xl ${highlighted ? "border-primary shadow-lg shadow-primary/10" : ""}`}>{current && <Badge className="absolute right-5 top-5">Aktuell</Badge>}<CardHeader><span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><CardTitle>{title}</CardTitle><p className="text-sm text-slate-500">{subtitle}</p></CardHeader><CardContent><ul className="mb-6 space-y-3">{features.map((feature) => <li key={feature} className="flex gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul>{children}</CardContent></Card>;
}
function CheckoutButton({ signedIn, loading, onClick, label }: { signedIn: boolean; loading: boolean; onClick: () => void; label: string }) { return signedIn ? <Button onClick={onClick} disabled={loading} className="w-full">{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{loading ? "Stripe Checkout wird geöffnet…" : label}</Button> : <Button asChild className="w-full"><Link to="/auth?redirect=/upgrade">Anmelden</Link></Button>; }
