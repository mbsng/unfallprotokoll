import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { stripeRequest } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const proPrice = Deno.env.get("STRIPE_PRO_PRICE_ID");
    const fleetPrice = Deno.env.get("STRIPE_FLEET_PRICE_ID");
    if (!stripeSecret || !proPrice || !fleetPrice) return json({ error: "billing_not_configured" }, 503);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user || authData.user.is_anonymous) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const plan = body.plan === "fleet" ? "fleet" : body.plan === "pro" ? "pro" : null;
    const quantity = plan === "fleet" && Number.isInteger(body.quantity) ? Math.min(500, Math.max(1, body.quantity)) : 1;
    if (!plan) return json({ error: "invalid_plan" }, 400);
    const { data: profile } = await service.from("profiles").select("id, org_id, role, full_name").eq("id", authData.user.id).single();
    if (!profile) return json({ error: "profile_not_found" }, 404);

    let orgId = profile.org_id as string | null;
    let orgType: string | null = null;
    if (orgId) {
      const { data: organization } = await service.from("organizations").select("type").eq("id", orgId).single();
      orgType = organization?.type ?? null;
    }

    if (plan === "fleet") {
      if (!orgId || orgType !== "fleet" || !["fleet_manager", "admin"].includes(profile.role)) return json({ error: "fleet_manager_required" }, 403);
    } else {
      if (orgId && orgType !== "private") return json({ error: "private_plan_not_available" }, 409);
      if (!orgId) {
        const { data: organization, error: orgError } = await service.from("organizations").insert({ name: profile.full_name || authData.user.email || "Privat", type: "private" }).select("id").single();
        if (orgError || !organization) throw orgError ?? new Error("organization_create_failed");
        orgId = organization.id;
        const { error: profileError } = await service.from("profiles").update({ org_id: orgId }).eq("id", authData.user.id);
        if (profileError) throw profileError;
      }
    }

    const { data: existing } = await service.from("subscriptions").select("stripe_customer_id, plan, status").eq("org_id", orgId).maybeSingle();
    if (existing && ["active", "trialing"].includes(existing.status)) return json({ error: "already_subscribed" }, 409);
    let customerId = existing?.stripe_customer_id as string | null;
    if (!customerId) {

      const customerBody = new URLSearchParams();
      if (authData.user.email) customerBody.set("email", authData.user.email);
      customerBody.set("name", profile.full_name || authData.user.email || "Kunde");
      customerBody.set("metadata[org_id]", orgId!);
      const customer = await stripeRequest("/customers", stripeSecret, { method: "POST", body: customerBody });
      customerId = customer.id;
      const { error } = await service.from("subscriptions").upsert({ org_id: orgId, stripe_customer_id: customerId, plan, status: "incomplete", updated_at: new Date().toISOString() });
      if (error) throw error;
    }

    const requestOrigin = req.headers.get("Origin");
    const siteUrl = requestOrigin && /^https?:\/\//i.test(requestOrigin) ? requestOrigin : Deno.env.get("SITE_URL");
    if (!siteUrl) return json({ error: "site_url_not_configured" }, 503);
    const checkoutBody = new URLSearchParams();
    checkoutBody.set("mode", "subscription");
    checkoutBody.set("customer", customerId!);
    checkoutBody.set("client_reference_id", authData.user.id);
    checkoutBody.set("line_items[0][price]", plan === "fleet" ? fleetPrice : proPrice);
    checkoutBody.set("line_items[0][quantity]", String(quantity));
    checkoutBody.set("success_url", `${siteUrl.replace(/\/$/, "")}/upgrade?checkout=success`);
    checkoutBody.set("cancel_url", `${siteUrl.replace(/\/$/, "")}/upgrade?checkout=cancelled`);
    checkoutBody.set("allow_promotion_codes", "true");
    checkoutBody.set("subscription_data[metadata][org_id]", orgId!);
    checkoutBody.set("subscription_data[metadata][plan]", plan);
    checkoutBody.set("metadata[org_id]", orgId!);
    checkoutBody.set("metadata[plan]", plan);
    if (plan === "fleet") checkoutBody.set("metadata[vehicle_count]", String(quantity));
    const checkout = await stripeRequest("/checkout/sessions", stripeSecret, { method: "POST", body: checkoutBody });
    console.log("[create-checkout] checkout created", { orgId, plan, quantity, sessionId: checkout.id });
    return json({ url: checkout.url });
  } catch (error) {
    console.error("[create-checkout] checkout failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "checkout_failed" }, 500);
  }
});
