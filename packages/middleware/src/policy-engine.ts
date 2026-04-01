import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { PolicyDecision, PolicyFn } from "./types";

export type PolicyAction = "allow" | "deny";

export type PolicyCondition =
  | { type: "keyword"; pattern: string }
  | { type: "regex"; pattern: string }
  | { type: "sender"; value: string }
  | { type: "channel"; value: string }
  | { type: "content_length"; min?: number | undefined; max?: number | undefined }
  | { type: "time_window"; start: string; end: string }
  | { type: "and"; conditions: PolicyCondition[] }
  | { type: "or"; conditions: PolicyCondition[] }
  | { type: "not"; condition: PolicyCondition };

export type PolicyRule = {
  id: string;
  priority: number;
  condition: PolicyCondition;
  action: PolicyAction;
  mandatory?: boolean | undefined;
  reason?: string | undefined;
};

export type PolicyConfig = {
  rules: PolicyRule[];
  defaultDecision?: PolicyAction;
};

function getEventText(event: CanonicalEvent): string {
  return typeof event.payload["text"] === "string" ? event.payload["text"] : "";
}

function getSenderId(event: CanonicalEvent): string | undefined {
  const actor = event["actor"];
  if (typeof actor === "object" && actor !== null) {
    const actorId = (actor as Record<string, unknown>)["id"];
    if (typeof actorId === "string" && actorId.length > 0) return actorId;
  }
  const payloadUserId = event.payload["user_id"];
  return typeof payloadUserId === "string" && payloadUserId.length > 0 ? payloadUserId : undefined;
}

function minutesSinceMidnight(value: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Invalid time value: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function matchesCondition(event: CanonicalEvent, condition: PolicyCondition): boolean {
  const text = getEventText(event);

  switch (condition.type) {
    case "keyword":
      return text.toLowerCase().includes(condition.pattern.toLowerCase());
    case "regex":
      return new RegExp(condition.pattern, "i").test(text);
    case "sender":
      return getSenderId(event) === condition.value;
    case "channel":
      return event.channel === condition.value || event.channel_instance_id === condition.value;
    case "content_length": {
      const length = text.length;
      if (condition.min !== undefined && length < condition.min) return false;
      if (condition.max !== undefined && length > condition.max) return false;
      return true;
    }
    case "time_window": {
      const current = new Date(event.occurred_at);
      const currentMinutes = current.getUTCHours() * 60 + current.getUTCMinutes();
      const start = minutesSinceMidnight(condition.start);
      const end = minutesSinceMidnight(condition.end);
      return start <= end
        ? currentMinutes >= start && currentMinutes <= end
        : currentMinutes >= start || currentMinutes <= end;
    }
    case "and":
      return condition.conditions.every((child) => matchesCondition(event, child));
    case "or":
      return condition.conditions.some((child) => matchesCondition(event, child));
    case "not":
      return !matchesCondition(event, condition.condition);
  }
}

function sortRules(rules: PolicyRule[]): PolicyRule[] {
  return [...rules]
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      const mandatoryDelta = Number(b.rule.mandatory === true) - Number(a.rule.mandatory === true);
      if (mandatoryDelta !== 0) return mandatoryDelta;
      const priorityDelta = a.rule.priority - b.rule.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return a.index - b.index;
    })
    .map(({ rule }) => rule);
}

export function createPolicyFn(config: PolicyConfig): PolicyFn {
  const defaultDecision = config.defaultDecision ?? "allow";
  const sortedRules = sortRules(config.rules);

  return (event: CanonicalEvent): PolicyDecision => {
    for (const rule of sortedRules) {
      if (matchesCondition(event, rule.condition)) {
        return {
          decision: rule.action,
          reason: rule.reason ?? `matched_rule:${rule.id}`,
        };
      }
    }

    return { decision: defaultDecision };
  };
}

export function loadPolicyConfig(source?: string): PolicyConfig {
  if (!source) return { rules: [] };

  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Policy config must be a JSON object");
    }
    return validatePolicyConfig(parsed as Record<string, unknown>);
  } catch (error) {
    throw new Error(`Failed to parse policy config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validatePolicyConfig(raw: Record<string, unknown>): PolicyConfig {
  const rules = raw["rules"];
  if (!Array.isArray(rules)) throw new Error("Policy config must have a 'rules' array");

  const validated = rules.map((rule, index) => validateRule(rule, index));
  const defaultDecision = raw["defaultDecision"];
  if (defaultDecision !== undefined && defaultDecision !== "allow" && defaultDecision !== "deny") {
    throw new Error("'defaultDecision' must be 'allow' or 'deny'");
  }

  return {
    rules: validated,
    defaultDecision: (defaultDecision as PolicyAction | undefined) ?? "allow",
  };
}

function validateRule(rawRule: unknown, index: number): PolicyRule {
  if (!rawRule || typeof rawRule !== "object") throw new Error(`Rule ${index} must be an object`);
  const rule = rawRule as Record<string, unknown>;
  const id = rule["id"];
  if (typeof id !== "string" || id.length === 0) throw new Error(`Rule ${index} must have a non-empty 'id' string`);

  const action = rule["action"];
  if (action !== undefined && action !== "allow" && action !== "deny") {
    throw new Error(`Rule ${index} 'action' must be 'allow' or 'deny'`);
  }

  const priority = rule["priority"];
  if (priority !== undefined && (!Number.isFinite(priority) || typeof priority !== "number")) {
    throw new Error(`Rule ${index} 'priority' must be a finite number`);
  }

  return {
    id,
    priority: typeof priority === "number" ? priority : 0,
    condition: "condition" in rule
      ? validateCondition(rule["condition"], `Rule ${index} condition`)
      : validateLegacyCondition(rule, index),
    action: (action as PolicyAction | undefined) ?? "deny",
    mandatory: rule["mandatory"] === true,
    reason: typeof rule["reason"] === "string" ? rule["reason"] : undefined,
  };
}

function validateLegacyCondition(rule: Record<string, unknown>, index: number): PolicyCondition {
  const type = rule["type"];
  const pattern = rule["pattern"];
  if (type !== "keyword" && type !== "regex") {
    throw new Error(`Rule ${index} 'type' must be 'keyword' or 'regex'`);
  }
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(`Rule ${index} must have a non-empty 'pattern' string`);
  }
  if (type === "regex") {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Rule ${index} has invalid regex pattern: ${pattern}`);
    }
  }
  return { type, pattern };
}

function validateCondition(raw: unknown, path: string): PolicyCondition {
  if (!raw || typeof raw !== "object") throw new Error(`${path} must be an object`);
  const condition = raw as Record<string, unknown>;
  const type = condition["type"];

  switch (type) {
    case "keyword":
    case "regex": {
      const pattern = condition["pattern"];
      if (typeof pattern !== "string" || pattern.length === 0) throw new Error(`${path} must have a non-empty 'pattern' string`);
      if (type === "regex") {
        try { new RegExp(pattern); } catch { throw new Error(`${path} has invalid regex pattern: ${pattern}`); }
      }
      return { type, pattern };
    }
    case "sender":
    case "channel": {
      const value = condition["value"];
      if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must have a non-empty 'value' string`);
      return { type, value };
    }
    case "content_length": {
      const min = condition["min"];
      const max = condition["max"];
      if (min !== undefined && (!Number.isInteger(min) || (min as number) < 0)) throw new Error(`${path} 'min' must be a non-negative integer`);
      if (max !== undefined && (!Number.isInteger(max) || (max as number) < 0)) throw new Error(`${path} 'max' must be a non-negative integer`);
      if (min === undefined && max === undefined) throw new Error(`${path} requires 'min' or 'max'`);
      return { type, ...(typeof min === "number" ? { min } : {}), ...(typeof max === "number" ? { max } : {}) };
    }
    case "time_window": {
      const start = condition["start"];
      const end = condition["end"];
      if (typeof start !== "string" || typeof end !== "string") throw new Error(`${path} requires string 'start' and 'end'`);
      minutesSinceMidnight(start);
      minutesSinceMidnight(end);
      return { type, start, end };
    }
    case "and":
    case "or": {
      const conditions = condition["conditions"];
      if (!Array.isArray(conditions) || conditions.length === 0) throw new Error(`${path} requires a non-empty 'conditions' array`);
      return { type, conditions: conditions.map((child, index) => validateCondition(child, `${path}.conditions[${index}]`)) };
    }
    case "not": {
      if (!("condition" in condition)) throw new Error(`${path} requires 'condition'`);
      return { type, condition: validateCondition(condition["condition"], `${path}.condition`) };
    }
    default:
      throw new Error(`${path} has unknown condition type: ${String(type)}`);
  }
}
