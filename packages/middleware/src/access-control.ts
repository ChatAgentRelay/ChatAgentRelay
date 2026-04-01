export type AccessControlMode = "allowlist" | "blocklist";

export type AccessControlConfig = {
  mode: AccessControlMode;
  senders: string[];
};

export type AccessDecision = {
  allowed: boolean;
  reason?: string | undefined;
};

export function checkAccess(config: AccessControlConfig, senderId: string): AccessDecision {
  const match = config.senders.includes(senderId);

  if (config.mode === "allowlist") {
    return match
      ? { allowed: true }
      : { allowed: false, reason: `sender ${senderId} not in allowlist` };
  }

  return match
    ? { allowed: false, reason: `sender ${senderId} is blocklisted` }
    : { allowed: true };
}
