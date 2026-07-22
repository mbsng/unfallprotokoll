import { useEffect, useState } from "react";
import { ArrowLeft, Check, Clipboard, Code2, KeyRound, Loader2, Plus, RotateCw, Send, ShieldCheck, Webhook } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createApiKey, createWebhook, IntegrationError, listIntegrations, revokeApiKey, testWebhook, toggleIntegration, type ApiKeyMetadata, type Integration } from "@/lib/integrations";

export default function Integrations() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [webhookName, setWebhookName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [apiName, setApiName] = useState("");
  const [scopes, setScopes] = useState(["incidents:read", "pdf:read"]);
  const [working, setWorking] = useState(false);
  const [revealed, setRevealed] = useState<{ title: string; value: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await listIntegrations();
      setIntegrations(result.integrations);
      setApiKeys(result.apiKeys);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.org_id && ["insurer_agent", "admin"].includes(profile.role)) void load();
  }, [profile?.org_id, profile?.role]);
  if (!profile?.org_id || !["insurer_agent", "admin"].includes(profile.role)) return <Navigate to="/" replace />;

  const showError = (error: unknown) => {
    const code = error instanceof IntegrationError ? error.code : "integration_management_failed";
    toast.error(t(`integrations.errors.${code}`, { defaultValue: t("integrations.errors.integration_management_failed") }));
  };

  const addWebhook = async () => {
    if (!webhookName.trim() || !endpointUrl.trim()) return;
    setWorking(true);
    try {
      const result = await createWebhook(webhookName.trim(), endpointUrl.trim());
      setRevealed({ title: t("integrations.webhookSecret"), value: result.signingSecret });
      setWebhookName(""); setEndpointUrl("");
      await load();
    } catch (error) { showError(error); } finally { setWorking(false); }
  };

  const addApiKey = async () => {
    if (!apiName.trim() || !scopes.length) return;
    setWorking(true);
    try {
      const result = await createApiKey(apiName.trim(), scopes);
      setRevealed({ title: t("integrations.apiKey"), value: result.key });
      setApiName("");
      await load();
    } catch (error) { showError(error); } finally { setWorking(false); }
  };

  const test = async (id: string) => {
    try {
      const result = await testWebhook(id);
      const delivered = result.results?.some((item) => ["delivered", "already_delivered"].includes(item.status));
      toast[delivered ? "success" : "error"](t(delivered ? "integrations.testSuccess" : "integrations.testFailed"));
      await load();
    } catch (error) { showError(error); }
  };

  const copySecret = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.value);
    toast.success(t("integrations.copied"));
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4"><Button asChild variant="ghost" size="icon" className="rounded-xl"><Link to="/" aria-label={t("app.back")}><ArrowLeft className="h-5 w-5" /></Link></Button><div><p className="text-xs font-bold uppercase tracking-wider text-[#39719D]">{t("integrations.eyebrow")}</p><h1 className="text-xl font-bold text-[#153B66]">{t("integrations.title")}</h1></div></div></header>
      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5 flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Webhook className="h-5 w-5" /></span><div><h2 className="font-bold text-[#153B66]">{t("integrations.newWebhook")}</h2><p className="mt-1 text-sm text-slate-500">{t("integrations.webhookDescription")}</p></div></div><div className="space-y-4"><div><Label>{t("integrations.name")}</Label><Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} className="mt-2 h-11 rounded-xl" /></div><div><Label>{t("integrations.endpoint")}</Label><Input type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://api.versicherung.ch/webhooks" className="mt-2 h-11 rounded-xl font-mono text-sm" /></div><Button onClick={() => void addWebhook()} disabled={working || !webhookName.trim() || !endpointUrl.trim()} className="h-11 w-full rounded-xl bg-[#153B66]"><Plus className="mr-2 h-4 w-4" />{t("integrations.createWebhook")}</Button></div></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5 flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><KeyRound className="h-5 w-5" /></span><div><h2 className="font-bold text-[#153B66]">{t("integrations.newApiKey")}</h2><p className="mt-1 text-sm text-slate-500">{t("integrations.apiDescription")}</p></div></div><div className="space-y-4"><div><Label>{t("integrations.name")}</Label><Input value={apiName} onChange={(event) => setApiName(event.target.value)} className="mt-2 h-11 rounded-xl" /></div><div><Label>{t("integrations.scopes")}</Label><div className="mt-2 space-y-2">{["incidents:read", "pdf:read"].map((scope) => <label key={scope} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 font-mono text-sm"><Checkbox checked={scopes.includes(scope)} onCheckedChange={(checked) => setScopes((current) => checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope))} />{scope}</label>)}</div></div><Button onClick={() => void addApiKey()} disabled={working || !apiName.trim() || !scopes.length} className="h-11 w-full rounded-xl bg-[#153B66]"><Plus className="mr-2 h-4 w-4" />{t("integrations.createApiKey")}</Button></div></div>
        </section>

        <section><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-bold text-[#153B66]">{t("integrations.configured")}</h2><p className="mt-1 text-sm text-slate-500">{t("integrations.configuredDescription")}</p></div><Button variant="outline" size="icon" onClick={() => void load()} aria-label={t("integrations.refresh")}><RotateCw className="h-4 w-4" /></Button></div>{loading ? <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#39719D]" /></div> : <div className="grid gap-4 lg:grid-cols-2">{integrations.filter((item) => item.channel === "webhook").map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate font-bold text-[#153B66]">{item.name}</h3><Badge variant="secondary">Webhook</Badge></div><p className="mt-2 truncate font-mono text-xs text-slate-500">{item.endpoint_url}</p></div><Switch checked={item.active} onCheckedChange={async (active) => { try { await toggleIntegration(item.id, active); setIntegrations((current) => current.map((entry) => entry.id === item.id ? { ...entry, active } : entry)); } catch (error) { showError(error); } }} /></div><Button variant="outline" onClick={() => void test(item.id)} disabled={!item.active} className="mt-4 h-10 rounded-xl"><Send className="mr-2 h-4 w-4" />{t("integrations.test")}</Button></article>)}{apiKeys.map((key) => <article key={key.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-bold text-[#153B66]">{key.name}</h3><Badge variant="secondary">API</Badge>{key.revoked_at && <Badge variant="destructive">{t("integrations.revoked")}</Badge>}</div><p className="mt-2 font-mono text-sm text-slate-600">{key.key_prefix}••••••••</p><div className="mt-3 flex flex-wrap gap-1">{key.scopes.map((scope) => <Badge key={scope} variant="outline" className="font-mono text-[10px]">{scope}</Badge>)}</div><p className="mt-3 text-xs text-slate-500">{t("integrations.lastUsed")}: {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : t("integrations.never")}</p></div>{!key.revoked_at && <Button variant="ghost" size="sm" className="text-red-700" onClick={async () => { try { await revokeApiKey(key.id); await load(); } catch (error) { showError(error); } }}>{t("integrations.revoke")}</Button>}</div></article>)}</div>}</section>

        <section className="rounded-2xl bg-[#153B66] p-5 text-white"><div className="flex gap-3"><Code2 className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-bold">OpenAPI 3.0</h2><p className="mt-1 text-sm text-blue-100">{t("integrations.openapiHint")}</p><a href="/openapi.yaml" download className="mt-3 inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#153B66]">{t("integrations.downloadOpenapi")}</a></div></div></section>
      </main>

      <Dialog open={Boolean(revealed)} onOpenChange={(open) => !open && setRevealed(null)}><DialogContent><DialogHeader><span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span><DialogTitle>{revealed?.title}</DialogTitle><DialogDescription>{t("integrations.secretOnce")}</DialogDescription></DialogHeader><div className="rounded-xl bg-slate-950 p-4 font-mono text-sm text-emerald-300 break-all">{revealed?.value}</div><Button onClick={() => void copySecret()} className="h-11 rounded-xl bg-[#153B66]"><Clipboard className="mr-2 h-4 w-4" />{t("integrations.copy")}</Button><p className="flex items-start gap-2 text-xs text-slate-500"><Check className="h-4 w-4 shrink-0 text-emerald-600" />{t("integrations.secretStoredHashed")}</p></DialogContent></Dialog>
    </div>
  );
}
