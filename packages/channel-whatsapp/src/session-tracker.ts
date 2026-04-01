import type { WhatsAppSessionInfo, WhatsAppSessionTracker } from "./types";

export function createWhatsAppSessionTracker(): WhatsAppSessionTracker {
  const sessions = new Map<string, WhatsAppSessionInfo>();

  return {
    record(session: WhatsAppSessionInfo): void {
      sessions.set(session.recipient, session);
    },
    get(recipient: string): WhatsAppSessionInfo | undefined {
      return sessions.get(recipient);
    },
  };
}
