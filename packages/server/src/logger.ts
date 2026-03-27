export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogContext = {
  correlation_id?: string;
  event_type?: string;
  duration_ms?: number;
  [key: string]: unknown;
};

function formatEntry(level: LogLevel, message: string, context?: LogContext): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) {
        entry[key] = value;
      }
    }
  }

  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, context?: LogContext): void {
    process.stdout.write(formatEntry("info", message, context) + "\n");
  },

  warn(message: string, context?: LogContext): void {
    process.stdout.write(formatEntry("warn", message, context) + "\n");
  },

  error(message: string, context?: LogContext): void {
    process.stderr.write(formatEntry("error", message, context) + "\n");
  },

  debug(message: string, context?: LogContext): void {
    if (process.env["CAR_LOG_LEVEL"] === "debug") {
      process.stdout.write(formatEntry("debug", message, context) + "\n");
    }
  },
};
