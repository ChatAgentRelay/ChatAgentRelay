import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicyConfig } from "@chat-agent-relay/middleware";
import { loadConfig, type ServerConfig } from "./config";
import { logger } from "./logger";
import { main } from "./main";
import { formatConfigErrors, validateConfig } from "./validate-config";

const DOCS_URL = "https://github.com/ChatAgentRelay/ChatAgentRelay/blob/main/docs/getting-started.md";

const KNOWN_FLAGS = new Set(["-h", "--help", "-v", "--version", "--check-config", "--dry-run"]);

function getPackageVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(dir, "..", "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function printHelp(): void {
  process.stdout.write(`Chat Agent Relay Server - Chat Platform <-> Agent Middleware

Usage: car-server [options]

Options:
  -h, --help          Show this help message
  -v, --version       Show version number
  --check-config      Validate configuration and exit
  --dry-run           Validate config and check connectivity, then exit

Environment:
  See .env.example for all configuration variables
  Docs: ${DOCS_URL}
`);
}

type CliMode = "run" | "help" | "version" | "check-config" | "dry-run";

function parseCli(argv: string[]): { mode: CliMode; error?: string } {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { mode: "run" };
  }

  const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    return {
      mode: "run",
      error: `Unknown argument(s): ${unknown.join(", ")}\nRun with --help for usage.`,
    };
  }

  const hasHelp = args.includes("-h") || args.includes("--help");
  const hasVersion = args.includes("-v") || args.includes("--version");
  const hasCheck = args.includes("--check-config");
  const hasDry = args.includes("--dry-run");

  if (hasHelp) {
    return { mode: "help" };
  }

  const exclusive = [hasVersion, hasCheck, hasDry].filter(Boolean).length;
  if (exclusive > 1) {
    return {
      mode: "run",
      error: "Only one of --version, --check-config, or --dry-run may be used at a time.",
    };
  }

  if (hasVersion) return { mode: "version" };
  if (hasCheck) return { mode: "check-config" };
  if (hasDry) return { mode: "dry-run" };

  return { mode: "run" };
}

function openAiV1Base(config: ServerConfig): string {
  const raw = config.openai.baseUrl ?? "https://api.openai.com/v1";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

async function slackAuthTest(botToken: string): Promise<void> {
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!body.ok) {
    throw new Error(`Slack auth.test failed: ${body.error ?? response.statusText}`);
  }
}

async function slackSocketModeHandshake(appToken: string): Promise<void> {
  const response = await fetch("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${appToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string; url?: string };
  if (!body.ok || !body.url) {
    throw new Error(`Slack Socket Mode handshake failed: ${body.error ?? "no url returned"}`);
  }
}

async function openAiConnectivity(config: ServerConfig): Promise<void> {
  const base = openAiV1Base(config);
  const response = await fetch(`${base}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI API check failed (${response.status}): ${text.slice(0, 200)}`);
  }
}

async function runDryRun(config: ServerConfig): Promise<void> {
  process.stdout.write("Checking external connectivity…\n");

  await slackAuthTest(config.slack.botToken);
  process.stdout.write("  Slack bot token (auth.test): OK\n");

  await slackSocketModeHandshake(config.slack.appToken);
  process.stdout.write("  Slack app token (Socket Mode): OK\n");

  await openAiConnectivity(config);
  process.stdout.write("  OpenAI API: OK\n");

  const policySource = config.car.policyConfig;
  if (policySource !== undefined && policySource.length > 0) {
    const policyConfig = loadPolicyConfig(policySource);
    process.stdout.write(`  Policy config: OK (${policyConfig.rules.length} rule(s))\n`);
  } else {
    process.stdout.write("  Policy config: (none)\n");
  }

  process.stdout.write("\nDry run completed successfully.\n");
}

function runCheckConfig(config: ServerConfig): void {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    process.stderr.write(formatConfigErrors(errors));
    process.exit(1);
  }
  process.stdout.write("Configuration is valid.\n");
  process.exit(0);
}

async function cliMain(): Promise<void> {
  const parsed = parseCli(process.argv);
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`);
    process.exit(1);
  }

  switch (parsed.mode) {
    case "help":
      printHelp();
      process.exit(0);
      break;
    case "version":
      process.stdout.write(`${getPackageVersion()}\n`);
      process.exit(0);
      break;
    case "check-config": {
      let config: ServerConfig;
      try {
        config = loadConfig();
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
      runCheckConfig(config);
      break;
    }
    case "dry-run": {
      let config: ServerConfig;
      try {
        config = loadConfig();
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
      const errors = validateConfig(config);
      if (errors.length > 0) {
        process.stderr.write(formatConfigErrors(errors));
        process.exit(1);
      }
      try {
        await runDryRun(config);
      } catch (error) {
        process.stderr.write(`Connectivity check failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
      process.exit(0);
      break;
    }
    case "run":
      await main();
      break;
    default: {
      const _exhaustive: never = parsed.mode;
      void _exhaustive;
    }
  }
}

cliMain().catch((error) => {
  logger.error("Fatal error", {
    error_message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
