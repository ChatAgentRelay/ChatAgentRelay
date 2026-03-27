import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { buildBackendRequest } from "./build-request";
import { extractField } from "./extract-field";
import { mapCompletedResponse } from "./map-response";
import type {
  BackendConfig,
  BackendCompletedResponse,
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
    const useCustomBody = this.config.buildRequestBody !== undefined;
    const useCustomResponse = this.config.responseTextField !== undefined;

    const carRequest = buildBackendRequest(context);
    const requestId = carRequest.request_id;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const requestBody = useCustomBody
      ? this.config.buildRequestBody!(context.messageText, context.conversationHistory)
      : carRequest;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      return {
        ok: false,
        requestId,
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
        requestId,
        error: {
          code: "backend_http_error",
          message: `Backend returned HTTP ${rawResponse.status}`,
          retryable: rawResponse.status >= 500,
          category: rawResponse.status >= 500 ? "dependency_failure" : "invalid_request",
        },
      };
    }

    let body: unknown;
    try {
      body = await rawResponse.json();
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "Backend returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (useCustomResponse) {
      const text = extractField(body, this.config.responseTextField!);
      if (!text) {
        return {
          ok: false,
          requestId,
          error: {
            code: "empty_response",
            message: `Could not extract text at path "${this.config.responseTextField}" from backend response`,
            retryable: false,
            category: "dependency_failure",
          },
        };
      }

      const syntheticResponse: BackendCompletedResponse = {
        request_id: requestId,
        status: "completed",
        output: { text },
      };
      const event = mapCompletedResponse(context.invocationEvent, syntheticResponse);
      const validation = this.validators.validateEvent(event);
      if (!validation.ok) {
        return {
          ok: false,
          requestId,
          error: {
            code: "contract_violation",
            message: `Mapped response failed ${validation.failure.step} validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
            retryable: false,
            category: "invalid_request",
          },
        };
      }
      return { ok: true, event, requestId };
    }

    const typedBody = body as BackendResponse;

    if (typedBody.status === "failed") {
      return {
        ok: false,
        requestId,
        error: typedBody.error,
      };
    }

    const event = mapCompletedResponse(context.invocationEvent, typedBody);
    const validation = this.validators.validateEvent(event);

    if (!validation.ok) {
      return {
        ok: false,
        requestId,
        error: {
          code: "contract_violation",
          message: `Mapped response failed ${validation.failure.step} validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          retryable: false,
          category: "invalid_request",
        },
      };
    }

    return { ok: true, event, requestId };
  }
}
