export type ConfigError = {
  field: string;
  message: string;
  hint?: string | undefined;
};

export function formatConfigErrors(errors: ConfigError[]): string {
  if (errors.length === 0) return "";
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
