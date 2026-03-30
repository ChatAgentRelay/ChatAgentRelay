/**
 * Mock ACP agent for testing. Reads JSON-RPC from stdin, writes to stdout.
 * Supports: initialize, session/new, session/prompt, session/cancel
 * Behavior controlled by env vars:
 *   MOCK_RESPONSE_TEXT - text to respond with (default: "Hello from ACP agent")
 *   MOCK_FAIL - if "true", respond with error
 *   MOCK_PERMISSION - if "true", request permission before responding
 *   MOCK_SLOW - if "true", delay response by 200ms
 */

const responseText = process.env["MOCK_RESPONSE_TEXT"] ?? "Hello from ACP agent";
const shouldFail = process.env["MOCK_FAIL"] === "true";
const shouldRequestPermission = process.env["MOCK_PERMISSION"] === "true";
const shouldBeSlow = process.env["MOCK_SLOW"] === "true";

let sessionCounter = 0;

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendNotification(method: string, params: Record<string, unknown>): void {
  send({ jsonrpc: "2.0", method, params });
}

async function handleMessage(msg: Record<string, unknown>): Promise<void> {
  const method = msg["method"] as string;
  const id = msg["id"] as string | number | undefined;
  const params = (msg["params"] ?? {}) as Record<string, unknown>;

  switch (method) {
    case "initialize": {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            loadSession: false,
            mcpCapabilities: { http: false, sse: false },
            promptCapabilities: { audio: false, embeddedContext: false, image: false },
          },
          agentInfo: { name: "mock-acp-agent", version: "1.0.0" },
        },
      });
      break;
    }

    case "session/new": {
      sessionCounter++;
      send({
        jsonrpc: "2.0",
        id,
        result: { sessionId: `session_${sessionCounter}` },
      });
      break;
    }

    case "session/prompt": {
      const sessionId = params["sessionId"] as string;

      if (shouldBeSlow) {
        await new Promise((r) => setTimeout(r, 200));
      }

      if (shouldFail) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "Agent internal error" },
        });
        return;
      }

      if (shouldRequestPermission) {
        const permId = Date.now();
        send({
          jsonrpc: "2.0",
          id: permId,
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: { toolCallId: "tc_1", toolName: "write_file", params: { path: "/tmp/test.txt" } },
            options: [
              { id: "allow", label: "Allow" },
              { id: "deny", label: "Deny" },
            ],
          },
        });

        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            resolve();
            clearInterval(checkInterval);
          }, 50);
        });
      }

      sendNotification("session/update", {
        sessionId,
        update: { type: "message_chunk", role: "assistant", content: responseText },
      });

      send({
        jsonrpc: "2.0",
        id,
        result: { stopReason: "end_turn" },
      });
      break;
    }

    case "session/cancel": {
      break;
    }
  }
}

const decoder = new TextDecoder();
let buffer = "";

async function processStdin(): Promise<void> {
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;

        if (msg["method"] === undefined && (msg["result"] !== undefined || msg["error"] !== undefined)) {
          continue;
        }

        await handleMessage(msg);
      } catch {
        /* ignore parse errors */
      }
    }
  }
}

processStdin();
