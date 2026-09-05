import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { stripeRequest, verifyStripeSignature } from "../_shared/stripe.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeSecret || !webhookSecret) return json(req, { error: "billing_not_configured" }, 503);
    const signature = req.headers.get("Stripe-Signature");
    const payload = await req.text();
    if (!signature || !(await verifyStripeSignature(payload, signature, webhookSecret))) {
      console.warn("[stripe-webhook] invalid signature");
      return json(req, { error: "invalid_signature" }, 400);
    }

    const event = JSON.parse(payload);
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    let subscription = event.data?.object;
    if (event.type === "checkout.session.completed" && subscription?.subscription) {
      subscription = await stripeRequest(`/subscriptions/${subscription.subscription}`, stripeSecret);
    }

    if (["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const customerId = typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id;
      let orgId = subscription?.metadata?.org_id as string | undefined;
      let plan = subscription?.metadata?.plan as "pro" | "fleet" | undefined;
      if ((!orgId || !plan) && customerId) {
        const { data: existing } = await service.from("subscriptions").select("org_id, plan").eq("stripe_customer_id", customerId).maybeSingle();
        orgId = orgId ?? existing?.org_id;
        plan = plan ?? existing?.plan;
      }
      if (!orgId || !customerId || !plan || !["pro", "fleet"].includes(plan)) throw new Error("subscription_metadata_missing");
      const status = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
      const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
      const { error } = await service.from("subscriptions").upsert({ org_id: orgId, stripe_customer_id: customerId, plan, status, current_period_end: periodEnd, updated_at: new Date().toISOString() });
      if (error) throw error;
      console.log("[stripe-webhook] subscription synchronized", { eventId: event.id, orgId, plan, status });
    } else if (event.type === "invoice.payment_failed") {
      const customerId = typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id;
      if (customerId) {
        const { error } = await service.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("stripe_customer_id", customerId);
        if (error) throw error;
      }
      console.warn("[stripe-webhook] payment failed", { eventId: event.id, customerId });
    }

    return json(req, { received: true });
  } catch (error) {
    console.error("[stripe-webhook] synchronization failed", { error: error instanceof Error ? error.message : String(error) });
    return json(req, { error: "webhook_failed" }, 500);
  }
});
