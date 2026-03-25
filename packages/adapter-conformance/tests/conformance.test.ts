import { beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { WebChatIngress } from "@cap/channel-web-chat";
import { SlackIngress } from "@cap/channel-slack";
import { GenericHttpBackend } from "@cap/backend-http";
import { OpenAIBackend } from "@cap/backend-openai";
import { testChannelIngress } from "../src/test-channel-ingress";
import { testBackendAdapter } from "../src/test-backend-adapter";

type BunServer = Server<unknown>;

let mockBackendServer: BunServer;
let mockBackendPort: number;
let mockOpenAIServer: BunServer;
let mockOpenAIPort: number;
let webChatIngress: WebChatIngress;
let slackIngress: SlackIngress;

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
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Conformance response from OpenAI mock." },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
  });
  mockOpenAIPort = mockOpenAIServer.port!;

  webChatIngress = await WebChatIngress.create();
  slackIngress = await SlackIngress.create("tenant_conf", "ws_conf");
});

afterAll(() => {
  mockBackendServer.stop(true);
  mockOpenAIServer.stop(true);
});

// --- Channel Ingress Conformance ---

testChannelIngress({
  name: "WebChatIngress",
  get ingress() { return webChatIngress; },
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
    { label: "empty text", input: { client_message_id: "m1", text: "", user_id: "u1", tenant_id: "t1", workspace_id: "ws1" }, expectedCode: "missing_field" },
    { label: "missing client_message_id", input: { text: "hi", user_id: "u1", tenant_id: "t1", workspace_id: "ws1" }, expectedCode: "missing_field" },
  ],
});

testChannelIngress({
  name: "SlackIngress",
  get ingress() { return slackIngress; },
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
    { label: "empty text", input: { type: "message", channel: "C1", user: "U1", text: "", ts: "1.0" }, expectedCode: "empty_text" },
    { label: "non-message type", input: { type: "app_mention", channel: "C1", user: "U1", text: "hi", ts: "1.0" }, expectedCode: "invalid_slack_event" },
    { label: "bot message", input: { type: "message", channel: "C1", user: "U1", text: "hi", ts: "1.0", bot_id: "B123" }, expectedCode: "bot_message" },
  ],
});

// --- Backend Adapter Conformance ---

testBackendAdapter({
  name: "GenericHttpBackend",
  get adapter() {
    return { invoke: async (ctx: import("@cap/backend-http").InvocationContext) => {
      const backend = await GenericHttpBackend.create({ endpoint: `http://localhost:${mockBackendPort}` });
      return backend.invoke(ctx);
    }};
  },
});

testBackendAdapter({
  name: "OpenAIBackend",
  get adapter() {
    return { invoke: async (ctx: import("@cap/backend-http").InvocationContext) => {
      const backend = await OpenAIBackend.create({ apiKey: "test-key", baseUrl: `http://localhost:${mockOpenAIPort}` });
      return backend.invoke(ctx);
    }};
  },
});
