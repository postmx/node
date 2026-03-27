import { createHmac, timingSafeEqual } from "node:crypto";
import { PostMXWebhookVerificationError } from "./errors";
import type { WebhookEvent } from "./types";

const SIGNATURE_PREFIX = "v1=";
const DEFAULT_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookParams {
  payload: string | Buffer;
  signature: string;
  timestamp: string;
  signingSecret: string;
  tolerance?: number;
}

export function verifyWebhookSignature(params: VerifyWebhookParams): WebhookEvent {
  const {
    payload,
    signature,
    timestamp,
    signingSecret,
    tolerance = DEFAULT_TOLERANCE_SECONDS,
  } = params;

  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    throw new PostMXWebhookVerificationError(
      "Invalid signature format: missing v1= prefix",
    );
  }

  const ts = Number(timestamp);
  if (Number.isNaN(ts)) {
    throw new PostMXWebhookVerificationError(
      "Invalid timestamp: not a number",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) {
    throw new PostMXWebhookVerificationError(
      `Timestamp outside tolerance: ${Math.abs(now - ts)}s > ${tolerance}s`,
    );
  }

  const rawBody = typeof payload === "string" ? payload : payload.toString("utf-8");
  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("base64url");

  const received = signature.slice(SIGNATURE_PREFIX.length);

  const expectedBuf = Buffer.from(expected, "utf-8");
  const receivedBuf = Buffer.from(received, "utf-8");

  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new PostMXWebhookVerificationError("Signature mismatch");
  }

  try {
    return JSON.parse(rawBody) as WebhookEvent;
  } catch {
    throw new PostMXWebhookVerificationError("Invalid JSON payload");
  }
}
