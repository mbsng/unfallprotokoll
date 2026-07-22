const normalizeHost = (host: string) => host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

function allowedHosts() {
  return new Set((Deno.env.get("WEBHOOK_ALLOWED_HOSTS") ?? "").split(",").map((host) => normalizeHost(host.trim())).filter(Boolean));
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string) {
  const value = normalizeHost(address);
  if (value.includes(".")) {
    const mapped = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? isPublicIpv4(mapped) : false;
  }
  if (!/^[0-9a-f:]+$/.test(value) || value === "::" || value === "::1") return false;
  const first = Number.parseInt(value.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if (value.startsWith("2001:db8") || value.startsWith("2001:10") || value.startsWith("2001:2:") || value.startsWith("2001:0:") || value.startsWith("100:") || value.startsWith("64:ff9b:1:")) return false;
  return true;
}

function isPublicIp(address: string) {
  return address.includes(":") ? isPublicIpv6(address) : isPublicIpv4(address);
}

async function resolveAll(host: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return [host];
  const results: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      const addresses = await Deno.resolveDns(host, type);
      results.push(...addresses);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return results;
}

export async function validateWebhookEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("invalid_endpoint");
  }
  const host = normalizeHost(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("invalid_endpoint");
  if (!allowedHosts().has(host)) throw new Error("endpoint_not_allowlisted");
  const addresses = await resolveAll(host);
  if (!addresses.length || addresses.some((address) => !isPublicIp(address))) throw new Error("unsafe_endpoint_address");
  return url.toString();
}
