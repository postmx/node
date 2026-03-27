# PostMX Node.js SDK

Official Node.js/TypeScript SDK for the [PostMX](https://postmx.co) API.

- Zero runtime dependencies (uses built-in `fetch` + `node:crypto`)
- Full TypeScript types
- Automatic retries with exponential backoff
- Webhook signature verification

Requires Node.js 18+.

## Install

```bash
npm install postmx
```

## Quick Start

```typescript
import { PostMX } from "postmx";

const postmx = new PostMX("pmx_live_...");

// Create a temporary inbox
const inbox = await postmx.createInbox({
  label: "signup-test",
  lifecycle_mode: "temporary",
  ttl_minutes: 15,
});
console.log(inbox.email_address);

// List active inboxes
const { inboxes, pageInfo: inboxPage } = await postmx.listInboxes();

// List messages
const { messages, pageInfo } = await postmx.listMessages(inbox.id);

// Or list messages by exact recipient email
const recipientFeed = await postmx.listMessagesByRecipient(inbox.email_address);

// Get full message detail with OTP extraction
const detail = await postmx.getMessage(messages[0].id);
console.log(detail.otp);    // "482910"
console.log(detail.intent); // "login_code"
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
postmx.listMessages(inboxId, params?)    // → Promise<{ messages, pageInfo }>
postmx.listMessagesByRecipient(recipientEmail, params?) // → Promise<{ messages, pageInfo }>
postmx.getMessage(messageId)             // → Promise<MessageDetail>
postmx.createWebhook(params, options?)   // → Promise<CreateWebhookResult>
postmx.waitForMessage(inboxId, options?) // → Promise<MessageDetail>
```

POST methods accept an optional `{ idempotencyKey: string }` in the options parameter. If not provided, one is auto-generated to make retries safe.

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
