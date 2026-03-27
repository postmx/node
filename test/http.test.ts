import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { request } from "../src/http";
import { PostMXApiError, PostMXNetworkError } from "../src/errors";

const BASE_CONFIG = {
  apiKey: "pmx_live_test",
  baseUrl: "https://api.postmx.co",
  maxRetries: 2,
  timeout: 5000,
};

function mockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++];
    if (!resp) throw new Error("No more mock responses");
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: `Status ${resp.status}`,
      headers: new Headers({ "x-request-id": "req_test", ...resp.headers }),
      json: async () => resp.body,
    } as Response;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("request", () => {
  it("returns data on success", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { success: true, request_id: "req_1", inbox: { id: "inb_1" } } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await request<{ inbox: { id: string } }>({
      ...BASE_CONFIG,
      method: "GET",
      path: "/v1/inboxes",
    });

    expect(result.data.inbox.id).toBe("inb_1");
    expect(result.requestId).toBe("req_1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends correct headers on GET", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { success: true, request_id: "req_1" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await request({ ...BASE_CONFIG, method: "GET", path: "/v1/test" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer pmx_live_test");
    expect(init.headers["Accept"]).toBe("application/json");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("sends Content-Type and Idempotency-Key on POST", async () => {
    const fetchMock = mockFetch([
      { status: 201, body: { success: true, request_id: "req_1" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await request({
      ...BASE_CONFIG,
      method: "POST",
      path: "/v1/test",
      body: { foo: "bar" },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Idempotency-Key"]).toBeDefined();
    expect(init.body).toBe('{"foo":"bar"}');
  });

  it("uses provided idempotency key", async () => {
    const fetchMock = mockFetch([
      { status: 201, body: { success: true, request_id: "req_1" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await request({
      ...BASE_CONFIG,
      method: "POST",
      path: "/v1/test",
      body: {},
      idempotencyKey: "my-key",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Idempotency-Key"]).toBe("my-key");
  });

  it("builds query params", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { success: true, request_id: "req_1" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await request({
      ...BASE_CONFIG,
      method: "GET",
      path: "/v1/messages",
      query: { limit: 10, cursor: "abc", unused: undefined },
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=abc");
    expect(url).not.toContain("unused");
  });

  it("throws PostMXApiError on non-retryable error", async () => {
    const fetchMock = mockFetch([
      {
        status: 404,
        body: {
          success: false,
          request_id: "req_err",
          error: { code: "not_found", message: "Inbox not found" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await request({ ...BASE_CONFIG, method: "GET", path: "/v1/inboxes/bad" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PostMXApiError);
      const err = e as PostMXApiError;
      expect(err.status).toBe(404);
      expect(err.code).toBe("not_found");
      expect(err.requestId).toBe("req_err");
    }

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries on 429 and succeeds", async () => {
    const fetchMock = mockFetch([
      {
        status: 429,
        body: {
          success: false,
          request_id: "req_r1",
          error: { code: "rate_limited", message: "Too fast", retry_after_seconds: 1 },
        },
        headers: { "retry-after": "1" },
      },
      { status: 200, body: { success: true, request_id: "req_ok" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await request({ ...BASE_CONFIG, method: "GET", path: "/v1/test" });
    expect(result.requestId).toBe("req_ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 and exhausts retries", async () => {
    const fetchMock = mockFetch([
      { status: 500, body: { success: false, request_id: "req_1", error: { code: "internal", message: "Server error" } } },
      { status: 500, body: { success: false, request_id: "req_2", error: { code: "internal", message: "Server error" } } },
      { status: 500, body: { success: false, request_id: "req_3", error: { code: "internal", message: "Server error" } } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      request({ ...BASE_CONFIG, method: "GET", path: "/v1/test" }),
    ).rejects.toThrow(PostMXApiError);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("retries on network error and succeeds", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new TypeError("fetch failed");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "x-request-id": "req_ok" }),
        json: async () => ({ success: true, request_id: "req_ok" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await request({ ...BASE_CONFIG, method: "GET", path: "/v1/test" });
    expect(result.requestId).toBe("req_ok");
  });

  it("throws PostMXNetworkError when all retries fail", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      request({ ...BASE_CONFIG, method: "GET", path: "/v1/test" }),
    ).rejects.toThrow(PostMXNetworkError);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reuses same idempotency key across POST retries", async () => {
    const fetchMock = mockFetch([
      { status: 500, body: { success: false, request_id: "r1", error: { code: "internal", message: "err" } } },
      { status: 201, body: { success: true, request_id: "r2" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await request({ ...BASE_CONFIG, method: "POST", path: "/v1/test", body: {} });

    const key1 = fetchMock.mock.calls[0][1].headers["Idempotency-Key"];
    const key2 = fetchMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(key1).toBeDefined();
    expect(key1).toBe(key2);
  });
});
