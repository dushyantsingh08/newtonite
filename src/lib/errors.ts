import { ErrorCode } from '@/types';

/**
 * Application error with a typed error code and HTTP status.
 * Used by services to signal business-rule failures that API routes
 * translate into structured JSON responses.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

// ─── Factory helpers ─────────────────────────────────────────

export function validationError(message: string, details?: Record<string, unknown>) {
  return new AppError('VALIDATION_ERROR', message, 400, details);
}

export function unauthorizedError(message = 'Authentication required') {
  return new AppError('UNAUTHORIZED', message, 401);
}

export function forbiddenError(message = 'You do not have permission to perform this action') {
  return new AppError('FORBIDDEN', message, 403);
}

export function notFoundError(message = 'Resource not found') {
  return new AppError('NOT_FOUND', message, 404);
}

export function staleVersionError(currentVersion?: number) {
  return new AppError(
    'STALE_VERSION',
    'This work item was modified by another user. Please refresh and try again.',
    409,
    currentVersion != null ? { currentVersion } : undefined,
  );
}

export function assignmentConflictError(assigneeName?: string) {
  return new AppError(
    'ASSIGNMENT_CONFLICT',
    assigneeName
      ? `This work item was claimed by ${assigneeName}.`
      : 'This work item has already been assigned.',
    409,
    assigneeName ? { assignedTo: assigneeName } : undefined,
  );
}

export function invalidTransitionError(from: string, to: string) {
  return new AppError(
    'INVALID_TRANSITION',
    `Cannot transition from ${from} to ${to}.`,
    400,
    { from, to },
  );
}

export function idempotencyConflictError() {
  return new AppError(
    'IDEMPOTENCY_CONFLICT',
    'The same idempotency key was used with a different request payload.',
    409,
  );
}

export function selfApprovalError() {
  return new AppError(
    'SELF_APPROVAL',
    'You cannot approve your own request.',
    403,
  );
}

export function approvalRequiredError() {
  return new AppError(
    'APPROVAL_REQUIRED',
    'This work item requires approval before it can be resolved.',
    400,
  );
}

export function internalError(message = 'An unexpected error occurred') {
  return new AppError('INTERNAL_ERROR', message, 500);
}
