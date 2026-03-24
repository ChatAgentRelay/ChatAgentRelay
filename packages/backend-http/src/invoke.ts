import { ContractHarnessValidators } from "@cap/contract-harness";
import { buildBackendRequest } from "./build-request";
import { mapCompletedResponse } from "./map-response";
import type {
  BackendConfig,
  BackendResponse,
  InvocationContext,
  InvocationResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GenericHttpBackend {
  private readonly config: BackendConfig;
  private readonly validators: ContractHarnessValidators;

  private constructor(config: BackendConfig, validators: ContractHarnessValidators) {
    this.config = config;
    this.validators = validators;
  }

  static async create(config: BackendConfig): Promise<GenericHttpBackend> {
    const validators = await ContractHarnessValidators.create();
    return new GenericHttpBackend(config, validators);
  }

  async invoke(context: InvocationContext): Promise<InvocationResult> {
    const request = buildBackendRequest(context);
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      return {
        ok: false,
        requestId: request.request_id,
        error: {
          code: isTimeout ? "backend_timeout" : "backend_unavailable",
          message: isTimeout
            ? `Backend did not respond within ${timeoutMs}ms`
            : `Failed to reach backend: ${error instanceof Error ? error.message : "unknown error"}`,
          retryable: true,
          category: isTimeout ? "timeout" : "backend_unavailable",
        },
      };
    }

    if (!rawResponse.ok) {
      return {
        ok: false,
        requestId: request.request_id,
        error: {
          code: "backend_http_error",
          message: `Backend returned HTTP ${rawResponse.status}`,
          retryable: rawResponse.status >= 500,
          category: rawResponse.status >= 500 ? "dependency_failure" : "invalid_request",
        },
      };
    }

    let body: BackendResponse;
    try {
      body = (await rawResponse.json()) as BackendResponse;
    } catch {
      return {
        ok: false,
        requestId: request.request_id,
        error: {
          code: "invalid_response",
          message: "Backend returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (body.status === "failed") {
      return {
        ok: false,
        requestId: request.request_id,
        error: body.error,
      };
    }

    const event = mapCompletedResponse(context.invocationEvent, body);
    const validation = this.validators.validateEvent(event);

    if (!validation.ok) {
      return {
        ok: false,
        requestId: request.request_id,
        error: {
          code: "contract_violation",
          message: `Mapped response failed ${validation.failure.step} validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          retryable: false,
          category: "invalid_request",
        },
      };
    }

    return { ok: true, event, requestId: request.request_id };
  }
}
