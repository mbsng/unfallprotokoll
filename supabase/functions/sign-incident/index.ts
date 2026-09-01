import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const json = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req, ALLOW_HEADERS), "Content-Type": "application/json" } });

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Sets signed_at on the caller's own incident party row — but only after
// verifying a signature image actually exists at
// {incidentId}/{partyId}/signature.png in the incident-media bucket.
// A plain client UPDATE on incident_parties cannot mint a signature
// (blocked by the guard_incident_party_client_updates trigger).
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req, ALLOW_HEADERS) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const body = await req.json();
    const partyId = typeof body.partyId === "string" ? body.partyId : "";
    if (!/^[0-9a-f-]{36}$/i.test(partyId)) return json(req, { error: "invalid_request" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json(req, { error: "unauthorized" }, 401);

    const { data: party, error: partyError } = await service
      .from("incident_parties")
      .select("id, incident_id, profile_id, version, signed_at, signature_storage_path")
      .eq("id", partyId)
      .maybeSingle();
    if (partyError) {
      console.error("[sign-incident] party lookup failed", { error: partyError.message });
      return json(req, { error: "sign_failed" }, 500);
    }
    if (!party) return json(req, { error: "not_found" }, 404);
    if (party.profile_id !== authData.user.id) return json(req, { error: "forbidden" }, 403);

    const storagePath = `${party.incident_id}/${party.id}/signature.png`;
    const signedAt = new Date().toISOString();

    // Idempotent: already signed against the same signature object.
    if (party.signed_at && party.signature_storage_path === storagePath) {
      return json(req, { partyId: party.id, signedAt: party.signed_at, storagePath, version: party.version, alreadySigned: true });
    }

    // Server-side verification: the signature image must exist in storage
    // before signed_at is written. Record hash + size for audit purposes.
    const { data: signatureBlob, error: downloadError } = await service.storage.from("incident-media").download(storagePath);
    if (downloadError || !signatureBlob) {
      console.error("[sign-incident] signature object missing in storage", { storagePath, error: downloadError?.message });
      return json(req, { error: "signature_upload_required" }, 409);
    }
    const signatureBytes = new Uint8Array(await signatureBlob.arrayBuffer());
    const signatureHash = await sha256(signatureBytes);
    console.log("[sign-incident] signature verified in storage", { partyId: party.id, incidentId: party.incident_id, userId: authData.user.id, bytes: signatureBytes.length, sha256: signatureHash, signedAt });

    // Register the signature in incident_media so PDF generation finds it.
    const { error: mediaError } = await service.from("incident_media").upsert(
      { incident_id: party.incident_id, party_id: party.id, storage_path: storagePath, kind: "document" },
      { onConflict: "storage_path" },
    );
    if (mediaError) {
      console.error("[sign-incident] media registration failed", { error: mediaError.message });
      return json(req, { error: "sign_failed" }, 500);
    }

    const { data: updated, error: updateError } = await service
      .from("incident_parties")
      .update({ signature_storage_path: storagePath, signed_at: signedAt, updated_at: signedAt })
      .eq("id", partyId)
      .select("version, signed_at, signature_storage_path")
      .single();
    if (updateError || !updated) {
      console.error("[sign-incident] party update failed", { error: updateError?.message, code: updateError?.code });
      return json(req, { error: "sign_failed" }, 500);
    }

    console.log("[sign-incident] party signed", { partyId, incidentId: party.incident_id, userId: authData.user.id });
    return json(req, { partyId, signedAt: updated.signed_at, storagePath, version: updated.version });
  } catch (error) {
    console.error("[sign-incident] request failed", { error: error instanceof Error ? error.message : String(error) });
    return json(req, { error: "sign_failed" }, 500);
  }
});
