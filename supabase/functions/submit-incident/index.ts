import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const body = await req.json();
    const incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
    const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail.trim().toLowerCase() : "";
    if (!/^[0-9a-f-]{36}$/i.test(incidentId) || !emailPattern.test(targetEmail) || targetEmail.length > 254) return json({ error: "invalid_request" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

    const [{ data: incident, error: incidentError }, { data: ownParty, error: partyError }] = await Promise.all([
      service.from("incidents").select("id, share_code, status, version").eq("id", incidentId).single(),
      service.from("incident_parties").select("id").eq("incident_id", incidentId).eq("profile_id", authData.user.id).maybeSingle(),
    ]);
    if (incidentError || partyError || !incident) return json({ error: "not_found" }, 404);
    if (!ownParty) return json({ error: "forbidden" }, 403);
    if (!["signed", "submitted"].includes(incident.status)) return json({ error: "incident_not_completed" }, 409);

    let { data: submission } = await service.from("submissions").select("id, status, pdf_storage_path").eq("incident_id", incidentId).eq("party_id", ownParty.id).maybeSingle();
    if (!submission?.pdf_storage_path) {
      const generated = await fetch("https://itdkfzzajyxfofnrgkqx.supabase.co/functions/v1/generate-pdf", {
        method: "POST",
        headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId }),
      });
      const generatedBody = await generated.json();
      if (!generated.ok || !generatedBody.storagePath) throw new Error(`pdf_generation_failed:${generatedBody.error ?? generated.status}`);
      const result = await service.from("submissions").select("id, status, pdf_storage_path").eq("id", generatedBody.submissionId).single();
      if (result.error) throw result.error;
      submission = result.data;
    }

    if (submission.status === "submitted" && incident.status === "submitted") {
      const { data: signed } = await service.storage.from("incident-pdfs").createSignedUrl(submission.pdf_storage_path, 3600, { download: `Unfallprotokoll-${incident.share_code}.pdf` });
      return json({ submissionId: submission.id, status: "submitted", downloadUrl: signed?.signedUrl });
    }

    const { data: pdfBlob, error: downloadError } = await service.storage.from("incident-pdfs").download(submission.pdf_storage_path);
    if (downloadError || !pdfBlob) throw downloadError ?? new Error("pdf_not_found");
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const email = await sendEmail({
      to: targetEmail,
      subject: `Europäisches Unfallprotokoll ${incident.share_code}`,
      html: `<p>Guten Tag</p><p>Im Anhang erhalten Sie das abgeschlossene Europäische Unfallprotokoll zum Fall <strong>${incident.share_code}</strong>.</p><p>Freundliche Grüsse<br>Unfallprotokoll</p>`,
      attachments: [{ filename: `Unfallprotokoll-${incident.share_code}.pdf`, content: toBase64(pdfBytes) }],
    });

    const submittedAt = new Date().toISOString();
    const { error: submissionError } = await service.from("submissions").update({ target: targetEmail, status: "submitted", submitted_at: submittedAt }).eq("id", submission.id);
    if (submissionError) throw submissionError;
    if (incident.status === "signed") {
      const { data: updatedIncident, error: incidentUpdateError } = await service.from("incidents")
        .update({ status: "submitted", version: incident.version + 1, updated_at: submittedAt })
        .eq("id", incidentId).eq("version", incident.version).select("status").maybeSingle();
      if (incidentUpdateError) throw incidentUpdateError;
      if (!updatedIncident) {
        const { data: current } = await service.from("incidents").select("status").eq("id", incidentId).single();
        if (current?.status !== "submitted") throw new Error("incident_status_conflict");
      }
    }
    const { data: signed, error: signError } = await service.storage.from("incident-pdfs").createSignedUrl(submission.pdf_storage_path, 3600, { download: `Unfallprotokoll-${incident.share_code}.pdf` });
    if (signError) throw signError;
    console.log("[submit-incident] incident submitted", { incidentId, submissionId: submission.id, emailId: email.id });
    return json({ submissionId: submission.id, status: "submitted", submittedAt, downloadUrl: signed.signedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[submit-incident] submission failed", { error: message });
    if (message === "email_provider_not_configured") return json({ error: "email_provider_not_configured" }, 503);
    return json({ error: "submission_failed" }, 500);
  }
});
