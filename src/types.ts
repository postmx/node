// --- Config ---

export interface PostMXConfig {
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
}

// --- Enums ---

export type LifecycleMode = "temporary" | "persistent";
export type MessageIntent = "login_code" | "verification" | "password_reset" | "magic_link" | "invite";
export type LinkType = "verification" | "magic_link" | "password_reset" | "unsubscribe" | "other";
export type ContentMode = "full" | "otp" | "links" | "text_only";
export type DeliveryScope = "account" | "inbox";

// --- Request params ---

export interface CreateInboxParams {
  label: string;
  lifecycle_mode: LifecycleMode;
  ttl_minutes?: number;
}

export interface ListMessagesParams {
  limit?: number;
  cursor?: string;
}

export interface CreateWebhookParams {
  label: string;
  target_url: string;
  inbox_id?: string;
}

export interface WaitForMessageOptions {
  /** Polling interval in milliseconds. Default: 1000 (1s). */
  intervalMs?: number;
  /** Maximum time to wait in milliseconds. Default: 60000 (60s). */
  timeoutMs?: number;
}

// --- Response types ---

export interface ListInboxesParams {
  limit?: number;
  cursor?: string;
}

export interface Inbox {
  id: string;
  label: string;
  email_address: string;
  lifecycle_mode: LifecycleMode;
  ttl_minutes: number | null;
  expires_at: string | null;
  status: string;
  last_message_received_at: string | null;
  created_at: string;
}

export interface MessageSummary {
  id: string;
  inbox_id: string;
  inbox_email_address: string;
  inbox_label: string;
  from_email: string;
  to_email: string;
  subject: string | null;
  preview_text: string | null;
  received_at: string;
  has_text_body: boolean;
  has_html_body: boolean;
}

export interface ExtractedLink {
  url: string;
  type: LinkType;
}

export interface MessageDetail extends MessageSummary {
  text_body: string | null;
  html_body: string | null;
  otp: string | null;
  links: ExtractedLink[];
  intent: MessageIntent | null;
}

export interface MessageOtpDetail extends MessageSummary {
  otp: string | null;
}

export interface MessageLinksDetail extends MessageSummary {
  links: ExtractedLink[];
}

export interface MessageTextOnlyDetail extends MessageSummary {
  text_body: string | null;
}

export interface WildcardAddress {
  email_address: string;
  inbox_id: string;
}

export interface PageInfo {
  has_more: boolean;
  next_cursor: string | null;
}

export interface Webhook {
  id: string;
  inbox_id: string | null;
  label: string;
  target_url: string;
  delivery_scope: DeliveryScope;
  subscribed_events: string[];
  status: string;
  last_delivery_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWebhookResult {
  webhook: Webhook;
  signing_secret: string;
}

// --- Webhook event ---

export interface WebhookEventInbox {
  id: string;
  email_address: string;
  label: string;
}

export interface WebhookEvent {
  id: string;
  type: "email.received";
  created_at: string;
  data: {
    inbox: WebhookEventInbox;
    message: MessageDetail;
  };
}
