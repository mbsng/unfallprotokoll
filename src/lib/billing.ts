import { supabase } from "@/integrations/supabase/client";

export type Plan = "free" | "pro" | "fleet";

export interface PlanEntitlement {
  plan: Plan;
  status: string;
  currentPeriodEnd: string | null;
  caseCount: number;
  caseLimit: number | null;
  canCreate: boolean;
}

export class BillingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function functionErrorCode(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return fallback;
  try {
    const body = await context.clone().json() as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getPlanEntitlement(): Promise<PlanEntitlement> {

  const { data, error } = await supabase.rpc("get_plan_entitlement");
  const row = data?.[0];
  if (error || !row) throw new BillingError(error?.message ?? "entitlement_failed");
  return {
    plan: row.plan as Plan,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    caseCount: Number(row.case_count),
    caseLimit: row.case_limit === null ? null : Number(row.case_limit),
    canCreate: row.can_create,
  };
}

export async function createCheckout(plan: Exclude<Plan, "free">, quantity = 1) {
  const { data, error } = await supabase.functions.invoke("create-checkout", { body: { plan, quantity } });
  if (error || !data?.url) throw new BillingError(data?.error ?? await functionErrorCode(error, "checkout_failed"));
  return data.url as string;
}
