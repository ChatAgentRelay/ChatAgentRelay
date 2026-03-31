import { afterAll, beforeAll } from "bun:test";
import { A2AAgentAdapter } from "@chat-agent-relay/backend-a2a";
import { GenericHttpBackend } from "@chat-agent-relay/backend-http";
import { LangGraphAdapter } from "@chat-agent-relay/backend-langgraph";
import { OpenAIBackend } from "@chat-agent-relay/backend-openai";
import { DiscordIngress } from "@chat-agent-relay/channel-discord";
import { SlackIngress } from "@chat-agent-relay/channel-slack";
import { WebChatIngress } from "@chat-agent-relay/channel-web-chat";
import type { AgentInvocationContext, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { testAgentAdapter } from "../src/agent-adapter-conformance";
import { testChannelIngress } from "../src/test-channel-ingress";

type BunServer = Server<unknown>;

let mockBackendServer: BunServer;
let mockBackendPort: number;
let mockOpenAIServer: BunServer;
let mockOpenAIPort: number;
let mockA2AServer: BunServer;
let mockA2APort: number;
let mockLangGraphServer: BunServer;
let mockLangGraphPort: number;
let webChatIngress: WebChatIngress;
let slackIngress: SlackIngress;
let discordIngress: DiscordIngress;

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
  mockBackendServer = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        request_id: "req_conformance",
        status: "completed",
        output: { text: "Conformance test response." },
        backend: {
          request_id: "backend_conf_001",
          session_handle: "sess_conf",
          agent_id: "conformance_agent",
        },
      });
    },
  });
  mockBackendPort = mockBackendServer.port!;

  mockOpenAIServer = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        id: "chatcmpl-conformance",
        object: "chat.completion",
        created: Date.now(),
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Conformance response from OpenAI mock." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
  });
  mockOpenAIPort = mockOpenAIServer.port!;

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

  mockLangGraphServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-xxx" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        return Response.json({
          messages: [{ type: "ai", content: "LangGraph response" }],
        });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/stream")) {
        const chunk = JSON.stringify([
          { type: "AIMessageChunk", content: "LangGraph streamed response" },
        ]);
        const body =
          `event: metadata\ndata: {"run_id":"run-1"}\n\n` +
          `event: messages\ndata: ${chunk}\n\n`;
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  mockLangGraphPort = mockLangGraphServer.port!;

  webChatIngress = await WebChatIngress.create();
  slackIngress = await SlackIngress.create("tenant_conf", "ws_conf");
  discordIngress = await DiscordIngress.create("tenant_conf", "ws_conf");
});

afterAll(() => {
  mockBackendServer.stop(true);
  mockOpenAIServer.stop(true);
  mockA2AServer.stop(true);
  mockLangGraphServer.stop(true);
});

// --- Channel Ingress Conformance ---

testChannelIngress({
  name: "WebChatIngress",
  get ingress() {
    return webChatIngress;
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

testChannelIngress({
  name: "SlackIngress",
  get ingress() {
    return slackIngress;
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
      label: "non-message type",
      input: { type: "reaction_added", channel: "C1", user: "U1", text: "hi", ts: "1.0" },
      expectedCode: "invalid_slack_event",
    },
    {
      label: "bot message",
      input: { type: "message", channel: "C1", user: "U1", text: "hi", ts: "1.0", bot_id: "B123" },
      expectedCode: "bot_message",
    },
  ],
});

testChannelIngress({
  name: "DiscordIngress",
  get ingress() {
    return discordIngress;
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

// --- Agent Adapter Conformance ---

testAgentAdapter({
  name: "A2AAgentAdapter",
  adapter: () => A2AAgentAdapter.create({ endpoint: `http://localhost:${mockA2APort}` }),
  context: agentContext(),
  supportsStreaming: true,
  supportsHitl: true,
});

testAgentAdapter({
  name: "LangGraphAdapter",
  adapter: () => LangGraphAdapter.create({ endpoint: `http://localhost:${mockLangGraphPort}` }),
  context: agentContext(),
  supportsStreaming: true,
  supportsHitl: true,
});

testAgentAdapter({
  name: "GenericHttpBackend.asAgentAdapter()",
  adapter: async () => {
    const backend = await GenericHttpBackend.create({ endpoint: `http://localhost:${mockBackendPort}` });
    return backend.asAgentAdapter();
  },
  context: agentContext(),
  supportsStreaming: false,
});

testAgentAdapter({
  name: "OpenAIBackend.asAgentAdapter()",
  adapter: async () => {
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockOpenAIPort}`,
    });
    return backend.asAgentAdapter();
  },
  context: agentContext(),
  supportsStreaming: true,
});

testAgentAdapter({
  name: "ACPAgentAdapter",
  adapter: async () => {
    const { ACPAgentAdapter } = await import("@chat-agent-relay/backend-acp");
    const mockPath = new URL("../../backend-acp/tests/mock-acp-agent.ts", import.meta.url).pathname;
    return ACPAgentAdapter.create({ command: "bun", args: ["run", mockPath], timeoutMs: 10_000 });
  },
  context: agentContext(),
  supportsStreaming: true,
  supportsHitl: false,
});
