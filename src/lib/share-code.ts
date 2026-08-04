export const normalizeShareCode = (value: string) => value.replace(/[\s-]+/g, "").toUpperCase();

export function extractShareCode(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/\/join\/([^/?#]+)/i);
    if (!match) return null;
    candidate = decodeURIComponent(match[1]);
  } catch {
    const pathMatch = trimmed.match(/(?:^|\/)join\/([^/?#]+)/i);
    if (pathMatch) candidate = decodeURIComponent(pathMatch[1]);
  }

  const normalized = normalizeShareCode(candidate);
  return /^[A-Z0-9]{8}$/.test(normalized) ? normalized : null;
}

export const formatShareCode = (value: string) => {
  const normalized = normalizeShareCode(value);
  return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
};
