export class PostMXError extends Error {
  public readonly requestId: string | undefined;

  constructor(message: string, requestId?: string) {
    super(message);
    this.name = "PostMXError";
    this.requestId = requestId;
  }
}

export class PostMXApiError extends PostMXError {
  public readonly status: number;
  public readonly code: string;
  public readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    retryAfterSeconds?: number,
  ) {
    super(message, requestId);
    this.name = "PostMXApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  override toString(): string {
    const parts = [`PostMXApiError: ${this.code} - ${this.message}`];
    if (this.requestId) parts.push(`request_id: ${this.requestId}`);
    parts.push(`status: ${this.status}`);
    return parts.length > 1
      ? `${parts[0]} (${parts.slice(1).join(", ")})`
      : parts[0];
  }
}

export class PostMXNetworkError extends PostMXError {
  public override readonly cause: Error;

  constructor(cause: Error, requestId?: string) {
    super(`Network error: ${cause.message}`, requestId);
    this.name = "PostMXNetworkError";
    this.cause = cause;
  }
}

export class PostMXWebhookVerificationError extends PostMXError {
  constructor(message: string) {
    super(message);
    this.name = "PostMXWebhookVerificationError";
  }
}
