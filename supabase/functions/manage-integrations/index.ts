import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const allowedScopes = new Set(["incidents:read", "pdf:read"]);

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return false;
    return !/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch { return false; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const body = await req.json();
    const action = body.action;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await service.from("profiles").select("org_id, role").eq("id", authData.user.id).single();
    if (!profile?.org_id || !["insurer_agent", "admin"].includes(profile.role)) return json({ error: "forbidden" }, 403);

    if (action === "list") {
      const [{ data: integrations, error: integrationError }, { data: keys, error: keyError }] = await Promise.all([
        service.from("integrations").select("id, name, channel, endpoint_url, email, schema_version, mapping_profile, active, created_at, updated_at").eq("org_id", profile.org_id).order("created_at", { ascending: false }),
        service.from("api_keys").select("id, name, key_prefix, scopes, last_used_at, revoked_at, created_at").eq("org_id", profile.org_id).order("created_at", { ascending: false }),
      ]);
      if (integrationError || keyError) throw integrationError ?? keyError;
      return json({ integrations, apiKeys: keys });
    }

    if (action === "create_webhook") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl.trim() : "";
      if (!name || name.length > 100 || !validEndpoint(endpointUrl)) return json({ error: "invalid_webhook" }, 400);
      const master = Deno.env.get("WEBHOOK_MASTER_SECRET");
      if (!master) return json({ error: "webhook_secret_not_configured" }, 503);
      const id = crypto.randomUUID();
      const signingSecret = await hmacHex(master, `integration:${id}`);
      const { data, error } = await service.from("integrations").insert({ id, org_id: profile.org_id, name, channel: "webhook", endpoint_url: endpointUrl, schema_version: "incident.v1", secret_hash: await sha256(signingSecret) }).select("id, name, channel, endpoint_url, active, created_at").single();
      if (error) throw error;
      console.log("[manage-integrations] webhook created", { integrationId: id, orgId: profile.org_id });
      return json({ integration: data, signingSecret }, 201);
    }

    if (action === "create_api_key") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const scopes = Array.isArray(body.scopes) ? body.scopes.filter((scope: unknown) => typeof scope === "string" && allowedScopes.has(scope)) : [];
      if (!name || name.length > 100 || !scopes.length) return json({ error: "invalid_api_key" }, 400);
      const random = crypto.getRandomValues(new Uint8Array(32));
      const rawKey = `uk_live_${base64Url(random)}`;
      const integrationId = crypto.randomUUID();
      const { error: integrationError } = await service.from("integrations").insert({ id: integrationId, org_id: profile.org_id, name, channel: "api", schema_version: "incident.v1" });
      if (integrationError) throw integrationError;
      const { data, error } = await service.from("api_keys").insert({ org_id: profile.org_id, name, key_hash: await sha256(rawKey), key_prefix: rawKey.slice(0, 16), scopes }).select("id, name, key_prefix, scopes, created_at").single();
      if (error) {
        await service.from("integrations").delete().eq("id", integrationId);
        throw error;
      }
      console.log("[manage-integrations] API key created", { keyId: data.id, orgId: profile.org_id });
      return json({ apiKey: data, key: rawKey }, 201);
    }

    if (action === "revoke_api_key") {
      const keyId = typeof body.keyId === "string" ? body.keyId : "";
      const { data, error } = await service.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId).eq("org_id", profile.org_id).is("revoked_at", null).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "not_found" }, 404);
      return json({ status: "revoked" });
    }

    if (action === "toggle_integration") {
      const integrationId = typeof body.integrationId === "string" ? body.integrationId : "";
      const active = body.active === true;
      const { data, error } = await service.from("integrations").update({ active, updated_at: new Date().toISOString() }).eq("id", integrationId).eq("org_id", profile.org_id).select("id, active").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "not_found" }, 404);
      return json({ integration: data });
    }

    if (action === "test_webhook") {
      const integrationId = typeof body.integrationId === "string" ? body.integrationId : "";
      const { data: integration } = await service.from("integrations").select("id").eq("id", integrationId).eq("org_id", profile.org_id).eq("channel", "webhook").single();
      if (!integration) return json({ error: "not_found" }, 404);
      const { data: orgProfiles } = await service.from("profiles").select("id").eq("org_id", profile.org_id);
      const profileIds = (orgProfiles ?? []).map((item: any) => item.id);
      const { data: parties } = profileIds.length ? await service.from("incident_parties").select("incident_id").in("profile_id", profileIds) : { data: [] };
      const incidentIds = [...new Set((parties ?? []).map((party: any) => party.incident_id))];
      const { data: submission } = incidentIds.length ? await service.from("submissions").select("id, incident_id").in("incident_id", incidentIds).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
      if (!submission) return json({ error: "no_example_incident" }, 409);
      const response = await fetch("https://itdkfzzajyxfofnrgkqx.supabase.co/functions/v1/push-webhook", { method: "POST", headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: submission.id, incidentId: submission.incident_id, integrationId, test: true }) });
      const result = await response.json();
      return json(result, response.status);
    }

    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    console.error("[manage-integrations] request failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "integration_management_failed" }, 500);
  }
});
