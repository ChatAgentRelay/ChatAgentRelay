import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { type JsonSchema, loadEnvelopeSchema, loadSpecializedSchemas } from "./schema-loader";
import type { CanonicalEvent, ValidationIssue, ValidationResult } from "./types";

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    message: error.message ?? "validation failed",
    keyword: error.keyword,
    schemaPath: error.schemaPath,
  }));
}

export class UnknownEventTypeError extends Error {
  constructor(eventType: string) {
    super(`Unsupported event_type: ${eventType}`);
    this.name = "UnknownEventTypeError";
  }
}

export class ContractHarnessValidators {
  private readonly envelopeValidator: ValidateFunction;
  private readonly specializedValidators: Record<string, ValidateFunction>;

  private constructor(envelopeValidator: ValidateFunction, specializedValidators: Record<string, ValidateFunction>) {
    this.envelopeValidator = envelopeValidator;
    this.specializedValidators = specializedValidators;
  }

  static async create(): Promise<ContractHarnessValidators> {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    const envelopeSchema = await loadEnvelopeSchema();
    const specializedSchemas = await loadSpecializedSchemas();

    ajv.addSchema(envelopeSchema);

    const envelopeValidator = compileSchema(ajv, envelopeSchema, "envelope schema");
    const specializedValidators = Object.fromEntries(
      Object.entries(specializedSchemas).map(([eventType, schema]) => [
        eventType,
        compileSchema(ajv, schema, `${eventType} schema`),
      ]),
    );

    return new ContractHarnessValidators(envelopeValidator, specializedValidators);
  }

  resolveSpecializedValidator(eventType: string): ValidateFunction {
    const validator = this.specializedValidators[eventType];

    if (!validator) {
      throw new UnknownEventTypeError(eventType);
    }

    return validator;
  }

  validateEnvelope(event: CanonicalEvent): ValidationResult {
    const valid = this.envelopeValidator(event);

    if (valid) {
      return { ok: true };
    }

    return {
      ok: false,
      failure: {
        step: "envelope",
        issues: toIssues(this.envelopeValidator.errors),
      },
    };
  }

  validateSpecialized(event: CanonicalEvent): ValidationResult {
    const validator = this.resolveSpecializedValidator(event.event_type);
    const valid = validator(event);

    if (valid) {
      return { ok: true };
    }

    return {
      ok: false,
      failure: {
        step: "specialized",
        issues: toIssues(validator.errors),
      },
    };
  }

  validateEvent(event: CanonicalEvent): ValidationResult {
    const envelopeResult = this.validateEnvelope(event);

    if (!envelopeResult.ok) {
      return envelopeResult;
    }

    return this.validateSpecialized(event);
  }
}

function compileSchema(ajv: Ajv2020, schema: JsonSchema, label: string): ValidateFunction {
  const validator = ajv.compile(schema);

  if (!validator) {
    throw new Error(`Unable to compile ${label}`);
  }

  return validator;
}
