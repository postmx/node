import { describe, it, expect, vi, afterEach } from "vitest";
import { PostMX } from "../src/client";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: `Status ${status}`,
      headers: new Headers({ "x-request-id": "req_test" }),
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostMX client", () => {
  it("throws if apiKey is empty", () => {
    expect(() => new PostMX("")).toThrow("apiKey is required");
  });

  it("listInboxes returns inboxes with pagination", async () => {
    const inboxes = [
      { id: "inb_1", label: "test", email_address: "a@b.com", lifecycle_mode: "temporary", ttl_minutes: 15, expires_at: null, status: "active", last_message_received_at: "2026-03-25T18:04:10Z", created_at: "2026-01-01T00:00:00Z" },
      { id: "inb_2", label: "support", email_address: "b@c.com", lifecycle_mode: "persistent", ttl_minutes: null, expires_at: null, status: "active", last_message_received_at: null, created_at: "2026-01-02T00:00:00Z" },
    ];
    const page_info = { has_more: false, next_cursor: null };
    mockFetchOnce(200, { success: true, request_id: "req_1", inboxes, page_info });

    const client = new PostMX("pmx_live_test");
    const result = await client.listInboxes({ limit: 10 });

    expect(result.inboxes).toEqual(inboxes);
    expect(result.pageInfo).toEqual(page_info);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/v1/inboxes");
    expect(url).toContain("limit=10");
    expect(init!.method).toBe("GET");
  });

  it("listInboxes works with no params", async () => {
    const inboxes = [{ id: "inb_1", label: "test", email_address: "a@b.com", lifecycle_mode: "temporary", ttl_minutes: null, expires_at: null, status: "active", last_message_received_at: null, created_at: "2026-01-01T00:00:00Z" }];
    const page_info = { has_more: false, next_cursor: null };
    mockFetchOnce(200, { success: true, request_id: "req_1", inboxes, page_info });

    const client = new PostMX("pmx_live_test");
    const result = await client.listInboxes();

    expect(result.inboxes).toHaveLength(1);
    expect(result.inboxes[0].id).toBe("inb_1");
  });

  it("createInbox sends correct request and returns inbox", async () => {
    const inbox = { id: "inb_1", label: "test", email_address: "a@b.com", lifecycle_mode: "temporary", ttl_minutes: 15, expires_at: null, status: "active", created_at: "2026-01-01T00:00:00Z" };
    mockFetchOnce(201, { success: true, request_id: "req_1", inbox });

    const client = new PostMX("pmx_live_test");
    const result = await client.createInbox({ label: "test", lifecycle_mode: "temporary", ttl_minutes: 15 });

    expect(result).toEqual(inbox);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/v1/inboxes");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ label: "test", lifecycle_mode: "temporary", ttl_minutes: 15 });
  });

  it("listMessages sends correct request with pagination", async () => {
    const messages = [{ id: "msg_1" }];
    const page_info = { has_more: false, next_cursor: null };
    mockFetchOnce(200, { success: true, request_id: "req_1", messages, page_info });

    const client = new PostMX("pmx_live_test");
    const result = await client.listMessages("inb_1", { limit: 10, cursor: "cur_abc" });

    expect(result.messages).toEqual(messages);
    expect(result.pageInfo).toEqual(page_info);

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/v1/inboxes/inb_1/messages");
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=cur_abc");
  });

  it("listMessagesByRecipient sends correct request with pagination", async () => {
    const messages = [{ id: "msg_1" }];
    const page_info = { has_more: false, next_cursor: null };
    mockFetchOnce(200, { success: true, request_id: "req_1", messages, page_info });

    const client = new PostMX("pmx_live_test");
    const result = await client.listMessagesByRecipient("signup@test.postmx.email", {
      limit: 10,
      cursor: "cur_abc",
    });

    expect(result.messages).toEqual(messages);
    expect(result.pageInfo).toEqual(page_info);

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/v1/messages");
    expect(url).toContain("recipient_email=signup%40test.postmx.email");
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=cur_abc");
  });

  it("getMessage returns message detail", async () => {
    const message = { id: "msg_1", otp: "123456", links: [], intent: "login_code" };
    mockFetchOnce(200, { success: true, request_id: "req_1", message });

    const client = new PostMX("pmx_live_test");
    const result = await client.getMessage("msg_1");

    expect(result).toEqual(message);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/v1/messages/msg_1");
    expect(url).not.toContain("content_mode");
  });

  it("getMessage with content_mode=otp sends query param", async () => {
    const message = { id: "msg_1", otp: "123456" };
    mockFetchOnce(200, { success: true, request_id: "req_1", message });

    const client = new PostMX("pmx_live_test");
    const result = await client.getMessage("msg_1", "otp");

    expect(result).toEqual(message);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("content_mode=otp");
  });

  it("getMessage with content_mode=links sends query param", async () => {
    const message = { id: "msg_1", links: [{ url: "https://example.com", type: "verification" }] };
    mockFetchOnce(200, { success: true, request_id: "req_1", message });

    const client = new PostMX("pmx_live_test");
    const result = await client.getMessage("msg_1", "links");

    expect(result).toEqual(message);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("content_mode=links");
  });

  it("getMessage with content_mode=text_only sends query param", async () => {
    const message = { id: "msg_1", text_body: "Hello world" };
    mockFetchOnce(200, { success: true, request_id: "req_1", message });

    const client = new PostMX("pmx_live_test");
    const result = await client.getMessage("msg_1", "text_only");

    expect(result).toEqual(message);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("content_mode=text_only");
  });

  it("createWebhook returns webhook and signing_secret", async () => {
    const webhook = { id: "wh_1", label: "test", target_url: "https://example.com/hook", delivery_scope: "account", subscribed_events: ["email.received"], status: "active", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", inbox_id: null, last_delivery_at: null, archived_at: null };
    mockFetchOnce(201, { success: true, request_id: "req_1", webhook, signing_secret: "whsec_abc" });

    const client = new PostMX("pmx_live_test");
    const result = await client.createWebhook({ label: "test", target_url: "https://example.com/hook" });

    expect(result.webhook).toEqual(webhook);
    expect(result.signing_secret).toBe("whsec_abc");
  });

  it("waitForMessage polls until a message arrives", async () => {
    const emptyResponse = { success: true, request_id: "req_1", messages: [], page_info: { has_more: false, next_cursor: null } };
    const messagesResponse = { success: true, request_id: "req_2", messages: [{ id: "msg_1" }], page_info: { has_more: false, next_cursor: null } };
    const messageDetail = { id: "msg_1", otp: "123456", links: [], intent: "login_code" };
    const detailResponse = { success: true, request_id: "req_3", message: messageDetail };

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        callCount++;
        // First 2 calls: empty list. Third call: message found. Fourth call: getMessage.
        let body: unknown;
        if (callCount <= 2) {
          body = emptyResponse;
        } else if (url.includes("/v1/messages/msg_1")) {
          body = detailResponse;
        } else {
          body = messagesResponse;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "x-request-id": `req_${callCount}` }),
          json: async () => body,
        };
      }),
    );

    const client = new PostMX("pmx_live_test");
    const result = await client.waitForMessage("inb_1", { intervalMs: 200 });

    expect(result).toEqual(messageDetail);
    expect(callCount).toBeGreaterThanOrEqual(3); // at least 2 empty polls + 1 found + 1 detail
  });

  it("waitForMessage throws on timeout", async () => {
    const emptyResponse = { success: true, request_id: "req_1", messages: [], page_info: { has_more: false, next_cursor: null } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "x-request-id": "req_1" }),
        json: async () => emptyResponse,
      })),
    );

    const client = new PostMX("pmx_live_test");
    await expect(
      client.waitForMessage("inb_1", { intervalMs: 200, timeoutMs: 500 }),
    ).rejects.toThrow("Timed out");
  });

  it("waitForMessage rejects intervalMs below 200", async () => {
    const client = new PostMX("pmx_live_test");
    await expect(
      client.waitForMessage("inb_1", { intervalMs: 50 }),
    ).rejects.toThrow("intervalMs must be at least 200ms");
  });

  it("uses custom baseUrl", async () => {
    mockFetchOnce(200, { success: true, request_id: "req_1", message: {} });

    const client = new PostMX("pmx_live_test", { baseUrl: "https://custom.api.com" });
    await client.getMessage("msg_1");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("https://custom.api.com");
  });
});
