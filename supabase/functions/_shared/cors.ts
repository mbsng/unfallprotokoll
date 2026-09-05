const ALLOWED_ORIGINS = new Set([
  "https://www.upsala.ch",
  "https://upsala.ch",
  "https://unfallprotokoll.vercel.app",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
]);

const vercelPreviewHostname = /^(?:unfallprotokoll|upsala)(?:-[a-z0-9-]+)?\.vercel\.app$/i;
const nativeWebviewOrigin = /^(?:capacitor|ionic):\/\/localhost$/i;

function isAllowedOrigin(origin: string): boolean {
  if (nativeWebviewOrigin.test(origin)) return true;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  if (ALLOWED_ORIGINS.has(normalizedOrigin)) return true;

  const url = new URL(normalizedOrigin);
  if (url.protocol === "https:" && vercelPreviewHostname.test(url.hostname)) return true;

  const siteUrl = Deno.env.get("SITE_URL");
  if (siteUrl) {
    try {
      if (normalizedOrigin === new URL(siteUrl).origin) return true;
    } catch {
      // Ignore a malformed optional SITE_URL; the explicit allowlist remains active.
    }
  }

  return false;
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  const origin = req.headers.get("Origin");
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;

  return headers;
}

export function corsPreflightResponse(req: Request) {
  return new Response(null, { status: 200, headers: corsHeaders(req) });
}
