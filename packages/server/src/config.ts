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
  car: {
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
  const inline = process.env["CAR_POLICY_CONFIG"];
  if (inline) return inline;

  const filePath = process.env["CAR_POLICY_FILE"];
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
    car: {
      tenantId: process.env["CAR_TENANT_ID"] ?? "default_tenant",
      workspaceId: process.env["CAR_WORKSPACE_ID"] ?? "default_workspace",
      routeId: process.env["CAR_ROUTE_ID"] ?? "openai_agent",
      sqlitePath: process.env["CAR_SQLITE_PATH"] ?? "./car-ledger.db",
      streaming: process.env["CAR_STREAMING"] !== "false",
      streamingIntervalMs: Number(process.env["CAR_STREAMING_INTERVAL_MS"] ?? "800"),
      apiPort: Number(process.env["CAR_API_PORT"] ?? "3000"),
      policyConfig: loadPolicySource(),
    },
  };
}
