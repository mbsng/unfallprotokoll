import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";


const json = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const token = authHeader.slice(7);
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claims, error: authError } = await authClient.auth.getUser(token);
    if (authError || !claims.user) return json(req, { error: "unauthorized" }, 401);
    if (claims.user.is_anonymous || !claims.user.email_confirmed_at) return json(req, { error: "verified_account_required" }, 403);

    const { code: rawCode, action = "preview" } = await req.json();
    const code = typeof rawCode === "string" ? rawCode.replace(/[\s-]+/g, "").toUpperCase() : "";
    if (action !== "preview" && action !== "join") return json(req, { error: "invalid_action" }, 400);

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limitInputs = [
      { value: `ip:${clientIp}`, limit: action === "join" ? 15 : 30 },
      { value: `account:${claims.user.id}`, limit: action === "join" ? 10 : 20 },
      { value: `code:${code}`, limit: action === "join" ? 5 : 10 },
    ];
    for (const input of limitInputs) {
      const { data: allowed, error: rateError } = await serviceClient.rpc("consume_join_rate_limit", {
        target_key_hash: await sha256(input.value),
        request_limit: input.limit,
      });
      if (rateError) {
        console.error("[join-incident] rate limit failed", { error: rateError.message });
        return json(req, { error: "lookup_failed" }, 500);
      }
      if (!allowed) return json(req, { error: "too_many_attempts" }, 429);
    }

    if (!/^[A-Z0-9]{8}$/.test(code)) return json(req, { error: "invitation_unavailable" }, 404);
    const { data: incident, error: incidentError } = await serviceClient
      .from("incidents")
      .select("id, share_code, status, occurred_at, location_text, version")
      .eq("share_code", code)
      .maybeSingle();

    if (incidentError) {
      console.error("[join-incident] incident lookup failed", { error: incidentError.message });
      return json(req, { error: "lookup_failed" }, 500);
    }
    if (!incident) {
      return json(req, { error: "invitation_unavailable" }, 404);
    }

    // A preview confirms only that an authenticated, verified user has an invitation.
    if (action === "preview") {
      return json(req, { incident: { shareCode: code, occurredAt: null, locationText: null } });
    }

    const { data: existingParties, error: partiesError } = await serviceClient
      .from("incident_parties")
      .select("id, party_label, profile_id, version")
      .eq("incident_id", incident.id);
    if (partiesError) {
      console.error("[join-incident] party lookup failed", { error: partiesError.message });
      return json(req, { error: "lookup_failed" }, 500);
    }

    const preview = {
      shareCode: incident.share_code,
      occurredAt: incident.occurred_at,
      locationText: incident.location_text,
    };
    const ownParty = existingParties?.find((party) => party.profile_id === claims.user.id);
    if (ownParty?.party_label === "A") return json(req, { error: "already_participant" }, 409);
    if (ownParty) {
      return json(req, {
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
    if (existingParties?.some((party) => party.party_label === "B")) return json(req, { error: "party_b_exists" }, 409);

    const { data: joiningProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("full_name, phone, address, postal_code, city, country, birth_date, license_no, license_class, license_valid_until, default_vehicle_json, insurance_json")
      .eq("id", claims.user.id)
      .maybeSingle();
    if (profileError) {
      console.error("[join-incident] profile lookup failed", { error: profileError.message });
      return json(req, { error: "join_failed" }, 500);
    }

    const vehicle = joiningProfile?.default_vehicle_json ?? {};
    const insurance = joiningProfile?.insurance_json ?? {};
    const { data: party, error: insertError } = await serviceClient
      .from("incident_parties")
      .insert({
        incident_id: incident.id,
        party_label: "B",
        profile_id: claims.user.id,
        driver_json: {
          fullName: joiningProfile?.full_name ?? "", phone: joiningProfile?.phone ?? "", address: joiningProfile?.address ?? "",
          postalCode: joiningProfile?.postal_code ?? "", city: joiningProfile?.city ?? "", country: joiningProfile?.country ?? "",
          birthDate: joiningProfile?.birth_date ?? "", licenseNo: joiningProfile?.license_no ?? "", licenseClass: joiningProfile?.license_class ?? "",
          licenseValidUntil: joiningProfile?.license_valid_until ?? "",
        },
        vehicle_json: vehicle,
        insurance_json: insurance,
      })
      .select("id, party_label, version")
      .single();
    if (insertError) {
      console.error("[join-incident] party creation failed", { error: insertError.message });
      return json(req, { error: insertError.code === "23505" ? "party_b_exists" : "join_failed" }, insertError.code === "23505" ? 409 : 500);
    }

    // The status transition to 'joined' happens automatically via the
    // sync_incident_status_from_parties trigger on the party insert. The
    // trigger bumps incidents.version, so read the fresh value back.
    const { data: refreshed, error: refreshError } = await serviceClient
      .from("incidents")
      .select("version")
      .eq("id", incident.id)
      .single();
    if (refreshError || !refreshed) {
      console.warn("[join-incident] incident version refresh failed, using fallback", { error: refreshError?.message });
    }
    const incidentVersion = refreshed?.version ?? incident.version + 1;

    console.log("[join-incident] verified party B joined", { incidentId: incident.id, userId: claims.user.id });
    return json(req, {
      incident: preview,
      draftRef: {
        incidentId: incident.id,
        partyId: party.id,
        partyLabel: party.party_label,
        shareCode: incident.share_code,
        incidentVersion,
        partyVersion: party.version,
      },
    });
  } catch (error) {
    console.error("[join-incident] unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return json(req, { error: "invalid_request" }, 400);
  }
});
