export type ServerConfig = {
  slack: {
    botToken: string;
    appToken: string;
  };
  openai: {
    apiKey: string;
    model: string;
    systemPrompt: string;
  };
  cap: {
    tenantId: string;
    workspaceId: string;
    routeId: string;
    sqlitePath: string;
  };
};

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
    },
    cap: {
      tenantId: process.env["CAP_TENANT_ID"] ?? "default_tenant",
      workspaceId: process.env["CAP_WORKSPACE_ID"] ?? "default_workspace",
      routeId: process.env["CAP_ROUTE_ID"] ?? "openai_agent",
      sqlitePath: process.env["CAP_SQLITE_PATH"] ?? "./cap-ledger.db",
    },
  };
}
