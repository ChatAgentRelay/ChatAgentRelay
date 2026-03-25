export type ServerConfig = {
  slack: {
    botToken: string;
    appToken: string;
  };
  openai: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    baseUrl?: string | undefined;
  };
  cap: {
    tenantId: string;
    workspaceId: string;
    routeId: string;
    sqlitePath: string;
    streaming: boolean;
    streamingIntervalMs: number;
    apiPort: number;
    policyConfig?: string | undefined;
  };
};

function loadPolicySource(): string | undefined {
  const inline = process.env["CAP_POLICY_CONFIG"];
  if (inline) return inline;

  const filePath = process.env["CAP_POLICY_FILE"];
  if (filePath) {
    const fs = require("fs") as typeof import("fs");
    return fs.readFileSync(filePath, "utf-8");
  }

  return undefined;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): ServerConfig {
  return {
    slack: {
      botToken: requireEnv("SLACK_BOT_TOKEN"),
      appToken: requireEnv("SLACK_APP_TOKEN"),
    },
    openai: {
      apiKey: requireEnv("OPENAI_API_KEY"),
      model: process.env["OPENAI_MODEL"] ?? "gpt-4o-mini",
      systemPrompt: process.env["OPENAI_SYSTEM_PROMPT"] ?? "You are a helpful assistant.",
      baseUrl: process.env["OPENAI_BASE_URL"],
    },
    cap: {
      tenantId: process.env["CAP_TENANT_ID"] ?? "default_tenant",
      workspaceId: process.env["CAP_WORKSPACE_ID"] ?? "default_workspace",
      routeId: process.env["CAP_ROUTE_ID"] ?? "openai_agent",
      sqlitePath: process.env["CAP_SQLITE_PATH"] ?? "./cap-ledger.db",
      streaming: process.env["CAP_STREAMING"] !== "false",
      streamingIntervalMs: Number(process.env["CAP_STREAMING_INTERVAL_MS"] ?? "800"),
      apiPort: Number(process.env["CAP_API_PORT"] ?? "3000"),
      policyConfig: loadPolicySource(),
    },
  };
}
