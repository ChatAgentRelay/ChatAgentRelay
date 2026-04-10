#!/usr/bin/env bun
import { SqliteConfigStore } from "@chat-agent-relay/config-store";
import type { AgentType, ChannelType, RouteMatchType } from "@chat-agent-relay/config-store";

const DEFAULT_DB_PATH = "./car.db";
const DEFAULT_API_PORT = 3000;

function getDbPath(): string {
  return process.env["CAR_DB_PATH"] ?? DEFAULT_DB_PATH;
}

function getEncKey(): string | undefined {
  return process.env["CAR_ENCRYPTION_KEY"];
}

function getApiPort(): number {
  const envPort = process.env["CAR_API_PORT"];
  if (envPort) return Number(envPort);

  try {
    const db = openDb();
    try {
      const dbPort = db.getSetting("api.port");
      if (dbPort) return Number(dbPort);
    } finally {
      db.close();
    }
  } catch {
    // DB might not exist yet
  }

  return DEFAULT_API_PORT;
}

function out(msg: string): void {
  process.stdout.write(msg + "\n");
}

function err(msg: string): void {
  process.stderr.write("✗ " + msg + "\n");
}

function ok(msg: string): void {
  out("✓ " + msg);
}

function mask(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "..." + value.slice(-3);
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = args[i + 1] ?? "true";
        if (args[i + 1] && !args[i + 1]!.startsWith("--")) i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function prompt(message: string): Promise<string> {
  process.stdout.write(message);
  for await (const line of console) {
    return line.trim();
  }
  return "";
}

async function isServerRunning(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function getApiKey(): string | undefined {
  return process.env["CAR_API_KEY"];
}

async function apiCall(port: number, method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  const key = getApiKey();
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const resp = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.json();
}

function openDb(): SqliteConfigStore {
  return new SqliteConfigStore(getDbPath(), getEncKey());
}

// ── Channel commands ─────────────────────────────────────────────────

async function channelAdd(positional: string[], flags: Record<string, string>): Promise<void> {
  const name = positional[2];
  if (!name) { err("Usage: car channel add <name> --type=slack|discord|webchat|telegram|lark|dingtalk|teams|whatsapp [options]"); return; }

  const validChannelTypes = ["slack", "discord", "webchat", "telegram", "lark", "dingtalk", "teams", "whatsapp"];
  const type = (flags["type"] ?? await prompt("Channel type (slack/discord/webchat/telegram/lark/dingtalk/teams/whatsapp): ")) as ChannelType;
  if (!validChannelTypes.includes(type)) { err(`Invalid type: ${type}. Valid: ${validChannelTypes.join(", ")}`); return; }

  const config: Record<string, unknown> = {};

  if (type === "slack") {
    config["botToken"] = flags["bot-token"] ?? await prompt("Bot Token (xoxb-...): ");
    config["appToken"] = flags["app-token"] ?? await prompt("App Token (xapp-...): ");
    if (!config["botToken"] || !config["appToken"]) { err("Slack requires --bot-token and --app-token"); return; }
  } else if (type === "discord") {
    config["botToken"] = flags["bot-token"] ?? await prompt("Bot Token: ");
    if (!config["botToken"]) { err("Discord requires --bot-token"); return; }
    if (flags["guild-allowlist"]) config["guildAllowlist"] = flags["guild-allowlist"].split(",");
  } else if (type === "telegram") {
    config["botToken"] = flags["bot-token"] ?? await prompt("Bot Token: ");
    const secretToken = flags["secret-token"] ?? await prompt("Secret Token (optional): ");
    if (!config["botToken"]) { err("Telegram requires --bot-token"); return; }
    if (secretToken) config["secretToken"] = secretToken;
  } else if (type === "lark") {
    config["appId"] = flags["app-id"] ?? await prompt("App ID: ");
    config["appSecret"] = flags["app-secret"] ?? await prompt("App Secret: ");
    const encryptKey = flags["encrypt-key"] ?? await prompt("Encrypt Key (optional): ");
    if (!config["appId"] || !config["appSecret"]) { err("Lark requires --app-id and --app-secret"); return; }
    if (encryptKey) config["encryptKey"] = encryptKey;
  } else if (type === "teams") {
    config["appId"] = flags["app-id"] ?? await prompt("App ID: ");
    config["appSecret"] = flags["app-secret"] ?? await prompt("App Secret: ");
    config["tenantId"] = flags["tenant-id"] ?? await prompt("Tenant ID: ");
    if (!config["appId"] || !config["appSecret"] || !config["tenantId"]) {
      err("Teams requires --app-id, --app-secret, and --tenant-id");
      return;
    }
  } else if (type === "whatsapp") {
    config["phoneNumberId"] = flags["phone-number-id"] ?? await prompt("Phone Number ID: ");
    config["accessToken"] = flags["access-token"] ?? await prompt("Access Token: ");
    config["verifyToken"] = flags["verify-token"] ?? await prompt("Webhook Verify Token (optional): ");
    config["appSecret"] = flags["app-secret"] ?? await prompt("App Secret (optional): ");
    if (!config["phoneNumberId"] || !config["accessToken"]) {
      err("WhatsApp requires --phone-number-id and --access-token");
      return;
    }
  }

  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "POST", "/api/channels", { name, type, config });
    ok(`Added channel '${name}' (live)`);
  } else {
    const db = openDb();
    try {
      await db.addChannel(name, type, config);
      ok(`Added channel '${name}' (will activate on next start)`);
    } finally { db.close(); }
  }
}

async function channelList(): Promise<void> {
  const port = getApiPort();
  let channels: Array<{ name: string; type: string; enabled: boolean }>;

  if (await isServerRunning(port)) {
    channels = await apiCall(port, "GET", "/api/channels") as typeof channels;
  } else {
    const db = openDb();
    try {
      channels = await db.listChannels();
    } finally { db.close(); }
  }

  if (channels.length === 0) { out("No channels configured."); return; }
  out("NAME              TYPE       ENABLED");
  for (const ch of channels) {
    out(`${ch.name.padEnd(18)}${ch.type.padEnd(11)}${ch.enabled ? "yes" : "no"}`);
  }
}

async function channelShow(positional: string[]): Promise<void> {
  const name = positional[2];
  if (!name) { err("Usage: car channel show <name>"); return; }
  const db = openDb();
  try {
    const ch = await db.getChannel(name);
    if (!ch) { err(`Channel '${name}' not found`); return; }
    out(`Name:    ${ch.name}`);
    out(`Type:    ${ch.type}`);
    out(`Enabled: ${ch.enabled}`);
    out(`Created: ${ch.created_at}`);
    out(`Updated: ${ch.updated_at}`);
    out("Config:");
    for (const [k, v] of Object.entries(ch.config)) {
      const display = (typeof v === "string" && (k.toLowerCase().includes("token") || k.toLowerCase().includes("key")))
        ? mask(v) : String(v);
      out(`  ${k}: ${display}`);
    }
  } finally { db.close(); }
}

async function channelToggle(positional: string[], enable: boolean): Promise<void> {
  const name = positional[2];
  if (!name) { err(`Usage: car channel ${enable ? "enable" : "disable"} <name>`); return; }
  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "POST", `/api/channels/${name}/${enable ? "enable" : "disable"}`);
    ok(`${enable ? "Enabled" : "Disabled"} channel '${name}' (live)`);
  } else {
    const db = openDb();
    try {
      await db.updateChannel(name, { enabled: enable });
      ok(`${enable ? "Enabled" : "Disabled"} channel '${name}'`);
    } finally { db.close(); }
  }
}

async function channelRemove(positional: string[]): Promise<void> {
  const name = positional[2];
  if (!name) { err("Usage: car channel remove <name>"); return; }
  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "DELETE", `/api/channels/${name}`);
    ok(`Removed channel '${name}' (live)`);
  } else {
    const db = openDb();
    try {
      db.removeChannel(name);
      ok(`Removed channel '${name}'`);
    } finally { db.close(); }
  }
}

// ── Agent commands ───────────────────────────────────────────────────

async function agentAdd(positional: string[], flags: Record<string, string>): Promise<void> {
  const name = positional[2];
  if (!name) { err("Usage: car agent add <name> --endpoint=URL [options]"); return; }

  const type: AgentType = "a2a";

  const config: Record<string, unknown> = {};
  config["endpoint"] = flags["endpoint"] ?? await prompt("A2A endpoint URL: ");
  if (!config["endpoint"]) { err("Agent requires --endpoint"); return; }

  if (flags["timeout-ms"]) config["timeoutMs"] = Number(flags["timeout-ms"]);

  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "POST", "/api/agents", { name, type, config });
    ok(`Added agent '${name}' (live)`);
  } else {
    const db = openDb();
    try {
      await db.addAgent(name, type, config);
      ok(`Added agent '${name}' (will activate on next start)`);
    } finally { db.close(); }
  }
}

async function agentList(): Promise<void> {
  const port = getApiPort();
  let agents: Array<{ name: string; type: string; enabled: boolean }>;

  if (await isServerRunning(port)) {
    agents = await apiCall(port, "GET", "/api/agents") as typeof agents;
  } else {
    const db = openDb();
    try {
      agents = await db.listAgents();
    } finally { db.close(); }
  }

  if (agents.length === 0) { out("No agents configured."); return; }
  out("NAME              TYPE         ENABLED");
  for (const ag of agents) {
    out(`${ag.name.padEnd(18)}${ag.type.padEnd(13)}${ag.enabled ? "yes" : "no"}`);
  }
}

async function agentShow(positional: string[]): Promise<void> {
  const name = positional[2];
  if (!name) { err("Usage: car agent show <name>"); return; }
  const db = openDb();
  try {
    const ag = await db.getAgent(name);
    if (!ag) { err(`Agent '${name}' not found`); return; }
    out(`Name:    ${ag.name}`);
    out(`Type:    ${ag.type}`);
    out(`Enabled: ${ag.enabled}`);
    out(`Created: ${ag.created_at}`);
    out(`Updated: ${ag.updated_at}`);
    out("Config:");
    for (const [k, v] of Object.entries(ag.config)) {
      const display = (typeof v === "string" && (k.toLowerCase().includes("key") || k.toLowerCase().includes("token")))
        ? mask(v) : String(v);
      out(`  ${k}: ${display}`);
    }
  } finally { db.close(); }
}

async function agentToggle(positional: string[], enable: boolean): Promise<void> {
  const name = positional[2];
  if (!name) { err(`Usage: car agent ${enable ? "enable" : "disable"} <name>`); return; }
  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "POST", `/api/agents/${name}/${enable ? "enable" : "disable"}`);
    ok(`${enable ? "Enabled" : "Disabled"} agent '${name}' (live)`);
  } else {
    const db = openDb();
    try {
      await db.updateAgent(name, { enabled: enable });
      ok(`${enable ? "Enabled" : "Disabled"} agent '${name}'`);
    } finally { db.close(); }
  }
}

async function agentRemove(positional: string[]): Promise<void> {
  const name = positional[2];
  if (!name) { err("Usage: car agent remove <name>"); return; }
  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "DELETE", `/api/agents/${name}`);
    ok(`Removed agent '${name}' (live)`);
  } else {
    const db = openDb();
    try {
      db.removeAgent(name);
      ok(`Removed agent '${name}'`);
    } finally { db.close(); }
  }
}

// ── Route commands ───────────────────────────────────────────────────

async function routeAdd(flags: Record<string, string>): Promise<void> {
  const agentName = flags["agent"];
  if (!agentName) { err("Usage: car route add --agent=<name> [--match=channel:<ch>|pattern:<re>] [--default] [--priority=N]"); return; }

  let matchType: RouteMatchType;
  let matchValue: string | null = null;
  const priority = Number(flags["priority"] ?? "0");

  if (flags["default"] !== undefined) {
    matchType = "default";
  } else if (flags["match"]) {
    const match = flags["match"];
    const colonIdx = match.indexOf(":");
    if (colonIdx < 0) { err("--match must be channel:<name> or pattern:<regex>"); return; }
    const kind = match.slice(0, colonIdx);
    matchValue = match.slice(colonIdx + 1);
    if (kind === "channel") matchType = "channel";
    else if (kind === "pattern") matchType = "pattern";
    else { err(`Unknown match type: ${kind}`); return; }
  } else {
    err("Specify --match=channel:<name>, --match=pattern:<regex>, or --default"); return;
  }

  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "POST", "/api/routes", { match_type: matchType, match_value: matchValue, agent_name: agentName, priority });
    ok("Route added (live)");
  } else {
    const db = openDb();
    try {
      const r = db.addRoute(matchType, matchValue, agentName, priority);
      ok(`Route added (id=${r.id}, will activate on next start)`);
    } finally { db.close(); }
  }
}

async function routeList(): Promise<void> {
  const port = getApiPort();
  let routes: Array<{ id: number; priority: number; match_type: string; match_value: string | null; agent_name: string; enabled: boolean }>;

  if (await isServerRunning(port)) {
    routes = await apiCall(port, "GET", "/api/routes") as typeof routes;
  } else {
    const db = openDb();
    try {
      routes = db.listRoutes();
    } finally { db.close(); }
  }

  if (routes.length === 0) { out("No routes configured."); return; }
  out("ID   PRI  TYPE      MATCH              AGENT            ON");
  for (const r of routes) {
    out(`${String(r.id).padEnd(5)}${String(r.priority).padEnd(5)}${r.match_type.padEnd(10)}${(r.match_value ?? "-").padEnd(19)}${r.agent_name.padEnd(17)}${r.enabled ? "yes" : "no"}`);
  }
}

async function routeToggle(positional: string[], enable: boolean): Promise<void> {
  const id = Number(positional[2]);
  if (!id) { err(`Usage: car route ${enable ? "enable" : "disable"} <id>`); return; }
  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "POST", `/api/routes/${id}/${enable ? "enable" : "disable"}`);
    ok(`${enable ? "Enabled" : "Disabled"} route ${id} (live)`);
  } else {
    const db = openDb();
    try {
      const updated = db.updateRouteEnabled(id, enable);
      if (!updated) { err(`Route ${id} not found`); return; }
      ok(`${enable ? "Enabled" : "Disabled"} route ${id}`);
    } finally { db.close(); }
  }
}

async function routeRemove(positional: string[]): Promise<void> {
  const id = Number(positional[2]);
  if (!id) { err("Usage: car route remove <id>"); return; }
  const port = getApiPort();
  if (await isServerRunning(port)) {
    await apiCall(port, "DELETE", `/api/routes/${id}`);
    ok(`Removed route ${id} (live)`);
  } else {
    const db = openDb();
    try {
      db.removeRoute(id);
      ok(`Removed route ${id}`);
    } finally { db.close(); }
  }
}

// ── Config commands ──────────────────────────────────────────────────

function configSet(positional: string[]): void {
  const key = positional[2];
  const value = positional[3];
  if (!key || value === undefined) { err("Usage: car config set <key> <value>"); return; }
  const db = openDb();
  try {
    db.setSetting(key, value);
    ok(`Set ${key} = ${value}`);
  } finally { db.close(); }
}

function configGet(positional: string[]): void {
  const key = positional[2];
  if (!key) { err("Usage: car config get <key>"); return; }
  const db = openDb();
  try {
    const val = db.getSetting(key);
    out(val !== undefined ? `${key} = ${val}` : `${key} is not set`);
  } finally { db.close(); }
}

function configList(): void {
  const db = openDb();
  try {
    const settings = db.listSettings();
    if (settings.length === 0) { out("No settings configured."); return; }
    out("KEY                      VALUE");
    for (const s of settings) {
      out(`${s.key.padEnd(25)}${s.value}`);
    }
  } finally { db.close(); }
}

// ── Status command ───────────────────────────────────────────────────

async function status(): Promise<void> {
  const port = getApiPort();
  if (await isServerRunning(port)) {
    try {
      const health = await apiCall(port, "GET", "/api/health") as Record<string, unknown>;
      out(`Server: running (port ${port})`);
      out(`Uptime: ${health["uptime_seconds"]}s`);
      const agents = await apiCall(port, "GET", "/api/agents") as Array<{ name: string; type: string; enabled: boolean }>;
      out(`Agents: ${agents.length}`);
      for (const a of agents) out(`  ${a.name} (${a.type}) ${a.enabled ? "✓" : "✗"}`);
      const channels = await apiCall(port, "GET", "/api/channels") as Array<{ name: string; type: string; enabled: boolean }>;
      out(`Channels: ${channels.length}`);
      for (const c of channels) out(`  ${c.name} (${c.type}) ${c.enabled ? "✓" : "✗"}`);
    } catch (e) {
      err(`Failed to get status: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    out(`Server: not running (checked port ${port})`);
    const db = openDb();
    try {
      const agents = await db.listAgents();
      const channels = await db.listChannels();
      const routes = db.listRoutes();
      out(`DB: ${getDbPath()}`);
      out(`Agents: ${agents.length} configured`);
      out(`Channels: ${channels.length} configured`);
      out(`Routes: ${routes.length} configured`);
    } finally { db.close(); }
  }
}

// ── Help ─────────────────────────────────────────────────────────────

function printHelp(): void {
  out(`Chat Agent Relay (CAR) — Chat Platform <-> Agent Middleware

Usage: car <command> [subcommand] [options]

Commands:
  start                              Start the server

  channel add <name> --type=TYPE     Add a chat channel
  channel list                       List channels
  channel show <name>                Show channel details
  channel enable <name>              Enable a channel
  channel disable <name>             Disable a channel
  channel remove <name>              Remove a channel

  agent add <name> --endpoint=URL    Add an A2A agent
  agent list                         List agents
  agent show <name>                  Show agent details
  agent enable <name>                Enable an agent
  agent disable <name>               Disable an agent
  agent remove <name>                Remove an agent

  route add --agent=NAME [options]   Add a route rule
  route list                         List routes
  route enable <id>                  Enable a route
  route disable <id>                 Disable a route
  route remove <id>                  Remove a route

  config set <key> <value>           Set a configuration value
  config get <key>                   Get a configuration value
  config list                        List all settings

  status                             Show server and config status

Channel types: slack, discord, webchat, telegram, lark, dingtalk, teams, whatsapp

Agent type:    a2a (all agents connect via A2A protocol)

Agent options:
  --endpoint=URL       A2A agent endpoint (required)
  --timeout-ms=N       Request timeout in milliseconds (optional)

Environment:
  CAR_DB_PATH          SQLite database path (default: ./car.db)
  CAR_ENCRYPTION_KEY   Encryption key for sensitive fields
  CAR_API_PORT         API port for dual-mode detection (default: 3000)
  CAR_API_KEY          API key for management endpoint authentication
`);
}

// ── Main dispatch ────────────────────────────────────────────────────

async function cliMain(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv);
  const cmd = positional[0];
  const sub = positional[1];

  if (!cmd || flags["help"] !== undefined || flags["h"] !== undefined) {
    printHelp();
    return;
  }

  try {
    switch (cmd) {
      case "start": {
        const { main } = await import("./main");
        await main();
        break;
      }
      case "channel":
        switch (sub) {
          case "add": await channelAdd(positional, flags); break;
          case "list": await channelList(); break;
          case "show": await channelShow(positional); break;
          case "enable": await channelToggle(positional, true); break;
          case "disable": await channelToggle(positional, false); break;
          case "remove": await channelRemove(positional); break;
          default: err("Usage: car channel add|list|show|enable|disable|remove"); break;
        }
        break;
      case "agent":
        switch (sub) {
          case "add": await agentAdd(positional, flags); break;
          case "list": await agentList(); break;
          case "show": await agentShow(positional); break;
          case "enable": await agentToggle(positional, true); break;
          case "disable": await agentToggle(positional, false); break;
          case "remove": await agentRemove(positional); break;
          default: err("Usage: car agent add|list|show|enable|disable|remove"); break;
        }
        break;
      case "route":
        switch (sub) {
          case "add": await routeAdd(flags); break;
          case "list": await routeList(); break;
          case "enable": await routeToggle(positional, true); break;
          case "disable": await routeToggle(positional, false); break;
          case "remove": await routeRemove(positional); break;
          default: err("Usage: car route add|list|enable|disable|remove"); break;
        }
        break;
      case "config":
        switch (sub) {
          case "set": configSet(positional); break;
          case "get": configGet(positional); break;
          case "list": configList(); break;
          default: err("Usage: car config set|get|list"); break;
        }
        break;
      case "status":
        await status();
        break;
      default:
        err(`Unknown command: ${cmd}`);
        printHelp();
        break;
    }
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

cliMain();
