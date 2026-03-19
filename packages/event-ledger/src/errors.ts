export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

export class LedgerDuplicateConflictError extends Error {
  constructor(eventId: string) {
    super(`Conflicting duplicate append attempt for event_id ${eventId}`);
    this.name = "LedgerDuplicateConflictError";
  }
}

export class LedgerNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerNotFoundError";
  }
}

export class LedgerAuditExplanationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerAuditExplanationError";
  }
}
