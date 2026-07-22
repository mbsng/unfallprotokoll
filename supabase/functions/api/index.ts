import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildIncidentExport, incidentBelongsToOrg } from "../_shared/incident-export.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "X-RateLimit-Limit": "60" } });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const rawKey = authorization.slice(7).trim();
    if (!rawKey.startsWith("uk_live_") || rawKey.length < 32) return json({ error: "unauthorized" }, 401);

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const keyHash = await sha256(rawKey);
    const { data: apiKey, error: keyError } = await service.from("api_keys").select("id, org_id, scopes, revoked_at").eq("key_hash", keyHash).maybeSingle();
    if (keyError || !apiKey || apiKey.revoked_at) return json({ error: "unauthorized" }, 401);
    const { data: allowed, error: limitError } = await service.rpc("consume_api_rate_limit", { target_key_id: apiKey.id, request_limit: 60 });
    if (limitError) throw limitError;
    if (!allowed) return json({ error: "rate_limit_exceeded" }, 429);
    await service.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);

    const url = new URL(req.url);
    const route = url.pathname.match(/\/v1\/incidents(?:\/([0-9a-f-]{36}))?(?:\/(pdf))?\/?$/i);
    if (!route) return json({ error: "not_found" }, 404);
    const incidentId = route[1];
    const pdfRoute = route[2] === "pdf";
    const requiredScope = pdfRoute ? "pdf:read" : "incidents:read";
    if (!(apiKey.scopes ?? []).includes(requiredScope)) return json({ error: "insufficient_scope", required_scope: requiredScope }, 403);

    if (!incidentId) {
      const rawSince = url.searchParams.get("since");
      const since = rawSince ? new Date(rawSince) : new Date(0);
      if (Number.isNaN(since.getTime())) return json({ error: "invalid_since" }, 400);
      const { data: orgProfiles } = await service.from("profiles").select("id").eq("org_id", apiKey.org_id);
      const profileIds = (orgProfiles ?? []).map((profile: any) => profile.id);
      if (!profileIds.length) return json({ schema_version: "incident.v1", items: [], next_since: new Date().toISOString() });
      const { data: orgParties } = await service.from("incident_parties").select("incident_id").in("profile_id", profileIds);
      const incidentIds = [...new Set((orgParties ?? []).map((party: any) => party.incident_id))];
      if (!incidentIds.length) return json({ schema_version: "incident.v1", items: [], next_since: new Date().toISOString() });
      const { data: incidents, error } = await service.from("incidents").select("id").in("id", incidentIds).in("status", ["signed", "submitted"]).gte("updated_at", since.toISOString()).order("updated_at").limit(50);
      if (error) throw error;
      const items = [];
      for (const incident of incidents ?? []) items.push(await buildIncidentExport(service, incident.id));
      return json({ schema_version: "incident.v1", items, next_since: new Date().toISOString() });
    }

    if (!(await incidentBelongsToOrg(service, incidentId, apiKey.org_id))) return json({ error: "not_found" }, 404);
    if (pdfRoute) {
      const { data: submission } = await service.from("submissions").select("pdf_storage_path").eq("incident_id", incidentId).not("pdf_storage_path", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
      if (!submission?.pdf_storage_path) return json({ error: "pdf_not_found" }, 404);
      const { data: pdf, error } = await service.storage.from("incident-pdfs").download(submission.pdf_storage_path);
      if (error || !pdf) return json({ error: "pdf_not_found" }, 404);
      return new Response(await pdf.arrayBuffer(), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="incident-${incidentId}.pdf"`, "X-RateLimit-Limit": "60" } });
    }
    return json(await buildIncidentExport(service, incidentId));
  } catch (error) {
    console.error("[api] request failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "internal_error" }, 500);
  }
});
