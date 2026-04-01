import type { TeamsTokenManager, TeamsTokenResponse } from "./types";

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_LOGIN_BASE = "https://login.microsoftonline.com";
const BOT_FRAMEWORK_SCOPE = "https://api.botframework.com/.default";

export function createTeamsTokenManager(
  appId: string,
  appSecret: string,
  tenantId: string,
  options?: { loginBase?: string },
): TeamsTokenManager {
  const loginBase = (options?.loginBase ?? DEFAULT_LOGIN_BASE).replace(/\/$/, "");
  let cachedToken: string | undefined;
  let tokenExpiresAt = 0;

  return {
    async getToken(): Promise<string> {
      if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
      }

      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: appId,
        client_secret: appSecret,
        scope: BOT_FRAMEWORK_SCOPE,
      });

      const response = await fetch(`${loginBase}/${tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const payload = (await response.json()) as TeamsTokenResponse & { error?: string; error_description?: string };
      if (!response.ok || typeof payload.access_token !== "string") {
        throw new Error(payload.error_description ?? payload.error ?? "Teams token request failed");
      }

      cachedToken = payload.access_token;
      tokenExpiresAt = Date.now() + (payload.expires_in ?? 3600) * 1000 - TOKEN_REFRESH_MARGIN_MS;
      return cachedToken;
    },
  };
}
