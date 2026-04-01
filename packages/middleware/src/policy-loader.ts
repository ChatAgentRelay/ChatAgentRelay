import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { loadPolicyConfig, type PolicyConfig } from "./policy-engine";

function parseYaml(content: string): unknown {
  const document = parseDocument(content, {
    merge: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }

  return document.toJS();
}

export function loadPolicyFromFile(filePath: string): PolicyConfig {
  const content = readFileSync(filePath, "utf-8");
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "json") {
    return loadPolicyConfig(content);
  }

  if (ext === "yaml" || ext === "yml") {
    const raw = parseYaml(content);
    return loadPolicyConfig(JSON.stringify(raw));
  }

  throw new Error(`Unsupported policy file format: ${ext ?? "unknown"}`);
}

export function loadPolicyWithOverride(filePath: string | undefined, source?: string): PolicyConfig {
  if (filePath) {
    return loadPolicyFromFile(filePath);
  }
  return loadPolicyConfig(source);
}
