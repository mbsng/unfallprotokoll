import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail } from "../_shared/email.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { errorBody, normalizeLocale, type AppLocale } from "../_shared/error-response.ts";

const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
const fail = (req: Request, code: string, status: number, locale: AppLocale) => json(req, errorBody(code, locale), status);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  let locale = normalizeLocale(req.headers.get("accept-language"));
  if (req.method !== "POST") return fail(req, "method_not_allowed", 405, locale);
  try {
    const body = await req.json();
    locale = normalizeLocale(body.locale ?? locale);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return fail(req, "unauthorized", 401, locale);
    const token = authHeader.slice(7);
    const incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
    const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail.trim().toLowerCase() : "";
    if (!/^[0-9a-f-]{36}$/i.test(incidentId) || !emailPattern.test(targetEmail) || targetEmail.length > 254) return fail(req, "invalid_request", 400, locale);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return fail(req, "unauthorized", 401, locale);

    // Destination restriction: the report contains BOTH parties' PII, so it
    // may only be delivered to the requesting party's own verified address.
    // This prevents using the app's mail sender as a relay to arbitrary
    // third-party inboxes. Recipients can forward it to their insurer.
    const ownEmail = (authData.user.email ?? "").trim().toLowerCase();
    if (!ownEmail || !authData.user.email_confirmed_at) return fail(req, "verified_email_required", 403, locale);
    if (targetEmail !== ownEmail) {
      console.warn("[submit-incident] rejected destination that is not the requester's own address", { incidentId, userId: authData.user.id });
      return fail(req, "invalid_destination", 403, locale);
    }

    const [{ data: incident, error: incidentError }, { data: ownParty, error: partyError }] = await Promise.all([
      service.from("incidents").select("id, share_code, status, version").eq("id", incidentId).single(),
      service.from("incident_parties").select("id, signed_at").eq("incident_id", incidentId).eq("profile_id", authData.user.id).maybeSingle(),
    ]);
    if (incidentError || partyError || !incident) {
      console.error("[submit-incident] Data fetch failed", { incidentError: incidentError?.message, partyError: partyError?.message });
      return fail(req, "not_found", 404, locale);
    }
    if (!ownParty) return fail(req, "forbidden", 403, locale);

    // NEW RULE: Only my own signature is required. No counterpart check.
    if (!ownParty.signed_at) {
      return fail(req, "own_signature_required", 409, locale);
    }

    // Rate limit: the report contains full PII, so cap submissions per account
    // and per incident to prevent email bombing of arbitrary addresses.
    for (const limitInput of [
      { key: `submit-account:${authData.user.id}`, limit: 5 },
      { key: `submit-incident:${incidentId}`, limit: 5 },
    ]) {
      const { data: allowed, error: rateError } = await service.rpc("consume_rate_limit", {
        target_key_hash: await sha256(limitInput.key),
        request_limit: limitInput.limit,
        window_seconds: 3600,
      });
      if (rateError) {
        console.error("[submit-incident] rate limit failed", { error: rateError.message });
        return fail(req, "rate_limit_failed", 500, locale);
      }
      if (!allowed) return fail(req, "too_many_submissions", 429, locale);
    }

    let { data: submission } = await service.from("submissions").select("id, status, pdf_storage_path").eq("incident_id", incidentId).eq("party_id", ownParty.id).maybeSingle();
    if (!submission?.pdf_storage_path) {
      const generated = await fetch(`${supabaseUrl}/functions/v1/generate-pdf`, {
        method: "POST",
        headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, locale }),
      });
      const generatedBody = await generated.json();
      if (!generated.ok || !generatedBody.storagePath) {
        console.error("[submit-incident] PDF generation failed", { status: generated.status, body: generatedBody });
        throw new Error(`pdf_generation_failed:${generatedBody.error ?? generated.status}`);
      }
      const result = await service.from("submissions").select("id, status, pdf_storage_path").eq("id", generatedBody.submissionId).single();
      if (result.error) throw result.error;
      submission = result.data;
    }

    // Already submitted — return the existing result
    if (submission.status === "submitted") {
      const { data: signed } = await service.storage.from("incident-pdfs").createSignedUrl(submission.pdf_storage_path, 3600, { download: `Unfallprotokoll-${incident.share_code}.pdf` });
      return json(req, { submissionId: submission.id, status: "submitted", downloadUrl: signed?.signedUrl });
    }

    const { data: pdfBlob, error: downloadError } = await service.storage.from("incident-pdfs").download(submission.pdf_storage_path);
    if (downloadError || !pdfBlob) {
      console.error("[submit-incident] PDF download from storage failed", { error: downloadError?.message, path: submission.pdf_storage_path });
      throw downloadError ?? new Error("pdf_not_found");
    }
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    let email;
    try {
      email = await sendEmail({
        to: targetEmail,
        subject: `Europäisches Unfallprotokoll ${incident.share_code}`,
        html: `<p>Guten Tag</p><p>Im Anhang erhalten Sie das abgeschlossene Europäische Unfallprotokoll zum Fall <strong>${incident.share_code}</strong>.</p><p>Freundliche Grüsse<br>Unfallprotokoll</p>`,
        attachments: [{ filename: `Unfallprotokoll-${incident.share_code}.pdf`, content: toBase64(pdfBytes) }],
      });
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : String(emailError);
      console.error("[submit-incident] Email sending failed", { error: message });
      // Record the failed attempt so it can be retried
      await service.from("submissions").update({ target: targetEmail, status: "failed" }).eq("id", submission.id);
      if (message === "email_provider_not_configured") return fail(req, "email_provider_not_configured", 503, locale);
      throw new Error(`email_send_failed:${message}`);
    }

    const submittedAt = new Date().toISOString();
    const { error: submissionError } = await service.from("submissions").update({ target: targetEmail, status: "submitted", submitted_at: submittedAt }).eq("id", submission.id);
    if (submissionError) {
      console.error("[submit-incident] Failed to update submission status", { error: submissionError.message });
      throw submissionError;
    }
    // 'submitted' marks the delivery receipt. It is reachable from any
    // signature-derived status — the only gate is the requester's own
    // signature, checked above. The signature-derived statuses themselves
    // are maintained exclusively by the DB trigger.
    const { error: incidentUpdateError } = await service.from("incidents")
      .update({ status: "submitted", version: incident.version + 1, updated_at: submittedAt })
      .eq("id", incidentId)
      .eq("version", incident.version)
      .neq("status", "submitted");
    if (incidentUpdateError) {
      console.error("[submit-incident] Failed to update incident status", { error: incidentUpdateError.message });
    }
    const { data: signed, error: signError } = await service.storage.from("incident-pdfs").createSignedUrl(submission.pdf_storage_path, 3600, { download: `Unfallprotokoll-${incident.share_code}.pdf` });
    if (signError) {
      console.error("[submit-incident] Failed to create signed URL", { error: signError.message });
      throw signError;
    }
    try {
      const webhookResponse = await fetch(`${supabaseUrl}/functions/v1/push-webhook`, {
        method: "POST",
        headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id, incidentId }),
      });
      if (!webhookResponse.ok) console.warn("[submit-incident] Webhook not accepted", { incidentId, responseCode: webhookResponse.status });
    } catch (webhookError) {
      console.warn("[submit-incident] Webhook failed", { incidentId, error: webhookError instanceof Error ? webhookError.message : String(webhookError) });
    }
    console.log("[submit-incident] Incident submitted successfully", { incidentId, submissionId: submission.id, emailId: email.id, targetEmail });
    return json(req, { submissionId: submission.id, status: "submitted", submittedAt, downloadUrl: signed.signedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[submit-incident] Submission failed", { error: message, stack: error instanceof Error ? error.stack : undefined });
    if (message === "email_provider_not_configured") return fail(req, "email_provider_not_configured", 503, locale);
    if (message.startsWith("email_send_failed:")) return fail(req, "email_send_failed", 502, locale);
    return fail(req, "submission_failed", 500, locale);
  }
});
