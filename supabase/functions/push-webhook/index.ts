import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildIncidentExport, incidentBelongsToOrg } from "../_shared/incident-export.ts";
import { validateWebhookEndpoint } from "../_shared/safe-webhook.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivedSecret(integrationId: string) {
  const master = Deno.env.get("WEBHOOK_MASTER_SECRET");
  if (!master) throw new Error("webhook_secret_not_configured");
  return hmacHex(master, `integration:${integrationId}`);
}

async function deliver(service: any, integration: any, submissionId: string, document: unknown, test = false) {
  const payload = JSON.stringify(document);
  const secret = await derivedSecret(integration.id);
  const signature = await hmacHex(secret, payload);
  const idempotencyKey = test ? `test:${crypto.randomUUID()}` : `${submissionId}:${integration.id}:incident.submitted`;
  const { data: existing } = test ? { data: [] } : await service.from("delivery_attempts").select("attempt_no, status").eq("submission_id", submissionId).eq("integration_id", integration.id).order("attempt_no", { ascending: false });
  if (existing?.some((attempt: any) => attempt.status === "delivered")) return { integrationId: integration.id, status: "already_delivered" };
  let attemptNo = (existing?.[0]?.attempt_no ?? 0) + 1;

  while (attemptNo <= 5) {
    if (attemptNo > 1) await sleep(1000 * 2 ** (attemptNo - 2));
    let responseCode: number | null = null;
    let errorMessage: string | null = null;
    try {
      const endpoint = await validateWebhookEndpoint(integration.endpoint_url);
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `sha256=${signature}`,
          "Idempotency-Key": idempotencyKey,
          "X-Event-Type": "incident.submitted",
          "User-Agent": "Unfallprotokoll-Webhooks/1.0",
        },
        body: payload,
      });
      responseCode = response.status;
      if (response.ok) {
        if (!test) await service.from("delivery_attempts").insert({ submission_id: submissionId, integration_id: integration.id, attempt_no: attemptNo, status: "delivered", response_code: response.status });
        console.log("[push-webhook] delivery succeeded", { submissionId, integrationId: integration.id, attemptNo, responseCode, test });
        return { integrationId: integration.id, status: "delivered", attemptNo, responseCode };
      }
      errorMessage = `HTTP ${response.status}`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    if (!test) await service.from("delivery_attempts").insert({ submission_id: submissionId, integration_id: integration.id, attempt_no: attemptNo, status: "failed", response_code: responseCode, error: errorMessage?.slice(0, 1000) });
    console.warn("[push-webhook] delivery failed", { submissionId, integrationId: integration.id, attemptNo, responseCode, error: errorMessage, test });
    attemptNo += 1;
  }
  return { integrationId: integration.id, status: "failed", attemptNo: 5 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const body = await req.json();
    const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
    const incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
    const integrationId = typeof body.integrationId === "string" ? body.integrationId : null;
    const test = body.test === true;
    if (!/^[0-9a-f-]{36}$/i.test(submissionId) || !/^[0-9a-f-]{36}$/i.test(incidentId)) return json({ error: "invalid_request" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await service.from("profiles").select("org_id, role").eq("id", authData.user.id).maybeSingle();
    const { data: ownParty } = await service.from("incident_parties").select("id").eq("incident_id", incidentId).eq("profile_id", authData.user.id).maybeSingle();

    let integrations: any[] = [];
    if (test) {
      if (!integrationId || !profile?.org_id || !["insurer_agent", "admin"].includes(profile.role) || !(await incidentBelongsToOrg(service, incidentId, profile.org_id))) return json({ error: "forbidden" }, 403);
      const { data } = await service.from("integrations").select("*").eq("id", integrationId).eq("org_id", profile.org_id).eq("channel", "webhook").single();
      if (!data) return json({ error: "integration_not_found" }, 404);
      integrations = [data];
    } else {
      if (!ownParty) return json({ error: "forbidden" }, 403);
      const { data: partyProfiles } = await service.from("incident_parties").select("profile_id").eq("incident_id", incidentId);
      const profileIds = (partyProfiles ?? []).map((party: any) => party.profile_id).filter(Boolean);
      const { data: orgProfiles } = profileIds.length ? await service.from("profiles").select("org_id").in("id", profileIds).not("org_id", "is", null) : { data: [] };
      const orgIds = [...new Set((orgProfiles ?? []).map((item: any) => item.org_id))];
      if (orgIds.length) {
        const { data } = await service.from("integrations").select("*").in("org_id", orgIds).eq("channel", "webhook").eq("active", true);
        integrations = data ?? [];
      }
    }

    if (!integrations.length) return json({ status: "no_active_webhooks" });
    const document = await buildIncidentExport(service, incidentId);
    const task = Promise.all(integrations.map((integration) => deliver(service, integration, submissionId, document, test)));
    if (test) return json({ results: await task });
    EdgeRuntime.waitUntil(task);
    return json({ status: "accepted", integrations: integrations.length }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[push-webhook] request failed", { error: message });
    return json({ error: message === "webhook_secret_not_configured" ? message : "webhook_push_failed" }, 500);
  }
});
