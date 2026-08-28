// CORS: never answer with a wildcard origin. Only origins we control are
// echoed back: the configured SITE_URL, local development servers, and
// native-app webviews (Capacitor serves from <scheme>://localhost).
// Non-browser callers (servers, Stripe, CLI tools) send no Origin header
// and receive no Access-Control-Allow-Origin at all, which is fine.

const localhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const nativeWebviewOrigin = /^[a-zA-Z0-9+.-]+:\/\/localhost$/i;

function isAllowedOrigin(origin: string): boolean {
  if (localhostOrigin.test(origin) || nativeWebviewOrigin.test(origin)) return true;
  const siteUrl = Deno.env.get("SITE_URL");
  if (siteUrl) {
    try {
      if (new URL(origin).origin === new URL(siteUrl).origin) return true;
    } catch {
      // malformed origin or SITE_URL — treat as not allowed
    }
  }
  return false;
}

export function corsHeaders(req: Request, allowHeaders: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const origin = req.headers.get("Origin");
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
