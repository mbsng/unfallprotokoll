import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";

export class SubmissionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function extractFunctionError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (context) {
    try {
      const body = await context.clone().json() as { error?: string; message?: string };
      return { code: body.error ?? fallbackCode, message: body.message ?? fallbackMessage };
    } catch { /* not JSON */ }
  }
  return { code: fallbackCode, message: fallbackMessage };
}

const requestLocale = () => i18n.resolvedLanguage || i18n.language || "en";

export async function generateIncidentPdf(incidentId: string) {
  const { data, error } = await supabase.functions.invoke("generate-pdf", { body: { incidentId, locale: requestLocale() } });
  if (error || !data?.downloadUrl) {
    const detail = await extractFunctionError(error, data?.error ?? "pdf_generation_failed", data?.message ?? i18n.t("submission.errors.pdf_generation_failed"));
    throw new SubmissionError(detail.code, detail.message);
  }
  return data as { submissionId: string; storagePath: string; downloadUrl: string; completeness?: string };
}

// Server-attested signing: the signature image must exist in storage before
// the server writes signed_at — the client can no longer set it directly.
export async function signIncident(partyId: string) {
  const { data, error } = await supabase.functions.invoke("sign-incident", { body: { partyId } });
  if (error || !data?.signedAt) {
    const detail = await extractFunctionError(error, data?.error ?? "sign_failed", data?.message ?? i18n.t("signature.uploadError"));
    throw new SubmissionError(detail.code, detail.message);
  }
  return data as { partyId: string; signedAt: string; storagePath: string; version: number; alreadySigned?: boolean };
}

export async function submitIncident(incidentId: string, targetEmail: string) {
  const { data, error } = await supabase.functions.invoke("submit-incident", { body: { incidentId, targetEmail, locale: requestLocale() } });
  if (error || !data?.downloadUrl) {
    const detail = await extractFunctionError(error, data?.error ?? "submission_failed", data?.message ?? i18n.t("submission.errors.submission_failed"));
    throw new SubmissionError(detail.code, detail.message);
  }
  return data as { submissionId: string; status: "submitted"; submittedAt?: string; downloadUrl: string; completeness?: string };
}
