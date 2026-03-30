import type { ChannelPolicy, DmPolicy } from "./config";

export type AccessPolicyConfig = {
  dmPolicy: DmPolicy;
  channelPolicy: ChannelPolicy;
  channelAllowlist: string[];
};

export type AccessPolicyResult = {
  allowed: boolean;
  reason?: string;
};

export function checkAccessPolicy(
  channelType: string,
  channelId: string,
  config: AccessPolicyConfig,
): AccessPolicyResult {
  if (channelType === "im") {
    if (config.dmPolicy === "disabled") {
      return { allowed: false, reason: "DM processing is disabled" };
    }
    return { allowed: true };
  }

  switch (config.channelPolicy) {
    case "disabled":
      return { allowed: false, reason: "Channel processing is disabled" };
    case "allowlist":
      if (!config.channelAllowlist.includes(channelId)) {
        return { allowed: false, reason: `Channel ${channelId} is not in the allowlist` };
      }
      return { allowed: true };
    case "open":
    default:
      return { allowed: true };
  }
}
