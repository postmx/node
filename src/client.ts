import { request } from "./http";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./config";
import type {
  PostMXConfig,
  ContentMode,
  CreateInboxParams,
  CreateTemporaryInboxParams,
  ListInboxesParams,
  Inbox,
  ListMessagesParams,
  MessageSummary,
  MessageDetail,
  MessageOtpDetail,
  MessageLinksDetail,
  MessageTextOnlyDetail,
  PageInfo,
  WildcardAddress,
  CreateWebhookParams,
  CreateWebhookResult,
  WaitForMessageOptions,
} from "./types";
import { PostMXError } from "./errors";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT = 30_000;

export class PostMX {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeout: number;

  constructor(apiKey: string, options?: PostMXConfig) {
    if (!apiKey) throw new Error("PostMX: apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  }

  async listInboxes(
    params?: ListInboxesParams,
  ): Promise<{ inboxes: Inbox[]; pageInfo: PageInfo; wildcard_address: WildcardAddress | null }> {
    const { data } = await request<{
      inboxes: Inbox[];
      page_info: PageInfo;
      wildcard_address: WildcardAddress | null;
    }>({
      method: "GET",
      path: "/v1/inboxes",
      query: {
        limit: params?.limit,
        cursor: params?.cursor,
      },
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });
    return { inboxes: data.inboxes, pageInfo: data.page_info, wildcard_address: data.wildcard_address ?? null };
  }

  async createInbox(
    params: CreateInboxParams,
    options?: { idempotencyKey?: string },
  ): Promise<Inbox> {
    const { data } = await request<{ inbox: Inbox }>({
      method: "POST",
      path: "/v1/inboxes",
      body: params,
      idempotencyKey: options?.idempotencyKey,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });
    return data.inbox;
  }

  async createTemporaryInbox(
    params: CreateTemporaryInboxParams,
    options?: { idempotencyKey?: string },
  ): Promise<Inbox> {
    return this.createInbox(
      {
        label: params.label,
        lifecycle_mode: "temporary",
        ...(params.ttl_minutes !== undefined ? { ttl_minutes: params.ttl_minutes } : {}),
        ...(params.message_analysis ? { message_analysis: params.message_analysis } : {}),
      },
      options,
    );
  }

  async listMessages(
    inboxId: string,
    params?: ListMessagesParams,
  ): Promise<{ messages: MessageSummary[]; pageInfo: PageInfo }> {
    const { data } = await request<{
      messages: MessageSummary[];
      page_info: PageInfo;
    }>({
      method: "GET",
      path: `/v1/inboxes/${encodeURIComponent(inboxId)}/messages`,
      query: {
        limit: params?.limit,
        cursor: params?.cursor,
      },
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });
    return { messages: data.messages, pageInfo: data.page_info };
  }

  async listMessagesByRecipient(
    recipientEmail: string,
    params?: ListMessagesParams,
  ): Promise<{ messages: MessageSummary[]; pageInfo: PageInfo }> {
    const { data } = await request<{
      messages: MessageSummary[];
      page_info: PageInfo;
    }>({
      method: "GET",
      path: "/v1/messages",
      query: {
        recipient_email: recipientEmail,
        limit: params?.limit,
        cursor: params?.cursor,
      },
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });
    return { messages: data.messages, pageInfo: data.page_info };
  }

  async getMessage(messageId: string): Promise<MessageDetail>;
  async getMessage(messageId: string, contentMode: "full"): Promise<MessageDetail>;
  async getMessage(messageId: string, contentMode: "otp"): Promise<MessageOtpDetail>;
  async getMessage(messageId: string, contentMode: "links"): Promise<MessageLinksDetail>;
  async getMessage(messageId: string, contentMode: "text_only"): Promise<MessageTextOnlyDetail>;
  async getMessage(messageId: string, contentMode?: ContentMode): Promise<MessageDetail | MessageOtpDetail | MessageLinksDetail | MessageTextOnlyDetail> {
    const { data } = await request<{ message: MessageDetail | MessageOtpDetail | MessageLinksDetail | MessageTextOnlyDetail }>({
      method: "GET",
      path: `/v1/messages/${encodeURIComponent(messageId)}`,
      query: contentMode ? { content_mode: contentMode } : undefined,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });
    return data.message;
  }

  async createWebhook(
    params: CreateWebhookParams,
    options?: { idempotencyKey?: string },
  ): Promise<CreateWebhookResult> {
    const { data } = await request<{ webhook: CreateWebhookResult["webhook"]; signing_secret: string }>({
      method: "POST",
      path: "/v1/webhooks",
      body: params,
      idempotencyKey: options?.idempotencyKey,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });
    return { webhook: data.webhook, signing_secret: data.signing_secret };
  }

  /**
   * Return the latest existing message immediately, or wait for the next incoming email until timeout.
   *
   * Useful for test automation — create an inbox, trigger an email, then:
   *   const msg = await client.waitForMessage("inb_123");
   *   console.log(msg.otp);
   */
  async waitForMessage(
    inboxId: string,
    options?: WaitForMessageOptions,
  ): Promise<MessageDetail> {
    const intervalMs = options?.intervalMs ?? 1_000;
    const timeoutMs = options?.timeoutMs ?? 60_000;

    if (intervalMs < 200) {
      throw new PostMXError("intervalMs must be at least 200ms to avoid excessive API calls");
    }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { messages } = await this.listMessages(inboxId, { limit: 1 });

      if (messages.length > 0) {
        return this.getMessage(messages[0].id);
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }

    throw new PostMXError(
      `Timed out after ${timeoutMs}ms waiting for a message in inbox ${inboxId}`,
    );
  }
}
