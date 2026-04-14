import type {
  ButtonAction,
  CanonicalEvent,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { createTeamsSender } from "./teams-sender";
import type { CanonicalizationResult, IngressError, TeamsActivity } from "./types";

export class TeamsIngress implements ChannelAdapter {
  readonly channelType = "teams" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly teamsTenantId: string,
    private readonly tenantId: string,
    private readonly workspaceId: string,
  ) {}

  static async create(
    appId: string,
    appSecret: string,
    teamsTenantId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<TeamsIngress> {
    const validators = await ContractHarnessValidators.getShared();
    return new TeamsIngress(validators, appId, appSecret, teamsTenantId, tenantId, workspaceId);
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "teams",
      messaging: { text: true, attachments: false, reactions: false, threads: true },
      streaming: { progressiveUpdate: true, nativeStreaming: false },
      interactive: { buttons: true, menus: false, commands: false },
      delivery: { retry: true, chunking: false, edit: true },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const sender = createTeamsSender(this.appId, this.appSecret, this.teamsTenantId);
    const ref = extractConversationReference(event);
    return {
      send: (text: string) =>
        sender.sendMessage(ref, text).then((result) => ({ providerMessageId: result.messageId })),
      sendRichMessage: (message) =>
        sender.sendRichMessage(ref, message).then((result) => ({ providerMessageId: result.messageId })),
      sendButtons: (text: string, buttons: ButtonAction[]) =>
        sender.sendButtons(ref, text, buttons).then((result) => ({ providerMessageId: result.messageId })),
      edit: (providerMessageId: string, text: string) => sender.editMessage(ref, providerMessageId, text),
    };
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    const activityResult = validateTeamsActivity(raw);
    if (!activityResult.ok) {
      return { ok: false, error: activityResult.error };
    }

    const activity = activityResult.activity;
    const text = stripBotMentions(activity.text ?? "").trim();
    if (!text) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Teams activity text is empty after mention stripping" },
      };
    }

    const conversationId = activity.conversation!.id;
    const serviceUrl = activity.serviceUrl!;
    const providerTenantId = activity.channelData?.tenant?.id ?? activity.conversation?.tenantId;
    const providerChannelId = activity.channelData?.teamsChannelId;
    const fromId = activity.from!.id;
    const occurredAt = activity.timestamp ?? new Date().toISOString();

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "teams",
      channel_instance_id: providerChannelId ? `teams-${providerChannelId}` : `teams-${conversationId}`,
      conversation_id: conversationId,
      session_id: conversationId,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: occurredAt,
      actor_type: "end_user",
      actor: {
        id: fromId,
        ...(activity.from?.name ? { display_name: activity.from.name } : {}),
      },
      identity_refs: { channel_user_id: fromId },
      payload: { text },
      provider_extensions: {
        teams: {
          activity_id: activity.id,
          service_url: serviceUrl,
          conversation_id: conversationId,
          tenant_id: providerTenantId,
          channel_id: activity.channelId,
          teams_channel_id: providerChannelId,
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Teams event failed validation: ${validation.failure.issues.map((issue) => issue.message).join("; ")}`,
        },
      };
    }

    return {
      ok: true,
      event,
      idempotencyKey: `teams:${conversationId}:${activity.id ?? occurredAt}`,
    };
  }
}

type ActivityValidationSuccess = { ok: true; activity: TeamsActivity };
type ActivityValidationFailure = { ok: false; error: IngressError };

function validateTeamsActivity(raw: unknown): ActivityValidationSuccess | ActivityValidationFailure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: "invalid_payload", message: "Request body must be a non-null object" } };
  }

  const activity = raw as TeamsActivity;
  if (activity.type !== "message") {
    return {
      ok: false,
      error: { code: "unsupported_activity", message: "Only Teams message activities are supported" },
    };
  }
  if (typeof activity.serviceUrl !== "string" || !activity.serviceUrl) {
    return { ok: false, error: { code: "missing_field", field: "serviceUrl", message: "serviceUrl is required" } };
  }
  if (typeof activity.conversation?.id !== "string" || !activity.conversation.id) {
    return {
      ok: false,
      error: { code: "missing_field", field: "conversation.id", message: "conversation.id is required" },
    };
  }
  if (typeof activity.from?.id !== "string" || !activity.from.id) {
    return { ok: false, error: { code: "missing_field", field: "from.id", message: "from.id is required" } };
  }

  return { ok: true, activity };
}

function stripBotMentions(text: string): string {
  return text.replace(/<at>[^<]+<\/at>/gi, " ").replace(/\s+/g, " ");
}

function extractConversationReference(event: CanonicalEvent) {
  const teams = event.provider_extensions?.["teams"] as Record<string, unknown> | undefined;
  const serviceUrl = typeof teams?.["service_url"] === "string" ? teams["service_url"] : undefined;
  const conversationId =
    typeof teams?.["conversation_id"] === "string" ? teams["conversation_id"] : event.conversation_id;
  const tenantId = typeof teams?.["tenant_id"] === "string" ? teams["tenant_id"] : undefined;
  const activityId = typeof teams?.["activity_id"] === "string" ? teams["activity_id"] : undefined;

  if (!serviceUrl || !conversationId) {
    throw new Error("Cannot derive Teams conversation reference from canonical event");
  }

  return { serviceUrl, conversationId, tenantId, activityId };
}
