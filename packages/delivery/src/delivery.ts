import type {
  ButtonAction,
  CanonicalEvent,
  ChannelSender,
  OutboundAttachment,
  RichBlock,
  RichMessage,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { DeliveryResult, RetryConfig } from "./types";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export class DeliveryExhaustedError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Delivery failed after ${attempts} attempts: ${lastError.message}`);
    this.name = "DeliveryExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

function deriveEvent(
  source: CanonicalEvent,
  causationId: string,
  eventType: string,
  actorType: string,
  payload: Record<string, unknown>,
  providerExtensions?: Record<string, unknown>,
): CanonicalEvent {
  const event: CanonicalEvent = {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: eventType,
    tenant_id: source.tenant_id,
    workspace_id: source.workspace_id,
    channel: source.channel,
    channel_instance_id: source.channel_instance_id ?? source.channel,
    conversation_id: source.conversation_id,
    session_id: source.session_id,
    correlation_id: source.correlation_id,
    causation_id: causationId,
    occurred_at: new Date().toISOString(),
    actor_type: actorType,
    payload,
  };
  if (providerExtensions !== undefined) {
    event.provider_extensions = providerExtensions;
  }
  return event;
}

type ResolvedRetryConfig = { maxRetries: number; baseDelayMs: number };

function parseReactionHint(event: CanonicalEvent): { emoji: string; target_message_id: string } | undefined {
  const ext = event.provider_extensions;
  if (ext === undefined || typeof ext !== "object" || ext === null) return undefined;
  const reaction = (ext as Record<string, unknown>)["reaction"];
  if (reaction === undefined || typeof reaction !== "object" || reaction === null) return undefined;
  const r = reaction as Record<string, unknown>;
  const emoji = r["emoji"];
  const target_message_id = r["target_message_id"];
  if (typeof emoji !== "string" || typeof target_message_id !== "string") return undefined;
  if (emoji.length === 0 || target_message_id.length === 0) return undefined;
  return { emoji, target_message_id };
}

async function applyBestEffortReaction(sender: ChannelSender, agentResponse: CanonicalEvent): Promise<void> {
  const hint = parseReactionHint(agentResponse);
  if (hint === undefined || typeof sender.addReaction !== "function") return;
  try {
    await sender.addReaction(hint.target_message_id, hint.emoji);
  } catch {
    /* best-effort reaction egress */
  }
}

function filePartsAsOutboundAttachments(agentResponseCompleted: CanonicalEvent): OutboundAttachment[] {
  const ext = agentResponseCompleted.provider_extensions;
  if (ext === undefined || typeof ext !== "object" || ext === null || Array.isArray(ext)) return [];
  const artifacts = (ext as Record<string, unknown>)["artifacts"];
  if (!Array.isArray(artifacts)) return [];

  const out: OutboundAttachment[] = [];
  for (const art of artifacts) {
    if (art === undefined || typeof art !== "object" || art === null || Array.isArray(art)) continue;
    const parts = (art as Record<string, unknown>)["parts"];
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (p === undefined || typeof p !== "object" || p === null || Array.isArray(p)) continue;
      const rec = p as Record<string, unknown>;
      if (rec["kind"] !== "file") continue;
      const name = rec["name"];
      const mimeType = rec["mimeType"];
      if (typeof name !== "string" || typeof mimeType !== "string") continue;
      const uri = rec["uri"];
      const bytes = rec["bytes"];
      const hasUri = typeof uri === "string" && uri.length > 0;
      const hasBytes = typeof bytes === "string" && bytes.length > 0;
      if (!hasUri && !hasBytes) continue;
      const attachment: OutboundAttachment = { name, mimeType };
      if (hasUri) attachment.uri = uri;
      if (hasBytes) attachment.bytes = bytes;
      out.push(attachment);
    }
  }
  return out;
}

function parseRichBlocks(payload: Record<string, unknown>): RichBlock[] | undefined {
  const raw = payload["rich_blocks"];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const blocks: RichBlock[] = [];
  for (const item of raw) {
    if (item === undefined || typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const t = o["type"];
    if (t === "text" && typeof o["text"] === "string") {
      blocks.push({ type: "text", text: o["text"] });
    } else if (t === "code" && typeof o["text"] === "string") {
      blocks.push({
        type: "code",
        text: o["text"],
        ...(typeof o["language"] === "string" ? { language: o["language"] } : {}),
      });
    } else if (t === "header" && typeof o["text"] === "string") {
      blocks.push({ type: "header", text: o["text"] });
    } else if (t === "divider") {
      blocks.push({ type: "divider" });
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}

async function deliverRichMessageBestEffort(
  sender: ChannelSender,
  agentResponseCompleted: CanonicalEvent,
  fallbackText: string,
): Promise<void> {
  if (typeof sender.sendRichMessage !== "function") return;
  const blocks = parseRichBlocks(agentResponseCompleted.payload as Record<string, unknown>);
  if (blocks === undefined) return;
  const message: RichMessage = { blocks, fallbackText };
  try {
    await sender.sendRichMessage(message);
  } catch {
    /* best-effort rich egress */
  }
}

function parseButtonsFromPayload(payload: Record<string, unknown>): ButtonAction[] | undefined {
  const raw = payload["buttons"];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ButtonAction[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o["id"] !== "string" || typeof o["label"] !== "string") continue;
    if (o["id"].length === 0 || o["label"].length === 0) continue;
    const b: ButtonAction = { id: o["id"], label: o["label"] };
    if (o["style"] === "primary" || o["style"] === "secondary" || o["style"] === "danger") {
      b.style = o["style"];
    }
    if (typeof o["value"] === "string" && o["value"].length > 0) {
      b.value = o["value"];
    }
    out.push(b);
  }
  return out.length > 0 ? out : undefined;
}

async function deliverAttachmentsBestEffort(sender: ChannelSender, agentResponseCompleted: CanonicalEvent): Promise<void> {
  if (typeof sender.sendAttachment !== "function") return;
  const attachments = filePartsAsOutboundAttachments(agentResponseCompleted);
  for (const attachment of attachments) {
    try {
      await sender.sendAttachment(attachment);
    } catch {
      /* best-effort attachment egress */
    }
  }
}

export class DeliveryOrchestrator {
  private readonly retryConfig: ResolvedRetryConfig;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    retryConfig?: RetryConfig,
  ) {
    this.retryConfig = {
      maxRetries: retryConfig?.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: retryConfig?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    };
  }

  static async create(retryConfig?: RetryConfig): Promise<DeliveryOrchestrator> {
    const validators = await ContractHarnessValidators.getShared();
    return new DeliveryOrchestrator(validators, retryConfig);
  }

  async deliver(agentResponseCompleted: CanonicalEvent, sender: ChannelSender): Promise<DeliveryResult> {
    if (agentResponseCompleted.event_type !== "agent.response.completed") {
      throw new Error(`Expected agent.response.completed, got ${agentResponseCompleted.event_type}`);
    }

    const responseText = agentResponseCompleted.payload["text"];
    if (typeof responseText !== "string") {
      throw new Error("agent.response.completed payload must contain text");
    }

    const payloadRecord = agentResponseCompleted.payload as Record<string, unknown>;
    const buttons = parseButtonsFromPayload(payloadRecord);
    const useButtons = buttons !== undefined && typeof sender.sendButtons === "function";

    const sendRequestedPayload: Record<string, unknown> = { text: responseText };
    if (useButtons && buttons !== undefined) {
      sendRequestedPayload["buttons"] = buttons;
    }

    const sendRequestedEvent = deriveEvent(
      agentResponseCompleted,
      agentResponseCompleted.event_id,
      "message.send.requested",
      "system",
      sendRequestedPayload,
    );
    this.assertValid(sendRequestedEvent);

    const sendResult = useButtons
      ? await this.sendButtonsWithRetry(sender, responseText, buttons!)
      : await this.sendWithRetry(sender, responseText);

    await deliverRichMessageBestEffort(sender, agentResponseCompleted, responseText);

    await deliverAttachmentsBestEffort(sender, agentResponseCompleted);

    await applyBestEffortReaction(sender, agentResponseCompleted);

    const sentEvent = deriveEvent(
      agentResponseCompleted,
      sendRequestedEvent.event_id,
      "message.sent",
      "channel_adapter",
      { provider_message_id: sendResult.providerMessageId },
      { webchat: { delivery_status: "sent" } },
    );
    this.assertValid(sentEvent);

    return {
      sendRequestedEvent,
      sentEvent,
      providerMessageId: sendResult.providerMessageId,
    };
  }

  private async sendButtonsWithRetry(
    sender: ChannelSender,
    text: string,
    buttons: ButtonAction[],
  ): Promise<{ providerMessageId: string }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await sender.sendButtons!(text, buttons);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.retryConfig.baseDelayMs * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new DeliveryExhaustedError(this.retryConfig.maxRetries + 1, lastError!);
  }

  private async sendWithRetry(sender: ChannelSender, text: string): Promise<{ providerMessageId: string }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await sender.send(text);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.retryConfig.baseDelayMs * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new DeliveryExhaustedError(this.retryConfig.maxRetries + 1, lastError!);
  }

  private assertValid(event: CanonicalEvent): void {
    const result: ValidationResult = this.validators.validateEvent(event);
    if (!result.ok) {
      const details = result.failure.issues.map((i) => i.message).join("; ");
      throw new Error(`Delivery produced invalid ${event.event_type}: ${details}`);
    }
  }
}
