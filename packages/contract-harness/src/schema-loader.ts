import { readFile } from "node:fs/promises";
import { ENVELOPE_SCHEMA_PATH, EXTENDED_SCHEMA_PATHS } from "./constants";
import { resolveRepoPath } from "./paths";

export type JsonSchema = Record<string, unknown>;

async function readJsonFile<T>(relativePath: string): Promise<T> {
  const filePath = resolveRepoPath(relativePath);
  const contents = await readFile(filePath, "utf8");

  return JSON.parse(contents) as T;
}

export async function loadEnvelopeSchema(): Promise<JsonSchema> {
  return readJsonFile<JsonSchema>(ENVELOPE_SCHEMA_PATH);
}

export async function loadSpecializedSchemas(): Promise<Record<string, JsonSchema>> {
  const entries = await Promise.all(
    Object.entries(EXTENDED_SCHEMA_PATHS).map(async ([eventType, schemaPath]) => {
      const schema = await readJsonFile<JsonSchema>(schemaPath);
      return [eventType, schema] as const;
    }),
  );

  return Object.fromEntries(entries);
}
