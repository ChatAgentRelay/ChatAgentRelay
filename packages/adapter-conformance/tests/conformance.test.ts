import { afterAll, beforeAll } from "bun:test";
import { A2AAgentAdapter } from "@chat-agent-relay/backend-a2a";
import { DingTalkIngress } from "@chat-agent-relay/channel-dingtalk";
import { DiscordIngress } from "@chat-agent-relay/channel-discord";
import { LarkIngress } from "@chat-agent-relay/channel-lark";
import { SlackIngress } from "@chat-agent-relay/channel-slack";
import { TelegramIngress } from "@chat-agent-relay/channel-telegram";
import { WebChatIngress } from "@chat-agent-relay/channel-web-chat";
import type { AgentInvocationContext, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { testAgentAdapter } from "../src/agent-adapter-conformance";
import { testChannelAdapter } from "../src/test-channel-ingress";

type BunServer = Server<unknown>;

let mockA2AServer: BunServer;
let mockA2APort: number;
let webChatAdapter: WebChatIngress;
let slackAdapter: SlackIngress;
let discordAdapter: DiscordIngress;
let telegramAdapter: TelegramIngress;
let larkAdapter: LarkIngress;
let dingtalkAdapter: DingTalkIngress;

function agentInvocationEvent(): CanonicalEvent {
  return {
    event_id: "evt_agent_conf_103",
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "tenant_conformance",
    workspace_id: "ws_test",
    channel: "test",
    channel_instance_id: "test_ch",
    conversation_id: "conv_conf",
    session_id: "sess_conf",
    correlation_id: "corr_agent_conf",
    causation_id: "evt_agent_conf_102",
    occurred_at: "2026-03-25T10:00:00Z",
    actor_type: "system",
    payload: { backend: "test_backend", input_event_id: "evt_agent_conf_100" },
  };
}

function agentContext(): AgentInvocationContext {
  return {
    invocationEvent: agentInvocationEvent(),
    messageText: "Hello from conformance test",
    route: { route_id: "test_route", reason: "conformance_test" },
    policy: { policy_id: "test_policy", decision: "allow" },
  };
}

beforeAll(async () => {
  mockA2AServer = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "GET") {
        return new Response("Not found", { status: 404 });
      }
      const parsed = (await req.json()) as Record<string, unknown>;
      const requestId = parsed["id"] as string;
      const method = parsed["method"] as string;

      if (method === "message/stream") {
        const taskResult = {
          kind: "status-update",
          taskId: "task-1",
          contextId: "ctx-1",
          status: {
            state: "completed",
            timestamp: new Date().toISOString(),
            message: {
              kind: "message",
              messageId: "msg-stream-1",
              role: "agent",
              parts: [{ kind: "text", text: "A2A streamed response" }],
            },
          },
        };
        const body = `data: ${JSON.stringify(taskResult)}\n\n`;
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      return Response.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          kind: "task",
          id: "task-1",
          contextId: "ctx-1",
          status: {
            state: "completed",
            timestamp: new Date().toISOString(),
            message: {
              kind: "message",
              messageId: "msg-resp-1",
              role: "agent",
              parts: [{ kind: "text", text: "A2A response" }],
            },
          },
          artifacts: [
            { artifactId: "a1", parts: [{ kind: "text", text: "A2A response" }] },
          ],
        },
      });
    },
  });
  mockA2APort = mockA2AServer.port!;

  webChatAdapter = await WebChatIngress.create();
  slackAdapter = await SlackIngress.create("xoxb-conformance-test-token", "tenant_conf", "ws_conf");
  discordAdapter = await DiscordIngress.create("conformance-discord-token", "tenant_conf", "ws_conf");
  telegramAdapter = await TelegramIngress.create("conformance-telegram-token", "tenant_conf", "ws_conf");
  larkAdapter = await LarkIngress.create("cli_conformance", "conformance_secret", "tenant_conf", "ws_conf");
  dingtalkAdapter = await DingTalkIngress.create("tenant_conf", "ws_conf");
});

afterAll(() => {
  mockA2AServer.stop(true);
});

// --- Channel Adapter Conformance ---

testChannelAdapter({
  name: "WebChatAdapter",
  get adapter() {
    return webChatAdapter;
  },
  expectedChannel: "webchat",
  validInput: {
    client_message_id: "msg_conf_001",
    text: "Conformance test message",
    user_id: "user_conf",
    display_name: "Tester",
    tenant_id: "tenant_conf",
    workspace_id: "ws_conf",
    channel_instance_id: "webchat_conf",
  },
  invalidInputs: [
    {
      label: "empty text",
      input: { client_message_id: "m1", text: "", user_id: "u1", tenant_id: "t1", workspace_id: "ws1" },
      expectedCode: "missing_field",
    },
    {
      label: "missing client_message_id",
      input: { text: "hi", user_id: "u1", tenant_id: "t1", workspace_id: "ws1" },
      expectedCode: "missing_field",
    },
  ],
});

testChannelAdapter({
  name: "SlackAdapter",
  get adapter() {
    return slackAdapter;
  },
  expectedChannel: "slack",
  validInput: {
    type: "message",
    channel: "C123",
    user: "U456",
    text: "Conformance test from Slack",
    ts: "1710000000.000001",
    team: "T789",
    channel_type: "channel",
  },
  invalidInputs: [
    {
      label: "empty text",
      input: { type: "message", channel: "C1", user: "U1", text: "", ts: "1.0" },
      expectedCode: "empty_text",
    },
    {
      label: "bot message",
      input: { type: "message", channel: "C1", user: "U1", text: "hi", ts: "1.0", bot_id: "B123" },
      expectedCode: "bot_message",
    },
  ],
});

testChannelAdapter({
  name: "DiscordAdapter",
  get adapter() {
    return discordAdapter;
  },
  expectedChannel: "discord",
  validInput: {
    id: "1234567890123456789",
    channel_id: "9876543210987654321",
    guild_id: "5555666677778888",
    author: { id: "111122223333444455", username: "test_user", bot: false },
    content: "Conformance test from Discord",
    timestamp: "2026-03-28T10:00:00.000Z",
  },
  invalidInputs: [
    {
      label: "empty content",
      input: {
        id: "m1",
        channel_id: "c1",
        author: { id: "u1", username: "u", bot: false },
        content: "",
        timestamp: "2026-03-28T10:00:00.000Z",
      },
      expectedCode: "empty_content",
    },
    {
      label: "bot message",
      input: {
        id: "m1",
        channel_id: "c1",
        author: { id: "u1", username: "bot", bot: true },
        content: "hi",
        timestamp: "2026-03-28T10:00:00.000Z",
      },
      expectedCode: "bot_message",
    },
  ],
});

testChannelAdapter({
  name: "TelegramAdapter",
  get adapter() {
    return telegramAdapter;
  },
  expectedChannel: "telegram",
  validInput: {
    update_id: 100200300,
    message: {
      message_id: 42,
      from: { id: 12345, is_bot: false, first_name: "Alice", last_name: "Wang", username: "alicew" },
      chat: { id: -100999, type: "group", title: "Dev Chat" },
      date: 1711670400,
      text: "Conformance test from Telegram",
    },
  },
  invalidInputs: [
    { label: "missing message", input: { update_id: 1 }, expectedCode: "missing_field" },
    {
      label: "empty text",
      input: {
        update_id: 1,
        message: { message_id: 1, from: { id: 1, is_bot: false, first_name: "A" }, chat: { id: 1, type: "private" }, date: 1, text: "" },
      },
      expectedCode: "missing_field",
    },
  ],
});

testChannelAdapter({
  name: "LarkAdapter",
  get adapter() {
    return larkAdapter;
  },
  expectedChannel: "lark",
  validInput: {
    schema: "2.0",
    header: {
      event_id: "evt_lark_001",
      event_type: "im.message.receive_v1",
      create_time: "1711670400000",
      token: "token_123",
      app_id: "cli_app",
      tenant_key: "tenant_key",
    },
    event: {
      sender: { sender_id: { open_id: "ou_user1" }, sender_type: "user" },
      message: {
        message_id: "om_msg1",
        chat_id: "oc_chat1",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "Conformance test from Lark" }),
      },
    },
  },
  invalidInputs: [
    { label: "wrong event type", input: { schema: "2.0", header: { event_id: "e1", event_type: "im.chat.disbanded_v1", create_time: "1", token: "t", app_id: "a", tenant_key: "k" }, event: {} }, expectedCode: "unsupported_event_type" },
    { label: "non-text message", input: { schema: "2.0", header: { event_id: "e1", event_type: "im.message.receive_v1", create_time: "1", token: "t", app_id: "a", tenant_key: "k" }, event: { sender: { sender_id: { open_id: "u1" }, sender_type: "user" }, message: { message_id: "m1", chat_id: "c1", chat_type: "p2p", message_type: "image", content: "{}" } } }, expectedCode: "unsupported_message_type" },
  ],
});

testChannelAdapter({
  name: "DingTalkAdapter",
  get adapter() {
    return dingtalkAdapter;
  },
  expectedChannel: "dingtalk",
  validInput: {
    msgtype: "text",
    text: { content: "Conformance test from DingTalk" },
    msgId: "msg_dt_001",
    createAt: 1711670400000,
    conversationType: "2",
    conversationId: "cidXXX",
    conversationTitle: "Dev Group",
    senderId: "dingtalk_uid_001",
    senderNick: "张三",
    senderStaffId: "staff_001",
    chatbotUserId: "bot_uid_001",
    sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
    sessionWebhookExpiredTime: 1711756800000,
  },
  invalidInputs: [
    { label: "unsupported msgtype", input: { msgtype: "link" }, expectedCode: "unsupported_msgtype" },
    { label: "empty content", input: { msgtype: "text", text: { content: "  " }, msgId: "m1", createAt: 1, conversationType: "1", conversationId: "c1", senderId: "s1", senderNick: "n", chatbotUserId: "b1", sessionWebhook: "https://x", sessionWebhookExpiredTime: 1 }, expectedCode: "empty_content" },
  ],
});

// --- Agent Adapter Conformance ---

testAgentAdapter({
  name: "A2AAgentAdapter",
  adapter: () => A2AAgentAdapter.create({ endpoint: `http://localhost:${mockA2APort}` }),
  context: agentContext(),
  supportsStreaming: true,
  supportsHitl: true,
});
