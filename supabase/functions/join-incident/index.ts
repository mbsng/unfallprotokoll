import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const { code: rawCode, action = "preview" } = await req.json();
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{8}$/.test(code)) return json({ error: "invalid_code" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: incident, error: incidentError } = await serviceClient
      .from("incidents")
      .select("id, share_code, status, occurred_at, location_text, version")
      .eq("share_code", code)
      .maybeSingle();

    if (incidentError) {
      console.error("[join-incident] incident lookup failed", { error: incidentError.message });
      return json({ error: "lookup_failed" }, 500);
    }
    if (!incident || incident.status === "closed" || incident.status === "submitted") {
      return json({ error: "not_found" }, 404);
    }

    const preview = {
      shareCode: incident.share_code,
      occurredAt: incident.occurred_at,
      locationText: incident.location_text,
    };
    if (action === "preview") return json({ incident: preview });
    if (action !== "join") return json({ error: "invalid_action" }, 400);
    if (incident.status === "signed") return json({ error: "already_signed" }, 409);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claims, error: authError } = await authClient.auth.getUser(token);
    if (authError || !claims.user) return json({ error: "unauthorized" }, 401);

    const { data: existingParties, error: partiesError } = await serviceClient
      .from("incident_parties")
      .select("id, party_label, profile_id, version")
      .eq("incident_id", incident.id);
    if (partiesError) {
      console.error("[join-incident] party lookup failed", { error: partiesError.message });
      return json({ error: "lookup_failed" }, 500);
    }

    const ownParty = existingParties?.find((party) => party.profile_id === claims.user.id);
    if (ownParty?.party_label === "A") return json({ error: "already_participant" }, 409);
    if (ownParty) {
      return json({
        incident: preview,
        draftRef: {
          incidentId: incident.id,
          partyId: ownParty.id,
          partyLabel: ownParty.party_label,
          shareCode: incident.share_code,
          incidentVersion: incident.version,
          partyVersion: ownParty.version,
        },
      });
    }
    if (existingParties?.some((party) => party.party_label === "B")) return json({ error: "party_b_exists" }, 409);

    const { data: party, error: insertError } = await serviceClient
      .from("incident_parties")
      .insert({ incident_id: incident.id, party_label: "B", profile_id: claims.user.id })
      .select("id, party_label, version")
      .single();
    if (insertError) {
      console.error("[join-incident] party creation failed", { error: insertError.message });
      return json({ error: insertError.code === "23505" ? "party_b_exists" : "join_failed" }, insertError.code === "23505" ? 409 : 500);
    }

    const nextVersion = incident.version + 1;
    const { data: updatedIncident, error: updateError } = await serviceClient
      .from("incidents")
      .update({ status: "joined", version: nextVersion, updated_at: new Date().toISOString() })
      .eq("id", incident.id)
      .eq("version", incident.version)
      .select("version")
      .single();
    if (updateError) {
      await serviceClient.from("incident_parties").delete().eq("id", party.id);
      console.error("[join-incident] incident update failed", { error: updateError.message });
      return json({ error: "join_failed" }, 409);
    }

    console.log("[join-incident] party B joined", { incidentId: incident.id, userId: claims.user.id });
    return json({
      incident: preview,
      draftRef: {
        incidentId: incident.id,
        partyId: party.id,
        partyLabel: party.party_label,
        shareCode: incident.share_code,
        incidentVersion: updatedIncident.version,
        partyVersion: party.version,
      },
    });
  } catch (error) {
    console.error("[join-incident] unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "invalid_request" }, 400);
  }
});
