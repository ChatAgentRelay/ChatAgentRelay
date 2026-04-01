export interface WebhookVerifier {
  verify(request: Request): Promise<boolean>;
}
