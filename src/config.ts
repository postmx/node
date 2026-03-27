export const DEFAULT_BASE_URL = "https://api.postmx.co";

export function normalizeBaseUrl(
  baseUrl?: string | null,
  fallback = DEFAULT_BASE_URL,
): string {
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim() : "";
  const candidate = trimmed.length > 0 ? trimmed : fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`PostMX: baseUrl must be a valid absolute URL (received: ${JSON.stringify(baseUrl)})`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`PostMX: baseUrl must use http or https (received: ${JSON.stringify(baseUrl)})`);
  }

  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
