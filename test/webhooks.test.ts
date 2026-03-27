import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../src/webhooks";
import { PostMXWebhookVerificationError } from "../src/errors";

const SIGNING_SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify({
  id: "evt_1",
  type: "email.received",
  created_at: "2026-01-01T00:00:00Z",
  data: {
    inbox: { id: "inb_1", email_address: "a@b.com", label: "test" },
    message: { id: "msg_1", inbox_id: "inb_1", inbox_email_address: "a@b.com", inbox_label: "test", from_email: "sender@x.com", to_email: "a@b.com", subject: "OTP", preview_text: null, received_at: "2026-01-01T00:00:00Z", has_text_body: true, has_html_body: false, text_body: "123456", html_body: null, otp: "123456", links: [], intent: "login_code" },
  },
});

function makeSignature(secret: string, timestamp: string, body: string): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url");
  return `v1=${hmac}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyWebhookSignature", () => {
  it("verifies valid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = makeSignature(SIGNING_SECRET, timestamp, PAYLOAD);

    const event = verifyWebhookSignature({
      payload: PAYLOAD,
      signature,
      timestamp,
      signingSecret: SIGNING_SECRET,
    });

    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("email.received");
    expect(event.data.message.otp).toBe("123456");
  });

  it("verifies with Buffer payload", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = makeSignature(SIGNING_SECRET, timestamp, PAYLOAD);

    const event = verifyWebhookSignature({
      payload: Buffer.from(PAYLOAD),
      signature,
      timestamp,
      signingSecret: SIGNING_SECRET,
    });

    expect(event.id).toBe("evt_1");
  });

  it("rejects missing v1= prefix", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(() =>
      verifyWebhookSignature({
        payload: PAYLOAD,
        signature: "bad_signature",
        timestamp,
        signingSecret: SIGNING_SECRET,
      }),
    ).toThrow(PostMXWebhookVerificationError);
  });

  it("rejects invalid timestamp", () => {
    expect(() =>
      verifyWebhookSignature({
        payload: PAYLOAD,
        signature: "v1=abc",
        timestamp: "not-a-number",
        signingSecret: SIGNING_SECRET,
      }),
    ).toThrow("Invalid timestamp");
  });

  it("rejects expired timestamp", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const signature = makeSignature(SIGNING_SECRET, oldTimestamp, PAYLOAD);

    expect(() =>
      verifyWebhookSignature({
        payload: PAYLOAD,
        signature,
        timestamp: oldTimestamp,
        signingSecret: SIGNING_SECRET,
      }),
    ).toThrow("Timestamp outside tolerance");
  });

  it("rejects tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = makeSignature(SIGNING_SECRET, timestamp, PAYLOAD);

    expect(() =>
      verifyWebhookSignature({
        payload: PAYLOAD.replace("123456", "999999"),
        signature,
        timestamp,
        signingSecret: SIGNING_SECRET,
      }),
    ).toThrow("Signature mismatch");
  });

  it("rejects wrong signing secret", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = makeSignature("wrong_secret", timestamp, PAYLOAD);

    expect(() =>
      verifyWebhookSignature({
        payload: PAYLOAD,
        signature,
        timestamp,
        signingSecret: SIGNING_SECRET,
      }),
    ).toThrow("Signature mismatch");
  });

  it("respects custom tolerance", () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 10);
    const signature = makeSignature(SIGNING_SECRET, timestamp, PAYLOAD);

    // Should fail with 5-second tolerance
    expect(() =>
      verifyWebhookSignature({
        payload: PAYLOAD,
        signature,
        timestamp,
        signingSecret: SIGNING_SECRET,
        tolerance: 5,
      }),
    ).toThrow("Timestamp outside tolerance");

    // Should pass with 60-second tolerance
    const event = verifyWebhookSignature({
      payload: PAYLOAD,
      signature,
      timestamp,
      signingSecret: SIGNING_SECRET,
      tolerance: 60,
    });
    expect(event.id).toBe("evt_1");
  });
});
