import { randomUUID } from "node:crypto";
import { PostMXApiError, PostMXNetworkError } from "./errors";

const VERSION = "0.1.0";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;
const BASE_DELAY_MS = 500;

interface RequestConfig {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  timeout: number;
}

interface ApiResponse<T> {
  data: T;
  requestId: string;
}

interface ErrorBody {
  success: false;
  request_id: string;
  error: { code: string; message: string; retry_after_seconds?: number };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return ms * (0.5 + Math.random() * 0.5);
}

export async function request<T>(config: RequestConfig): Promise<ApiResponse<T>> {
  const {
    method,
    path,
    body,
    query,
    apiKey,
    baseUrl,
    maxRetries,
    timeout,
  } = config;

  const url = buildUrl(baseUrl, path, query);
  const idempotencyKey = method === "POST"
    ? (config.idempotencyKey ?? randomUUID())
    : undefined;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Accept": "application/json",
    "User-Agent": `postmx-node/${VERSION}`,
  };

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });

      const requestId = response.headers.get("x-request-id") ?? undefined;

      if (response.ok) {
        const json = await response.json() as { success: true; request_id: string } & T;
        return { data: json, requestId: json.request_id };
      }

      const errorJson = await response.json().catch(() => null) as ErrorBody | null;
      const errorRequestId = errorJson?.request_id ?? requestId;
      const code = errorJson?.error?.code ?? `http_${response.status}`;
      const message = errorJson?.error?.message ?? response.statusText;
      const retryAfterSeconds = errorJson?.error?.retry_after_seconds
        ?? (response.headers.get("retry-after") ? Number(response.headers.get("retry-after")) : undefined);

      const apiError = new PostMXApiError(
        response.status,
        code,
        message,
        errorRequestId,
        retryAfterSeconds,
      );

      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === maxRetries) {
        throw apiError;
      }

      lastError = apiError;

      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
      const retryAfterMs = retryAfterSeconds ? retryAfterSeconds * 1000 : 0;
      await sleep(Math.max(jitter(backoff), retryAfterMs));
    } catch (error) {
      if (error instanceof PostMXApiError) {
        throw error;
      }

      const networkError = new PostMXNetworkError(
        error instanceof Error ? error : new Error(String(error)),
      );

      if (attempt === maxRetries) {
        throw networkError;
      }

      lastError = networkError;
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
      await sleep(jitter(backoff));
    }
  }

  throw lastError ?? new Error("Unexpected: no attempts made");
}
