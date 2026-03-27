import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { PolicyDecision, PolicyFn } from "./types";

export type PolicyRule = {
  id: string;
  type: "keyword" | "regex";
  pattern: string;
  action: "deny";
  reason?: string | undefined;
};

export type PolicyConfig = {
  rules: PolicyRule[];
  defaultDecision?: "allow" | "deny";
};

function matchesRule(text: string, rule: PolicyRule): boolean {
  if (rule.type === "keyword") {
    return text.toLowerCase().includes(rule.pattern.toLowerCase());
  }
  if (rule.type === "regex") {
    return new RegExp(rule.pattern, "i").test(text);
  }
  return false;
}

export function createPolicyFn(config: PolicyConfig): PolicyFn {
  const defaultDecision = config.defaultDecision ?? "allow";

  return (event: CanonicalEvent): PolicyDecision => {
    const text = (event.payload["text"] as string) ?? "";

    for (const rule of config.rules) {
      if (matchesRule(text, rule)) {
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
  if (!source) {
    return { rules: [] };
  }

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
  if (!Array.isArray(rules)) {
    throw new Error("Policy config must have a 'rules' array");
  }

  const validated: PolicyRule[] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>;
    if (!rule || typeof rule !== "object") {
      throw new Error(`Rule ${i} must be an object`);
    }

    const id = rule["id"];
    const type = rule["type"];
    const pattern = rule["pattern"];

    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Rule ${i} must have a non-empty 'id' string`);
    }
    if (type !== "keyword" && type !== "regex") {
      throw new Error(`Rule ${i} 'type' must be 'keyword' or 'regex'`);
    }
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new Error(`Rule ${i} must have a non-empty 'pattern' string`);
    }

    if (type === "regex") {
      try {
        new RegExp(pattern);
      } catch {
        throw new Error(`Rule ${i} has invalid regex pattern: ${pattern}`);
      }
    }

    validated.push({
      id,
      type,
      pattern,
      action: "deny",
      reason: typeof rule["reason"] === "string" ? rule["reason"] : undefined,
    });
  }

  const defaultDecision = raw["defaultDecision"];
  if (defaultDecision !== undefined && defaultDecision !== "allow" && defaultDecision !== "deny") {
    throw new Error("'defaultDecision' must be 'allow' or 'deny'");
  }

  return {
    rules: validated,
    defaultDecision: (defaultDecision as "allow" | "deny") ?? "allow",
  };
}
