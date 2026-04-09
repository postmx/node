# PostMX Node.js SDK

Official Node.js/TypeScript SDK for the [PostMX](https://postmx.co) API.

Think about PostMX in one simple flow: create a temporary inbox, wait for the next email, then read extracted fields like the OTP or first link.

Requires Node.js 18+.

## Install

```bash
npm install postmx
```

## Quick Start

```typescript
import { PostMX } from "postmx";

const postmx = new PostMX("pmx_live_...");

const inbox = await postmx.createTemporaryInbox({
  label: "signup-test",
});

console.log(inbox.email_address);

const message = await postmx.waitForMessage(inbox.id, {
  timeoutMs: 30_000,
});

console.log(message.otp);
console.log(message.links[0]?.url ?? null);
```

`waitForMessage()` returns the latest existing message immediately if the inbox already has one; otherwise it waits for the next incoming email until the timeout.

If you already have a message ID, `contentMode` is just a "what do you want back?" choice:

```typescript
const otpOnly = await postmx.getMessage("msg_123", "otp");
console.log(otpOnly.otp);
```

## API Reference

### `new PostMX(apiKey, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `https://api.postmx.co` | API base URL |
| `maxRetries` | `number` | `2` | Max retry attempts on 429/5xx |
| `timeout` | `number` | `30000` | Request timeout in ms |

### Methods

```typescript
postmx.listInboxes(params?)              // → Promise<{ inboxes, pageInfo }>
postmx.createInbox(params, options?)     // → Promise<Inbox>
postmx.createTemporaryInbox(params, options?) // → Promise<Inbox>
postmx.listMessages(inboxId, params?)    // → Promise<{ messages, pageInfo }>
postmx.listMessagesByRecipient(recipientEmail, params?) // → Promise<{ messages, pageInfo }>
postmx.getMessage(messageId)             // → Promise<MessageDetail>
postmx.createWebhook(params, options?)   // → Promise<CreateWebhookResult>
postmx.waitForMessage(inboxId, options?) // → Promise<MessageDetail>
```

## Advanced

- Use `createInbox()` when you need lifecycle controls like `persistent` inboxes or a custom `ttl_minutes`.
- Use `listInboxes()` when you need wildcard address information or pagination.
- Use `createWebhook()` and `verifyWebhookSignature()` when you want push delivery instead of polling.
- POST methods accept an optional `{ idempotencyKey: string }` in the options parameter. If not provided, one is auto-generated to make retries safe.

## Error Handling

```typescript
import { PostMXApiError, PostMXNetworkError } from "postmx";

try {
  await postmx.getMessage("bad_id");
} catch (err) {
  if (err instanceof PostMXApiError) {
    console.log(err.status);    // 404
    console.log(err.code);      // "not_found"
    console.log(err.message);   // "Message not found"
    console.log(err.requestId); // "req_abc123"
  } else if (err instanceof PostMXNetworkError) {
    console.log(err.cause);     // original fetch error
  }
}
```

## Webhook Verification

```typescript
import { verifyWebhookSignature } from "postmx";

// In your webhook handler (e.g., Express)
app.post("/webhooks/postmx", (req, res) => {
  try {
    const event = verifyWebhookSignature({
      payload: req.body,           // raw body string/Buffer
      signature: req.headers["x-postmx-signature"],
      timestamp: req.headers["x-postmx-timestamp"],
      signingSecret: process.env.POSTMX_WEBHOOK_SECRET,
    });

    console.log(event.data.message.otp);
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(400);
  }
});
```

## License

MIT
