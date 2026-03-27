import { PostMX } from "../dist/index.js";

let capturedUrl = null;

globalThis.fetch = async (url) => {
  capturedUrl = String(url);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "x-request-id": "req_smoke" }),
    json: async () => ({
      success: true,
      request_id: "req_smoke",
      messages: [{ id: "msg_smoke" }],
      page_info: { has_more: false, next_cursor: null },
    }),
  };
};

const client = new PostMX("pmx_live_test", { baseUrl: process.env.POSTMX_BASE_URL ?? "" });
const result = await client.listMessagesByRecipient("smoke@test.postmx.email", { limit: 1 });

console.log(JSON.stringify({
  ok: true,
  url: capturedUrl,
  message_count: result.messages.length,
}, null, 2));
