import { supabase } from "@/integrations/supabase/client";

export class SubmissionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function errorCode(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return fallback;
  try {
    const body = await context.clone().json() as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function generateIncidentPdf(incidentId: string) {
  const { data, error } = await supabase.functions.invoke("generate-pdf", { body: { incidentId } });
  if (error || !data?.downloadUrl) throw new SubmissionError(await errorCode(error, data?.error ?? "pdf_generation_failed"));
  return data as { submissionId: string; storagePath: string; downloadUrl: string };
}

export async function submitIncident(incidentId: string, targetEmail: string) {
  const { data, error } = await supabase.functions.invoke("submit-incident", { body: { incidentId, targetEmail } });
  if (error || !data?.downloadUrl) throw new SubmissionError(await errorCode(error, data?.error ?? "submission_failed"));
  return data as { submissionId: string; status: "submitted"; submittedAt?: string; downloadUrl: string };
}
