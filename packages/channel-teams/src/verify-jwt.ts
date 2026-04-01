import { createRemoteJWKSet, jwtVerify } from "jose";
import type { WebhookVerifier } from "@chat-agent-relay/contract-harness";

const DEFAULT_OPENID_CONFIG_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";

type OpenIdConfiguration = {
  issuer: string;
  jwks_uri: string;
};

export class TeamsWebhookVerifier implements WebhookVerifier {
  private jwksUriPromise?: Promise<URL>;
  private readonly openIdConfigUrl: string;

  constructor(
    private readonly appId: string,
    private readonly options?: {
      openIdConfigUrl?: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
      jwtVerifyFn?: typeof jwtVerify;
    },
  ) {
    this.openIdConfigUrl = options?.openIdConfigUrl ?? DEFAULT_OPENID_CONFIG_URL;
  }

  async verify(request: Request): Promise<boolean> {
    const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return false;

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return false;

    try {
      const jwksUri = await this.getJwksUri();
      const fetchImpl = this.options?.fetchImpl ?? fetch;
      const jwks = createRemoteJWKSet(jwksUri, { fetcher: fetchImpl as typeof globalThis.fetch });
      const nowSeconds = this.options?.now ? Math.floor(this.options.now() / 1000) : undefined;
      const openIdConfig = await this.getOpenIdConfiguration();

      const jwtVerifyFn = this.options?.jwtVerifyFn ?? jwtVerify;
      await jwtVerifyFn(token, jwks, {
        issuer: openIdConfig.issuer,
        audience: this.appId,
        currentDate: nowSeconds !== undefined ? new Date(nowSeconds * 1000) : undefined,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async getJwksUri(): Promise<URL> {
    if (!this.jwksUriPromise) {
      this.jwksUriPromise = this.getOpenIdConfiguration().then((config) => new URL(config.jwks_uri));
    }
    return this.jwksUriPromise;
  }

  private async getOpenIdConfiguration(): Promise<OpenIdConfiguration> {
    const fetchImpl = this.options?.fetchImpl ?? fetch;
    const response = await fetchImpl(this.openIdConfigUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Teams OpenID configuration: ${response.status}`);
    }

    const body = await response.json() as Partial<OpenIdConfiguration>;
    if (typeof body.issuer !== "string" || typeof body.jwks_uri !== "string") {
      throw new Error("Invalid Teams OpenID configuration");
    }
    return { issuer: body.issuer, jwks_uri: body.jwks_uri };
  }
}
