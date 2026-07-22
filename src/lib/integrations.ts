import { supabase } from "@/integrations/supabase/client";

export interface Integration {
  id: string;
  name: string;
  channel: "email" | "webhook" | "api";
  endpoint_url: string | null;
  email: string | null;
  schema_version: string;
  mapping_profile: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export class IntegrationError extends Error {
  constructor(public code: string) { super(code); }
}

async function invoke<T>(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-integrations", { body });
  if (error || data?.error) {
    let code = data?.error ?? "integration_management_failed";
    const context = (error as { context?: Response } | null)?.context;
    if (context) {
      try { code = (await context.clone().json()).error ?? code; } catch { /* use fallback */ }
    }
    throw new IntegrationError(code);
  }
  return data as T;
}

export const listIntegrations = () => invoke<{ integrations: Integration[]; apiKeys: ApiKeyMetadata[] }>({ action: "list" });
export const createWebhook = (name: string, endpointUrl: string) => invoke<{ integration: Integration; signingSecret: string }>({ action: "create_webhook", name, endpointUrl });
export const createApiKey = (name: string, scopes: string[]) => invoke<{ apiKey: ApiKeyMetadata; key: string }>({ action: "create_api_key", name, scopes });
export const revokeApiKey = (keyId: string) => invoke<{ status: string }>({ action: "revoke_api_key", keyId });
export const toggleIntegration = (integrationId: string, active: boolean) => invoke<{ integration: Pick<Integration, "id" | "active"> }>({ action: "toggle_integration", integrationId, active });
export const testWebhook = (integrationId: string) => invoke<{ results: { status: string; responseCode?: number }[] }>({ action: "test_webhook", integrationId });
