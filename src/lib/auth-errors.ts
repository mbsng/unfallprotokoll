import { AuthApiError } from "@supabase/supabase-js";

export function getAuthErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof AuthApiError)) return fallback;
  if (error.status === 429) return fallback;
  return fallback;
}
