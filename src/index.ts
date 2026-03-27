export { PostMX } from "./client";
export { verifyWebhookSignature } from "./webhooks";
export type { VerifyWebhookParams } from "./webhooks";
export {
  PostMXError,
  PostMXApiError,
  PostMXNetworkError,
  PostMXWebhookVerificationError,
} from "./errors";
export type {
  PostMXConfig,
  LifecycleMode,
  MessageIntent,
  ContentMode,
  LinkType,
  DeliveryScope,
  CreateInboxParams,
  ListInboxesParams,
  ListMessagesParams,
  CreateWebhookParams,
  Inbox,
  MessageSummary,
  MessageDetail,
  MessageOtpDetail,
  MessageLinksDetail,
  MessageTextOnlyDetail,
  ExtractedLink,
  PageInfo,
  WildcardAddress,
  Webhook,
  CreateWebhookResult,
  WaitForMessageOptions,
  WebhookEvent,
  WebhookEventInbox,
} from "./types";
