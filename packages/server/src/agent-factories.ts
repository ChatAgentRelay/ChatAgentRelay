import { A2AAgentAdapter } from "@chat-agent-relay/backend-a2a";
import type { AgentFactory } from "./agent-registry";
import { pickString, pickNumber, pickHeaders } from "./config-helpers";

export function createA2AFactory(): AgentFactory {
  return async (config) => {
    const endpoint = pickString(config, "endpoint");
    if (!endpoint) throw new Error("a2a config requires string endpoint");
    const timeoutMs = pickNumber(config, "timeoutMs");
    const headers = pickHeaders(config);
    return A2AAgentAdapter.create({
      endpoint,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(headers ? { headers } : {}),
    });
  };
}
