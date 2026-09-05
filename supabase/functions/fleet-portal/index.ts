import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) return json(req, { error: "unauthorized" }, 401);

    const { data: manager } = await service.from("profiles").select("org_id, role").eq("id", authData.user.id).single();
    if (!manager?.org_id || !["fleet_manager", "admin"].includes(manager.role)) return json(req, { error: "forbidden" }, 403);

    const body = await req.json();
    const action = body.action;
    const { data: orgProfiles, error: profilesError } = await service
      .from("profiles")
      .select("id, full_name, phone, created_at")
      .eq("org_id", manager.org_id)
      .eq("role", "driver")
      .order("full_name");
    if (profilesError) throw profilesError;
    const profileIds = (orgProfiles ?? []).map((profile: any) => profile.id);

    if (action === "overview") {
      const [{ data: memberships, error: membershipError }, { data: invitations, error: invitationError }] = await Promise.all([
        profileIds.length
          ? service.from("incident_parties").select("incident_id, profile_id, driver_json, vehicle_json").in("profile_id", profileIds)
          : Promise.resolve({ data: [], error: null }),
        service.from("organization_invitations").select("id, email, status, created_at").eq("org_id", manager.org_id).order("created_at", { ascending: false }),
      ]);
      if (membershipError || invitationError) throw membershipError ?? invitationError;

      const incidentIds = [...new Set((memberships ?? []).map((party: any) => party.incident_id))];
      const { data: incidents, error: incidentsError } = incidentIds.length
        ? await service.from("incidents").select("id, share_code, status, occurred_at, created_at, location_text").in("id", incidentIds).order("occurred_at", { ascending: false, nullsFirst: false })
        : { data: [], error: null };
      if (incidentsError) throw incidentsError;

      const membershipByIncident = new Map<string, any>();
      for (const membership of memberships ?? []) if (!membershipByIncident.has(membership.incident_id)) membershipByIncident.set(membership.incident_id, membership);
      const driverById = new Map((orgProfiles ?? []).map((profile: any) => [profile.id, profile]));

      const emails = new Map<string, string>();
      for (const profile of orgProfiles ?? []) {
        const { data } = await service.auth.admin.getUserById(profile.id);
        if (data.user?.email) emails.set(profile.id, data.user.email);
      }

      return json(req, {
        incidents: (incidents ?? []).map((incident: any) => {
          const membership = membershipByIncident.get(incident.id);
          const driver = driverById.get(membership?.profile_id) as any;
          return {
            id: incident.id,
            shareCode: incident.share_code,
            status: incident.status,
            occurredAt: incident.occurred_at,
            createdAt: incident.created_at,
            location: incident.location_text,
            driverId: membership?.profile_id,
            driverName: driver?.full_name ?? membership?.driver_json?.fullName ?? "—",
            plate: membership?.vehicle_json?.plate ?? null,
          };
        }),
        drivers: (orgProfiles ?? []).map((profile: any) => ({ id: profile.id, fullName: profile.full_name, email: emails.get(profile.id) ?? null, phone: profile.phone, createdAt: profile.created_at })),
        invitations: (invitations ?? []).map((invitation: any) => ({ id: invitation.id, email: invitation.email, status: invitation.status, createdAt: invitation.created_at })),
      });
    }

    if (action === "detail") {
      const incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
      if (!/^[0-9a-f-]{36}$/i.test(incidentId)) return json(req, { error: "invalid_incident" }, 400);
      const { data: orgParty } = profileIds.length
        ? await service.from("incident_parties").select("id, profile_id, driver_json, vehicle_json").eq("incident_id", incidentId).in("profile_id", profileIds).limit(1).maybeSingle()
        : { data: null };
      if (!orgParty) return json(req, { error: "not_found" }, 404);

      const [{ data: incident, error: incidentError }, { data: parties }, { data: witnesses }, { count: photoCount }] = await Promise.all([
        service.from("incidents").select("id, share_code, status, occurred_at, created_at, location_text, circumstances_json").eq("id", incidentId).single(),
        service.from("incident_parties").select("id, party_label, driver_json, vehicle_json, insurance_json, damage_description, signed_at").eq("incident_id", incidentId).order("party_label"),
        service.from("incident_witnesses").select("id, name, contact").eq("incident_id", incidentId),
        service.from("incident_media").select("id", { count: "exact", head: true }).eq("incident_id", incidentId).eq("kind", "photo"),
      ]);
      if (incidentError || !incident) return json(req, { error: "not_found" }, 404);
      const driver = (orgProfiles ?? []).find((profile: any) => profile.id === orgParty.profile_id);
      return json(req, { incident: {
        id: incident.id,
        shareCode: incident.share_code,
        status: incident.status,
        occurredAt: incident.occurred_at,
        createdAt: incident.created_at,
        location: incident.location_text,
        circumstances: incident.circumstances_json,
        driverId: orgParty.profile_id,
        driverName: driver?.full_name ?? orgParty.driver_json?.fullName ?? "—",
        plate: orgParty.vehicle_json?.plate ?? null,
        parties: (parties ?? []).map((party: any) => ({ id: party.id, label: party.party_label, driver: party.driver_json, vehicle: party.vehicle_json, insurance: party.insurance_json, damageDescription: party.damage_description, signedAt: party.signed_at })),
        witnesses: witnesses ?? [],
        photoCount: photoCount ?? 0,
      } });
    }

    if (action === "invite_driver") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!emailPattern.test(email) || email.length > 254) return json(req, { error: "invalid_email" }, 400);

      // Invitations send transactional email from the app's sender address,
      // so cap the volume per organization and per manager to prevent the
      // portal from being used as a mail relay / list-probing oracle.
      for (const limitInput of [
        { key: `invite-org:${manager.org_id}`, limit: 20 },
        { key: `invite-account:${authData.user.id}`, limit: 10 },
      ]) {
        const { data: allowed, error: rateError } = await service.rpc("consume_rate_limit", {
          target_key_hash: await sha256(limitInput.key),
          request_limit: limitInput.limit,
          window_seconds: 3600,
        });
        if (rateError) {
          console.error("[fleet-portal] invite rate limit failed", { error: rateError.message });
          return json(req, { error: "rate_limit_failed" }, 500);
        }
        if (!allowed) return json(req, { error: "too_many_invites" }, 429);
      }

      // Only the configured SITE_URL is trusted for invite redirect links;
      // the request Origin is attacker-controlled.
      const siteUrl = Deno.env.get("SITE_URL");
      const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
        ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/auth` } : {}),
        data: { org_id: manager.org_id, role: "driver" },
      });

      if (inviteError || !invited.user) {
        if (inviteError?.message.toLowerCase().includes("already")) return json(req, { error: "already_registered" }, 409);
        throw inviteError ?? new Error("invite_failed");
      }

      const { data: existingProfile } = await service.from("profiles").select("org_id").eq("id", invited.user.id).maybeSingle();
      if (existingProfile?.org_id && existingProfile.org_id !== manager.org_id) return json(req, { error: "different_organization" }, 409);
      const profileResult = existingProfile
        ? await service.from("profiles").update({ org_id: manager.org_id, role: "driver" }).eq("id", invited.user.id)
        : await service.from("profiles").insert({ id: invited.user.id, org_id: manager.org_id, role: "driver", locale: "de-CH", default_vehicle_json: {}, insurance_json: {}, onboarding_completed: false });
      if (profileResult.error) throw profileResult.error;
      const { data: invitation, error: recordError } = await service.from("organization_invitations").upsert({

        org_id: manager.org_id,
        email,
        invited_by: authData.user.id,
        invited_user_id: invited.user.id,
        status: "pending",
      }, { onConflict: "org_id,email" }).select("id, email, status, created_at").single();
      if (recordError) throw recordError;
      return json(req, { invitation: { id: invitation.id, email: invitation.email, status: invitation.status, createdAt: invitation.created_at } }, 201);
    }

    return json(req, { error: "invalid_action" }, 400);
  } catch (error) {
    console.error("[fleet-portal] request failed", { error: error instanceof Error ? error.message : String(error) });
    return json(req, { error: "fleet_portal_failed" }, 500);
  }
});
