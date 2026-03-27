import type { ServerConfig } from "./config";

export type ConfigError = {
  field: string;
  message: string;
  hint?: string | undefined;
};

export function validateConfig(config: ServerConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (!config.slack.botToken) {
    errors.push({
      field: "SLACK_BOT_TOKEN",
      message: "Missing required Slack Bot Token",
      hint: "Get this from api.slack.com/apps -> OAuth & Permissions -> Bot User OAuth Token (starts with xoxb-)",
    });
  } else if (!config.slack.botToken.startsWith("xoxb-")) {
    errors.push({
      field: "SLACK_BOT_TOKEN",
      message: "Slack Bot Token should start with 'xoxb-'",
      hint: "This looks like the wrong token type. Bot tokens start with xoxb-, not xoxp- or xapp-",
    });
  }

  if (!config.slack.appToken) {
    errors.push({
      field: "SLACK_APP_TOKEN",
      message: "Missing required Slack App Token",
      hint: "Get this from api.slack.com/apps -> Basic Information -> App-Level Tokens (starts with xapp-)",
    });
  } else if (!config.slack.appToken.startsWith("xapp-")) {
    errors.push({
      field: "SLACK_APP_TOKEN",
      message: "Slack App Token should start with 'xapp-'",
      hint: "This looks like the wrong token type. App tokens start with xapp-",
    });
  }

  if (!config.openai.apiKey) {
    errors.push({
      field: "OPENAI_API_KEY",
      message: "Missing required OpenAI API key",
      hint: "Get this from platform.openai.com/api-keys (starts with sk-)",
    });
  }

  if (config.car.apiPort < 0 || config.car.apiPort > 65535 || !Number.isInteger(config.car.apiPort)) {
    errors.push({
      field: "CAR_API_PORT",
      message: `Invalid port number: ${config.car.apiPort}`,
      hint: "Must be an integer between 0 and 65535",
    });
  }

  if (config.car.streamingIntervalMs < 100) {
    errors.push({
      field: "CAR_STREAMING_INTERVAL_MS",
      message: `Streaming interval too low: ${config.car.streamingIntervalMs}ms`,
      hint: "Minimum recommended interval is 100ms to avoid rate limiting",
    });
  }

  if (config.openai.baseUrl) {
    try {
      new URL(config.openai.baseUrl);
    } catch {
      errors.push({
        field: "OPENAI_BASE_URL",
        message: `Invalid URL: ${config.openai.baseUrl}`,
        hint: "Must be a valid URL, e.g. http://localhost:8317 or https://api.openai.com/v1",
      });
    }
  }

  return errors;
}

export function formatConfigErrors(errors: ConfigError[]): string {
  const lines = ["", "=== Chat Agent Relay Configuration Errors ===", ""];

  for (const error of errors) {
    lines.push(`  [${error.field}] ${error.message}`);
    if (error.hint) {
      lines.push(`    Hint: ${error.hint}`);
    }
    lines.push("");
  }

  lines.push("See docs/getting-started.md for setup instructions.");
  lines.push("");

  return lines.join("\n");
}
