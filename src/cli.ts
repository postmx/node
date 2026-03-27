import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PostMX } from "./client.js";
import { PostMXError, PostMXApiError, PostMXNetworkError } from "./errors.js";

const VERSION = "0.1.0";

// ── ANSI ────────────────────────────────────────────────────────────

function log(msg: string): void { process.stdout.write(msg + "\n"); }
function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function cyan(s: string): string { return `\x1b[36m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[0m`; }

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function fit(s: string, n: number): string {
  return trunc(s, n).padEnd(n);
}

type MessageFeedResult = {
  messages: Array<Record<string, unknown>>;
  pageInfo: { has_more: boolean; next_cursor: string | null };
};

type CliConfig = {
  apiKey?: string;
};

function error(msg: string): never {
  process.stderr.write(`\x1b[31merror:\x1b[0m ${msg}\n`);
  process.exit(1);
}

function getConfigPath(): string {
  const root = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "postmx")
    : join(homedir(), ".config", "postmx");
  return join(root, "config.json");
}

function readCliConfig(): CliConfig {
  try {
    return JSON.parse(readFileSync(getConfigPath(), "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

function writeCliConfig(config: CliConfig): void {
  const configPath = getConfigPath();
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${configPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, configPath);
}

function clearCliConfig(): void {
  rmSync(getConfigPath(), { force: true });
}

function resolveApiKey(flags: Record<string, string | boolean>): string | undefined {
  const flagKey = typeof flags["api-key"] === "string" ? flags["api-key"] : undefined;
  if (flagKey) return flagKey;
  if (process.env.POSTMX_API_KEY) return process.env.POSTMX_API_KEY;
  const storedKey = readCliConfig().apiKey;
  return typeof storedKey === "string" && storedKey.length > 0 ? storedKey : undefined;
}

function resolveBaseUrl(flags: Record<string, string | boolean>): string | undefined {
  return typeof flags["base-url"] === "string"
    ? flags["base-url"]
    : process.env.POSTMX_BASE_URL || undefined;
}

async function listMessagesByRecipientCompat(
  client: PostMX,
  recipientEmail: string,
  params?: { limit?: number; cursor?: string },
): Promise<MessageFeedResult> {
  const reflectiveClient = client as unknown as Record<string, unknown>;
  const method = reflectiveClient["listMessagesByRecipient"];

  if (typeof method === "function") {
    return (method as (
      recipient: string,
      options?: { limit?: number; cursor?: string },
    ) => Promise<MessageFeedResult>).call(client, recipientEmail, params);
  }

  const apiKey = typeof reflectiveClient["apiKey"] === "string"
    ? reflectiveClient["apiKey"]
    : resolveApiKey({});
  const baseUrl = typeof reflectiveClient["baseUrl"] === "string"
    ? reflectiveClient["baseUrl"]
    : process.env.POSTMX_BASE_URL ?? "https://api.postmx.co";
  if (!apiKey) error("Missing API key. Pass --api-key, set POSTMX_API_KEY, or run `postmx auth login --api-key <key>`.");

  const url = new URL("/v1/messages", baseUrl);
  url.searchParams.set("recipient_email", recipientEmail);
  if (params?.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params?.cursor) url.searchParams.set("cursor", params.cursor);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
      "User-Agent": `postmx-node/${VERSION}`,
    },
  });

  const body = await response.json().catch(() => null) as
    | { messages?: Array<Record<string, unknown>>; page_info?: { has_more: boolean; next_cursor: string | null }; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
  }

  return {
    messages: body?.messages ?? [],
    pageInfo: body?.page_info ?? { has_more: false, next_cursor: null },
  };
}

// ── Arg parsing ─────────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-i") {
      flags["interactive"] = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] ?? "",
    positional: positional.slice(1),
    flags,
  };
}

// ── Non-interactive commands ────────────────────────────────────────

function printHelp(): void {
  log(`
${bold("postmx")} ${dim(`v${VERSION}`)} — PostMX CLI

${bold("USAGE")}
  postmx <command> [options]
  postmx -i                  Launch interactive mode

${bold("COMMANDS")}
  ${cyan("auth login")}              Save an API key locally for future CLI use
  ${cyan("auth logout")}             Remove the locally saved API key
  ${cyan("watch")} <inbox_id>         Poll an inbox and print messages as they arrive
  ${cyan("inboxes")}                  List active inboxes
  ${cyan("inbox create")}             Create a new inbox
  ${cyan("inbox list")} <inbox_id>    List messages in an inbox
  ${cyan("messages list")}            List messages by exact recipient email
  ${cyan("message get")} <message_id> Get message details [--content-mode full|otp|links|text_only]

${bold("OPTIONS")}
  -i, --interactive          Launch interactive TUI
  --help                     Show this help
  --version                  Show version
  --api-key <key>            API key (or set POSTMX_API_KEY or saved CLI config)
  --content-mode <mode>      Response mode: full (default), otp, links, text_only

${bold("ENVIRONMENT")}
  POSTMX_API_KEY             Your PostMX API key (required)
  POSTMX_BASE_URL            API base URL (optional, default: https://api.postmx.co)

${bold("EXAMPLES")}
  ${dim("# Save API key once")}
  postmx auth login --api-key pmx_live_...

  ${dim("# Interactive mode")}
  postmx -i

  ${dim("# Watch an inbox for incoming emails")}
  postmx watch inb_abc123

  ${dim("# Create a temporary inbox")}
  postmx inbox create --label "signup-test" --mode temporary --ttl 15

  ${dim("# List messages for one recipient")}
  postmx messages list --recipient-email signup-test@postmx.email

  ${dim("# Get a specific message")}
  postmx message get msg_abc123
`.trim());
}

async function cmdAuthLogin(args: ParsedArgs): Promise<void> {
  const apiKey = args.flags["api-key"] as string | undefined;
  if (!apiKey) error("Usage: postmx auth login --api-key <key>");

  try {
    writeCliConfig({ ...readCliConfig(), apiKey });
  } catch (err) {
    error(`Could not save API key locally: ${err instanceof Error ? err.message : String(err)}`);
  }
  log(`Saved API key to ${getConfigPath()}`);
}

async function cmdAuthLogout(): Promise<void> {
  try {
    clearCliConfig();
  } catch (err) {
    error(`Could not remove saved API key: ${err instanceof Error ? err.message : String(err)}`);
  }
  log(`Removed saved API key from ${getConfigPath()}`);
}

async function cmdWatch(client: PostMX, args: ParsedArgs): Promise<void> {
  const inboxId = args.positional[0];
  if (!inboxId) error("Usage: postmx watch <inbox_id>");

  const interval = Number(args.flags["interval"] ?? 2);
  const intervalMs = interval * 1000;

  log(`${dim("Watching")} ${cyan(inboxId)} ${dim(`(polling every ${interval}s — Ctrl+C to stop)`)}`);
  log("");

  const seen = new Set<string>();
  let running = true;
  const shutdown = () => { running = false; log(dim("\nStopped.")); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    try {
      const { messages } = await client.listMessages(inboxId, { limit: 20 });
      for (const msg of messages) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        const detail = await client.getMessage(msg.id);
        log(bold("── New message ──────────────────────────────"));
        log(`  ${bold("ID:")}      ${detail.id}`);
        log(`  ${bold("From:")}    ${detail.from_email}`);
        log(`  ${bold("Subject:")} ${detail.subject ?? dim("(none)")}`);
        log(`  ${bold("Time:")}    ${detail.received_at}`);
        if (detail.otp) log(`  ${bold("OTP:")}     ${green(detail.otp)}`);
        if (detail.intent) log(`  ${bold("Intent:")}  ${yellow(detail.intent)}`);
        if (detail.links.length > 0) {
          log(`  ${bold("Links:")}`);
          for (const link of detail.links) log(`    ${dim(link.type + ":")} ${link.url}`);
        }
        if (detail.text_body) {
          log(`  ${bold("Body:")}    ${detail.text_body.slice(0, 200)}${detail.text_body.length > 200 ? dim("...") : ""}`);
        }
        log("");
      }
    } catch (err) {
      if (err instanceof PostMXApiError) error(`API error: ${err.code} — ${err.message} (status ${err.status})`);
      if (err instanceof PostMXNetworkError) {
        process.stderr.write(`${yellow("warn:")} Network error, retrying... (${(err.cause as Error).message})\n`);
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function cmdInboxes(client: PostMX, _args: ParsedArgs): Promise<void> {
  const limit = _args.flags["limit"] ? Number(_args.flags["limit"]) : undefined;
  const cursor = _args.flags["cursor"] as string | undefined;
  const { inboxes, pageInfo } = await client.listInboxes({ limit, cursor });

  if (inboxes.length === 0) { log(dim("No active inboxes.")); return; }

  for (const inbox of inboxes) {
    const ttl = inbox.ttl_minutes ? ` ${dim(`ttl=${inbox.ttl_minutes}m`)}` : "";
    const lastMsg = inbox.last_message_received_at ? ` ${dim(`last_msg=${inbox.last_message_received_at}`)}` : "";
    log(`${bold(inbox.id)}  ${cyan(inbox.email_address)}  ${inbox.label}  ${yellow(inbox.lifecycle_mode)}${ttl}${lastMsg}`);
  }

  if (pageInfo.has_more) log(dim(`\n  More inboxes available (cursor: ${pageInfo.next_cursor})`));
}

async function cmdInboxCreate(client: PostMX, args: ParsedArgs): Promise<void> {
  const label = args.flags["label"] as string;
  if (!label) error("Usage: postmx inbox create --label <label> [--mode temporary|persistent] [--ttl <minutes>]");

  const mode = (args.flags["mode"] as string) ?? "temporary";
  if (mode !== "temporary" && mode !== "persistent") error("--mode must be 'temporary' or 'persistent'");

  const ttl = args.flags["ttl"] ? Number(args.flags["ttl"]) : undefined;
  const inbox = await client.createInbox({ label, lifecycle_mode: mode, ...(ttl !== undefined ? { ttl_minutes: ttl } : {}) });

  log(bold("Inbox created"));
  log(`  ${bold("ID:")}    ${inbox.id}`);
  log(`  ${bold("Email:")} ${cyan(inbox.email_address)}`);
  log(`  ${bold("Mode:")}  ${inbox.lifecycle_mode}`);
  if (inbox.ttl_minutes) log(`  ${bold("TTL:")}   ${inbox.ttl_minutes} min`);
  if (inbox.expires_at) log(`  ${bold("Exp:")}   ${inbox.expires_at}`);
}

async function cmdInboxList(client: PostMX, args: ParsedArgs): Promise<void> {
  const inboxId = args.positional[0];
  if (!inboxId) error("Usage: postmx inbox list <inbox_id> [--limit <n>]");

  const limit = args.flags["limit"] ? Number(args.flags["limit"]) : undefined;
  const { messages, pageInfo } = await client.listMessages(inboxId, { limit });

  if (messages.length === 0) { log(dim("No messages found.")); return; }

  for (const msg of messages) {
    log(`${bold(msg.id)}  ${msg.from_email}  ${msg.subject ?? dim("(no subject)")}  ${dim(msg.received_at)}`);
  }

  if (pageInfo.has_more) log(dim(`\n  More messages available (cursor: ${pageInfo.next_cursor})`));
}

async function cmdMessagesList(client: PostMX, args: ParsedArgs): Promise<void> {
  const recipientEmail = args.flags["recipient-email"] as string | undefined;
  if (!recipientEmail) error("Usage: postmx messages list --recipient-email <email> [--limit <n>] [--cursor <cursor>]");

  const limit = args.flags["limit"] ? Number(args.flags["limit"]) : undefined;
  const cursor = args.flags["cursor"] as string | undefined;
  const { messages, pageInfo } = await listMessagesByRecipientCompat(client, recipientEmail, { limit, cursor });

  if (messages.length === 0) { log(dim("No messages found.")); return; }

  for (const msg of messages) {
    log(`${bold(String(msg.id ?? ""))}  ${String(msg.from_email ?? "")}  ${String(msg.to_email ?? "")}  ${String(msg.subject ?? "(no subject)")}  ${dim(String(msg.received_at ?? ""))}`);
  }

  if (pageInfo.has_more) log(dim(`\n  More messages available (cursor: ${pageInfo.next_cursor})`));
}

async function cmdMessageGet(client: PostMX, args: ParsedArgs): Promise<void> {
  const messageId = args.positional[0];
  if (!messageId) error("Usage: postmx message get <message_id> [--content-mode full|otp|links|text_only]");

  const contentMode = args.flags["content-mode"] as string | undefined;
  const validModes = ["full", "otp", "links", "text_only"];
  if (contentMode && !validModes.includes(contentMode)) error(`--content-mode must be one of: ${validModes.join(", ")}`);

  const msg = await client.getMessage(messageId, contentMode as any) as any;

  if (contentMode === "otp") { log(msg.otp ?? dim("(no OTP found)")); return; }
  if (contentMode === "links") {
    const links = msg.links ?? [];
    if (links.length === 0) log(dim("(no links found)"));
    else for (const l of links) log(`${dim(l.type + ":")} ${l.url}`);
    return;
  }
  if (contentMode === "text_only") { log(msg.text_body ?? dim("(no text body)")); return; }

  log(bold("── Message ─────────────────────────────────"));
  log(`  ${bold("ID:")}      ${msg.id}`);
  log(`  ${bold("Inbox:")}   ${msg.inbox_id} (${msg.inbox_email_address})`);
  log(`  ${bold("From:")}    ${msg.from_email}`);
  log(`  ${bold("To:")}      ${msg.to_email}`);
  log(`  ${bold("Subject:")} ${msg.subject ?? dim("(none)")}`);
  log(`  ${bold("Time:")}    ${msg.received_at}`);
  if (msg.otp) log(`  ${bold("OTP:")}     ${green(msg.otp)}`);
  if (msg.intent) log(`  ${bold("Intent:")}  ${yellow(msg.intent)}`);
  if (msg.links?.length > 0) {
    log(`  ${bold("Links:")}`);
    for (const link of msg.links) log(`    ${dim(link.type + ":")} ${link.url}`);
  }
  if (msg.text_body) log(`\n${msg.text_body}`);
}

// ── Interactive TUI ─────────────────────────────────────────────────

interface TUI {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  cols: number;
  rows: number;
}

function setupTUI(): TUI {
  const stdin = process.stdin;
  const stdout = process.stdout;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdout.write("\x1b[?1049h\x1b[?25l"); // alt screen + hide cursor
  return { stdin, stdout, cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
}

function teardownTUI(tui: TUI): void {
  tui.stdout.write("\x1b[?25h\x1b[?1049l"); // show cursor + restore main screen
  tui.stdin.setRawMode(false);
  tui.stdin.pause();
  tui.stdin.removeAllListeners("data");
}

function clear(tui: TUI): void {
  tui.stdout.write("\x1b[H");
  for (let i = 0; i < tui.rows; i++) {
    tui.stdout.write("\x1b[K" + (i < tui.rows - 1 ? "\n" : ""));
  }
  tui.stdout.write("\x1b[H");
}

function readKey(tui: TUI): Promise<string> {
  return new Promise((resolve) => { tui.stdin.once("data", resolve); });
}

function drawPicker(tui: TUI, title: string, items: string[], cur: number, hint: string): void {
  clear(tui);
  const w = tui.stdout.write.bind(tui.stdout);
  w(`\n  ${bold(title)}\n`);
  w(`  ${dim("─".repeat(Math.min(tui.cols - 4, 60)))}\n`);

  const maxVisible = Math.max(tui.rows - 7, 3);
  const total = items.length;
  let start = 0;
  if (total > maxVisible) {
    start = Math.max(0, Math.min(cur - Math.floor(maxVisible / 2), total - maxVisible));
  }
  const end = Math.min(start + maxVisible, total);

  if (start > 0) w(`  ${dim(`  ↑ ${start} more`)}\n`);
  else w("\n");

  for (let i = start; i < end; i++) {
    const active = i === cur;
    const pointer = active ? `  ${cyan("▸")} ` : "    ";
    const line = active ? bold(items[i]) : dim(items[i]);
    w(`${pointer}${line}\x1b[K\n`);
  }

  if (end < total) w(`  ${dim(`  ↓ ${total - end} more`)}\n`);
  else w("\n");

  w(`\n  ${dim(hint)}\n`);
}

async function pick(tui: TUI, title: string, items: string[], hint = "↑↓ · ↵ open · esc back · q quit"): Promise<number> {
  if (items.length === 0) {
    clear(tui);
    tui.stdout.write(`${bold(title)}\n\n  ${dim("(empty)")}\n\n  ${dim("Press any key")}\n`);
    await readKey(tui);
    return -1;
  }

  let cur = 0;
  drawPicker(tui, title, items, cur, hint);

  while (true) {
    const key = await readKey(tui);
    if (key === "\x03" || key === "q") return -2;
    if (key === "\x1b" || key === "\x1b[D" || key === "b") return -1;
    if (key === "\x1b[A" || key === "k") cur = Math.max(0, cur - 1);
    else if (key === "\x1b[B" || key === "j") cur = Math.min(items.length - 1, cur + 1);
    else if (key === "\r" || key === "\n") return cur;
    drawPicker(tui, title, items, cur, hint);
  }
}

async function showDetail(tui: TUI, lines: string[]): Promise<boolean> {
  let scroll = 0;
  const draw = () => {
    clear(tui);
    const maxLines = tui.rows - 1;
    const end = Math.min(scroll + maxLines, lines.length);
    for (let i = scroll; i < end; i++) tui.stdout.write(lines[i] + "\x1b[K\n");
    if (end < lines.length) tui.stdout.write(dim("  ↓ scroll"));
  };
  draw();

  while (true) {
    const key = await readKey(tui);
    if (key === "\x03" || key === "q") return false;
    if (key === "\x1b" || key === "\x1b[D" || key === "b" || key === "\r") return true;
    if ((key === "\x1b[B" || key === "j") && scroll + tui.rows - 1 < lines.length) { scroll++; draw(); }
    else if ((key === "\x1b[A" || key === "k") && scroll > 0) { scroll--; draw(); }
  }
}

function fmtMessageDetail(msg: Record<string, unknown>, cols: number): string[] {
  const w = Math.max(cols - 4, 30);
  const lines: string[] = [
    `${bold("Message")}  ${dim("esc back · ↑↓ scroll · q quit")}`,
    "",
    `  ${bold("ID")}       ${msg.id}`,
    `  ${bold("From")}     ${trunc(String(msg.from_email ?? ""), w - 12)}`,
    `  ${bold("To")}       ${trunc(String(msg.to_email ?? ""), w - 12)}`,
    `  ${bold("Subject")}  ${trunc(String(msg.subject ?? "(none)"), w - 12)}`,
    `  ${bold("Time")}     ${msg.received_at}`,
  ];
  if (msg.otp) lines.push(`  ${bold("OTP")}      ${green(String(msg.otp))}`);
  if (msg.intent) lines.push(`  ${bold("Intent")}   ${yellow(String(msg.intent))}`);
  const links = msg.links as Array<{ url: string; type: string }> | undefined;
  if (links && links.length > 0) {
    lines.push("", `  ${bold("Links")}`);
    for (const l of links) lines.push(`    ${dim(l.type)}  ${trunc(l.url, w - 6)}`);
  }
  if (msg.text_body) {
    lines.push("", `  ${bold("Body")}`);
    for (const bl of String(msg.text_body).split("\n")) {
      if (bl.length <= w - 4) lines.push(`    ${bl}`);
      else for (let i = 0; i < bl.length; i += w - 4) lines.push(`    ${bl.slice(i, i + w - 4)}`);
    }
  }
  return lines;
}

function fmtInboxDetail(inbox: Record<string, unknown>): string[] {
  const lines = [
    `${bold("Inbox")}  ${dim("esc back · q quit")}`,
    "",
    `  ${bold("ID")}       ${inbox.id}`,
    `  ${bold("Email")}    ${cyan(String(inbox.email_address))}`,
    `  ${bold("Label")}    ${inbox.label}`,
    `  ${bold("Mode")}     ${yellow(String(inbox.lifecycle_mode))}`,
  ];
  if (inbox.ttl_minutes) lines.push(`  ${bold("TTL")}      ${inbox.ttl_minutes}m`);
  if (inbox.expires_at) lines.push(`  ${bold("Expires")}  ${inbox.expires_at}`);
  lines.push(`  ${bold("Status")}   ${inbox.status}`);
  if (inbox.last_message_received_at) lines.push(`  ${bold("Last msg")} ${inbox.last_message_received_at}`);
  lines.push(`  ${bold("Created")}  ${inbox.created_at}`);
  return lines;
}

function fmtMessageRow(message: Record<string, unknown>, cols: number): string {
  const width = Math.max(cols - 8, 36);
  const time = String(message.received_at ?? "").replace("T", " ").slice(0, 16);
  const timeWidth = Math.min(16, Math.max(5, time.length));
  const fromWidth = Math.min(22, Math.max(12, Math.floor(width * 0.22)));
  const toWidth = Math.min(24, Math.max(14, Math.floor(width * 0.24)));
  const subjectWidth = Math.max(width - fromWidth - toWidth - timeWidth - 6, 12);
  const subject = String(message.subject ?? message.preview_text ?? "(no subject)");

  return [
    fit(String(message.from_email ?? ""), fromWidth),
    dim("→"),
    fit(String(message.to_email ?? ""), toWidth),
    fit(subject, subjectWidth),
    dim(trunc(time, timeWidth)),
  ].join(" ");
}

function keepSelection(messages: Array<Record<string, unknown>>, previousId: string | undefined, fallbackIndex: number): number {
  if (messages.length === 0) return 0;
  if (previousId) {
    const nextIndex = messages.findIndex((message) => String(message.id) === previousId);
    if (nextIndex >= 0) return nextIndex;
  }
  return Math.max(0, Math.min(fallbackIndex, messages.length - 1));
}

function drawMessageFeed(
  tui: TUI,
  title: string,
  subtitle: string,
  messages: Array<Record<string, unknown>>,
  selected: number,
  hint: string,
  options?: {
    status?: string;
    error?: string | null;
    emptyMessage?: string;
  },
): void {
  clear(tui);
  const write = tui.stdout.write.bind(tui.stdout);

  write(`\n  ${bold(title)}\n`);
  write(`  ${dim(subtitle)}\n`);
  if (options?.status) {
    write(`  ${dim(options.status)}\n`);
  } else if (options?.error) {
    write(`  ${red(options.error)}\n`);
  } else {
    write("\n");
  }
  write(`  ${dim("─".repeat(Math.min(tui.cols - 4, 72)))}\n`);

  if (messages.length === 0) {
    write(`\n  ${dim(options?.emptyMessage ?? "No messages yet.")}\n`);
    if (options?.error) write(`  ${red(options.error)}\n`);
    write(`\n  ${dim(hint)}\n`);
    return;
  }

  const maxVisible = Math.max(tui.rows - 9, 3);
  const total = messages.length;
  const start = total > maxVisible
    ? Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), total - maxVisible))
    : 0;
  const end = Math.min(start + maxVisible, total);

  if (start > 0) write(`  ${dim(`↑ ${start} earlier messages`)}` + "\n");
  else write("\n");

  for (let index = start; index < end; index++) {
    const active = index === selected;
    const pointer = active ? `  ${cyan("▸")} ` : "    ";
    const row = fmtMessageRow(messages[index], tui.cols);
    write(`${pointer}${active ? bold(row) : dim(row)}\x1b[K\n`);
  }

  if (end < total) write(`  ${dim(`↓ ${total - end} more messages`)}` + "\n");
  else write("\n");

  if (options?.error) write(`  ${red(options.error)}\n`);
  write(`  ${dim(hint)}\n`);
}

function readKeyWithTimeout(tui: TUI, timeoutMs?: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      tui.stdin.removeListener("data", onData);
      if (timer) clearTimeout(timer);
    };

    const onData = (data: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    tui.stdin.on("data", onData);

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, timeoutMs);
    }
  });
}

async function openSelectedMessage(
  tui: TUI,
  client: PostMX,
  messages: Array<Record<string, unknown>>,
  selected: number,
): Promise<boolean> {
  const message = messages[selected];
  if (!message) return true;

  clear(tui);
  tui.stdout.write(dim("  Loading message detail..."));

  try {
    const detail = await client.getMessage(String(message.id)) as unknown as Record<string, unknown>;
    return await showDetail(tui, fmtMessageDetail(detail, tui.cols));
  } catch (err) {
    clear(tui);
    tui.stdout.write(`${red("Error:")} ${err instanceof Error ? err.message : String(err)}\n\n  ${dim("Press any key")}\n`);
    await readKey(tui);
    return true;
  }
}

async function browseMessageFeed(
  tui: TUI,
  client: PostMX,
  options: {
    title: string;
    subtitle: string;
    emptyMessage: string;
    load: () => Promise<Array<Record<string, unknown>>>;
  },
): Promise<boolean> {
  let messages: Array<Record<string, unknown>> = [];
  let selected = 0;
  let errorMessage: string | null = null;
  let status = "Loading messages...";

  const refresh = async () => {
    const previousId = messages[selected] ? String(messages[selected].id) : undefined;
    try {
      const nextMessages = await options.load();
      messages = nextMessages;
      selected = keepSelection(messages, previousId, selected);
      errorMessage = null;
      status = `${messages.length} message${messages.length === 1 ? "" : "s"} loaded · press r to refresh`;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = "Unable to refresh right now";
    }
  };

  await refresh();

  while (true) {
    drawMessageFeed(
      tui,
      options.title,
      options.subtitle,
      messages,
      selected,
      "↑↓ move · ↵ details · r refresh · esc back · q quit",
      { status, error: errorMessage, emptyMessage: options.emptyMessage },
    );

    const key = await readKey(tui);
    if (key === "\x03" || key === "q") return false;
    if (key === "\x1b" || key === "\x1b[D" || key === "b") return true;
    if (key === "r") {
      status = "Refreshing...";
      await refresh();
      continue;
    }
    if (key === "\x1b[A" || key === "k") {
      selected = Math.max(0, selected - 1);
      continue;
    }
    if (key === "\x1b[B" || key === "j") {
      selected = Math.min(Math.max(messages.length - 1, 0), selected + 1);
      continue;
    }
    if ((key === "\r" || key === "\n") && messages.length > 0) {
      const cont = await openSelectedMessage(tui, client, messages, selected);
      if (!cont) return false;
    }
  }
}

async function recipientLookupScreen(tui: TUI, client: PostMX): Promise<boolean> {
  clear(tui);
  tui.stdout.write(`${bold("Find recipient email")}\n\n`);
  const recipientEmail = await tuiPrompt(tui, "  Exact recipient email: ");
  if (recipientEmail === null) return true;

  const normalized = recipientEmail.trim();
  if (!normalized) return true;

  return browseMessageFeed(tui, client, {
    title: "Emails for address",
    subtitle: normalized,
    emptyMessage: "No messages found for that recipient email.",
    load: async () => {
      const result = await listMessagesByRecipientCompat(client, normalized, { limit: 50 });
      return result.messages as unknown as Array<Record<string, unknown>>;
    },
  });
}

async function interactiveMode(client: PostMX): Promise<void> {
  const tui = setupTUI();
  process.stdout.on("resize", () => {
    tui.cols = process.stdout.columns ?? 80;
    tui.rows = process.stdout.rows ?? 24;
  });

  try {
    await mainMenu(tui, client);
  } finally {
    clear(tui);
    teardownTUI(tui);
  }
}

async function mainMenu(tui: TUI, client: PostMX): Promise<void> {
  const items = ["Inboxes", "Find Emails By Address", "Create inbox", "Webhooks"];

  while (true) {
    const idx = await pick(tui, "postmx", items, "↑↓ · ↵ select · q quit");
    if (idx === -2 || idx === -1) return;

    if (idx === 0) { if (!await inboxesScreen(tui, client)) return; }
    else if (idx === 1) { if (!await recipientLookupScreen(tui, client)) return; }
    else if (idx === 2) { if (!await createInboxScreen(tui, client)) return; }
    else if (idx === 3) { if (!await webhooksScreen(tui, client)) return; }
  }
}

async function inboxesScreen(tui: TUI, client: PostMX): Promise<boolean> {
  clear(tui);
  tui.stdout.write(dim("  Loading inboxes..."));

  let inboxes: any[];
  let wildcard: { email_address: string; inbox_id: string } | null = null;
  try {
    const result = await client.listInboxes({ limit: 50 });
    inboxes = result.inboxes as any[];
    wildcard = result.wildcard_address ?? null;
  } catch (err) {
    clear(tui);
    tui.stdout.write(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : String(err)}\n\n  ${dim("Press any key")}\n`);
    await readKey(tui);
    return true;
  }

  const items: string[] = [];
  if (wildcard) {
    items.push(`\x1b[33m★\x1b[0m ${dim("wildcard")}  \x1b[36m${wildcard.email_address}\x1b[0m`);
  }
  for (const ib of inboxes) {
    const label = fit(ib.label ?? "", 16);
    const email = trunc(ib.email_address, Math.max(tui.cols - 24, 20));
    items.push(`${label} ${dim(email)}`);
  }

  const wildcardOffset = wildcard ? 1 : 0;

  while (true) {
    const idx = await pick(tui, "Inboxes", items);
    if (idx === -2) return false;
    if (idx === -1) return true;

    if (wildcard && idx === 0) {
      const wildcardInbox = {
        id: wildcard.inbox_id,
        label: "Wildcard",
        email_address: wildcard.email_address,
      };
      if (!await inboxActionScreen(tui, client, wildcardInbox)) return false;
      continue;
    }

    if (!await inboxActionScreen(tui, client, inboxes[idx - wildcardOffset])) return false;
  }
}

async function inboxActionScreen(tui: TUI, client: PostMX, inbox: any): Promise<boolean> {
  const label = inbox.label ?? inbox.id;
  const actions = ["Messages", "Details", "Watch (live poll)"];

  while (true) {
    const idx = await pick(tui, label, actions);
    if (idx === -2) return false;
    if (idx === -1) return true;

    if (idx === 0) { if (!await messagesScreen(tui, client, inbox.id, label)) return false; }
    else if (idx === 1) { if (!await showDetail(tui, fmtInboxDetail(inbox))) return false; }
    else if (idx === 2) { if (!await watchScreen(tui, client, inbox.id, label)) return false; }
  }
}

async function messagesScreen(tui: TUI, client: PostMX, inboxId: string, label: string): Promise<boolean> {
  return browseMessageFeed(tui, client, {
    title: label,
    subtitle: "Inbox messages",
    emptyMessage: "No messages yet in this inbox.",
    load: async () => {
      const result = await client.listMessages(inboxId, { limit: 50 });
      return result.messages as unknown as Array<Record<string, unknown>>;
    },
  });
}

async function watchScreen(tui: TUI, client: PostMX, inboxId: string, label: string): Promise<boolean> {
  let messages: Array<Record<string, unknown>> = [];
  let selected = 0;
  let errorMessage: string | null = null;
  let paused = false;
  let lastUpdated = "Not refreshed yet";
  let newCount = 0;
  let initialized = false;
  const knownIds = new Set<string>();
  let nextPollAt = 0;

  const refresh = async () => {
    const previousId = messages[selected] ? String(messages[selected].id) : undefined;
    try {
      const result = await client.listMessages(inboxId, { limit: 50 });
      const nextMessages = result.messages as unknown as Array<Record<string, unknown>>;
      if (!initialized) {
        for (const message of nextMessages) knownIds.add(String(message.id));
        newCount = 0;
      } else {
        newCount = nextMessages.filter((message) => !knownIds.has(String(message.id))).length;
        for (const message of nextMessages) knownIds.add(String(message.id));
      }
      messages = nextMessages;
      selected = keepSelection(messages, previousId, selected);
      errorMessage = null;
      initialized = true;
      lastUpdated = new Date().toLocaleTimeString();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  };

  await refresh();
  nextPollAt = Date.now() + 2000;

  while (true) {
    const mode = paused ? yellow("paused") : green("live");
    const status = `${mode} · ${messages.length} message${messages.length === 1 ? "" : "s"} · ${newCount} new · refreshed ${lastUpdated}`;
    drawMessageFeed(
      tui,
      `${label} · watch`,
      "Live inbox polling",
      messages,
      selected,
      "↑↓ move · ↵ details · space pause · r refresh · esc back · q quit",
      { status, error: errorMessage, emptyMessage: "Waiting for messages..." },
    );

    const waitMs = paused ? undefined : Math.max(0, nextPollAt - Date.now());
    const key = await readKeyWithTimeout(tui, waitMs);

    if (key === null) {
      await refresh();
      nextPollAt = Date.now() + 2000;
      continue;
    }
    if (key === "\x03" || key === "q") return false;
    if (key === "\x1b" || key === "\x1b[D" || key === "b") return true;
    if (key === " ") {
      paused = !paused;
      if (!paused) nextPollAt = Date.now() + 2000;
      continue;
    }
    if (key === "r") {
      await refresh();
      nextPollAt = Date.now() + 2000;
      continue;
    }
    if (key === "\x1b[A" || key === "k") {
      selected = Math.max(0, selected - 1);
      continue;
    }
    if (key === "\x1b[B" || key === "j") {
      selected = Math.min(Math.max(messages.length - 1, 0), selected + 1);
      continue;
    }
    if ((key === "\r" || key === "\n") && messages.length > 0) {
      const cont = await openSelectedMessage(tui, client, messages, selected);
      if (!cont) return false;
    }
  }
}

async function createInboxScreen(tui: TUI, client: PostMX): Promise<boolean> {
  clear(tui);
  tui.stdout.write(`${bold("Create inbox")}\n\n`);

  const label = await tuiPrompt(tui, "  Label: ");
  if (label === null) return true;

  const modes = ["temporary", "persistent"];
  tui.stdout.write("\n");
  const modeIdx = await pick(tui, "Lifecycle", modes, "↑↓ · ↵ select · esc cancel");
  if (modeIdx === -2) return false;
  if (modeIdx === -1) return true;
  const mode = modes[modeIdx] as "temporary" | "persistent";

  let ttl: number | undefined;
  if (mode === "temporary") {
    clear(tui);
    tui.stdout.write(`${bold("Create inbox")}  ${dim(label)} · ${dim(mode)}\n\n`);
    const ttlStr = await tuiPrompt(tui, "  TTL (minutes, empty=default): ");
    if (ttlStr === null) return true;
    if (ttlStr) ttl = parseInt(ttlStr, 10);
  }

  clear(tui);
  tui.stdout.write(dim("  Creating inbox..."));

  try {
    const inbox = await client.createInbox({ label, lifecycle_mode: mode, ttl_minutes: ttl });
    const lines = [
      `${bold("Inbox created")}  ${dim("esc back · q quit")}`, "",
      `  ${bold("ID")}       ${inbox.id}`,
      `  ${bold("Email")}    ${cyan(inbox.email_address)}`,
      `  ${bold("Mode")}     ${yellow(inbox.lifecycle_mode)}`,
    ];
    if (inbox.ttl_minutes) lines.push(`  ${bold("TTL")}      ${inbox.ttl_minutes}m`);
    if (inbox.expires_at) lines.push(`  ${bold("Expires")}  ${inbox.expires_at}`);
    return await showDetail(tui, lines);
  } catch (err) {
    clear(tui);
    tui.stdout.write(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : String(err)}\n\n  ${dim("Press any key")}\n`);
    await readKey(tui);
    return true;
  }
}

async function webhooksScreen(tui: TUI, _client: PostMX): Promise<boolean> {
  clear(tui);
  tui.stdout.write(dim("  Webhooks not yet browsable — coming soon.\n\n  Press any key."));
  await readKey(tui);
  return true;
}

async function tuiPrompt(tui: TUI, label: string): Promise<string | null> {
  tui.stdout.write("\x1b[?25h"); // show cursor
  tui.stdout.write(label);
  let buf = "";

  while (true) {
    const key = await readKey(tui);
    if (key === "\x03" || key === "\x1b") { tui.stdout.write("\x1b[?25l"); return null; }
    if (key === "\r" || key === "\n") { tui.stdout.write("\n\x1b[?25l"); return buf; }
    if (key === "\x7f" || key === "\b") {
      if (buf.length > 0) { buf = buf.slice(0, -1); tui.stdout.write("\b \b"); }
      continue;
    }
    if (key.length === 1 && key.charCodeAt(0) >= 32) { buf += key; tui.stdout.write(key); }
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.flags["version"]) { log(VERSION); return; }
  if (args.flags["help"]) { printHelp(); return; }

  // Interactive mode
  if (args.flags["interactive"] === true) {
    const apiKey = resolveApiKey(args.flags);
    if (!apiKey) error("Missing API key. Pass --api-key, set POSTMX_API_KEY, or run `postmx auth login --api-key <key>`.");
    const baseUrl = resolveBaseUrl(args.flags);
    const client = new PostMX(apiKey, { baseUrl });
    const metadataClient = client as unknown as Record<string, unknown>;
    metadataClient["apiKey"] = apiKey;
    metadataClient["baseUrl"] = baseUrl;
    await interactiveMode(client);
    return;
  }

  // No command → interactive if TTY, help otherwise
  if (!args.command) {
    if (process.stdout.isTTY && process.stdin.isTTY) {
      const apiKey = resolveApiKey(args.flags);
      if (!apiKey) error("Missing API key. Pass --api-key, set POSTMX_API_KEY, or run `postmx auth login --api-key <key>`.");
      const baseUrl = resolveBaseUrl(args.flags);
      const client = new PostMX(apiKey, { baseUrl });
      const metadataClient = client as unknown as Record<string, unknown>;
      metadataClient["apiKey"] = apiKey;
      metadataClient["baseUrl"] = baseUrl;
      await interactiveMode(client);
    } else {
      printHelp();
    }
    return;
  }

  if (args.command === "auth") {
    const sub = args.positional[0];
    const subArgs = { ...args, positional: args.positional.slice(1) };
    if (sub === "login") await cmdAuthLogin(subArgs);
    else if (sub === "logout") await cmdAuthLogout();
    else error(`Unknown auth command: ${sub}. Try: login, logout`);
    return;
  }

  const apiKey = resolveApiKey(args.flags);
  if (!apiKey) error("Missing API key. Pass --api-key, set POSTMX_API_KEY, or run `postmx auth login --api-key <key>`.");
  const baseUrl = resolveBaseUrl(args.flags);
  if (typeof args.flags["api-key"] === "string") {
    try {
      writeCliConfig({ ...readCliConfig(), apiKey });
    } catch (err) {
      process.stderr.write(`${dim(`warn: could not save API key locally (${err instanceof Error ? err.message : String(err)})`)}\n`);
    }
  }
  const client = new PostMX(apiKey, { baseUrl });
  const metadataClient = client as unknown as Record<string, unknown>;
  metadataClient["apiKey"] = apiKey;
  metadataClient["baseUrl"] = baseUrl;

  try {
    switch (args.command) {
      case "watch":
        await cmdWatch(client, args);
        break;
      case "inboxes":
        await cmdInboxes(client, args);
        break;
      case "inbox": {
        const sub = args.positional[0];
        const subArgs = { ...args, positional: args.positional.slice(1) };
        if (sub === "create") await cmdInboxCreate(client, subArgs);
        else if (sub === "list") await cmdInboxList(client, subArgs);
        else error(`Unknown inbox command: ${sub}. Try: create, list`);
        break;
      }
      case "messages": {
        const sub = args.positional[0];
        const subArgs = { ...args, positional: args.positional.slice(1) };
        if (sub === "list") await cmdMessagesList(client, subArgs);
        else error(`Unknown messages command: ${sub}. Try: list`);
        break;
      }
      case "message": {
        const sub = args.positional[0];
        const subArgs = { ...args, positional: args.positional.slice(1) };
        if (sub === "get") await cmdMessageGet(client, subArgs);
        else error(`Unknown message command: ${sub}. Try: get`);
        break;
      }
      default:
        error(`Unknown command: ${args.command}. Run 'postmx --help' for usage.`);
    }
  } catch (err) {
    if (err instanceof PostMXApiError) error(`${err.code} — ${err.message} (status ${err.status}, request_id: ${err.requestId ?? "unknown"})`);
    if (err instanceof PostMXNetworkError) error(`Network error: ${(err.cause as Error).message}`);
    if (err instanceof PostMXError) error(err.message);
    throw err;
  }
}

main();
