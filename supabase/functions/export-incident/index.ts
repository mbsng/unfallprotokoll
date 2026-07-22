import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildIncidentExport, incidentBelongsToOrg } from "../_shared/incident-export.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const { incidentId } = await req.json();
    if (typeof incidentId !== "string" || !/^[0-9a-f-]{36}$/i.test(incidentId)) return json({ error: "invalid_incident" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

    const [{ data: ownParty }, { data: profile }] = await Promise.all([
      service.from("incident_parties").select("id").eq("incident_id", incidentId).eq("profile_id", authData.user.id).maybeSingle(),
      service.from("profiles").select("org_id, role").eq("id", authData.user.id).maybeSingle(),
    ]);
    const orgAccess = profile?.org_id && ["insurer_agent", "admin"].includes(profile.role)
      ? await incidentBelongsToOrg(service, incidentId, profile.org_id)
      : false;
    if (!ownParty && !orgAccess) return json({ error: "forbidden" }, 403);

    const document = await buildIncidentExport(service, incidentId);
    console.log("[export-incident] incident exported", { incidentId, userId: authData.user.id });
    return json(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[export-incident] export failed", { error: message });
    if (message === "incident_not_exportable") return json({ error: message }, 409);
    if (message === "incident_not_found") return json({ error: message }, 404);
    return json({ error: "export_failed" }, 500);
  }
});
