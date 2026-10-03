import { WorkItemStatus } from '@/types';
import { invalidTransitionError } from '@/lib/errors';

/**
 * Explicit workflow transition map.
 * Only transitions listed here are allowed. All others are rejected.
 */
const TRANSITION_MAP: Record<WorkItemStatus, WorkItemStatus[]> = {
  [WorkItemStatus.OPEN]: [
    WorkItemStatus.IN_PROGRESS,
    WorkItemStatus.BLOCKED,
    WorkItemStatus.WAITING_APPROVAL,
    WorkItemStatus.CLOSED,
  ],
  [WorkItemStatus.IN_PROGRESS]: [
    WorkItemStatus.BLOCKED,
    WorkItemStatus.WAITING_APPROVAL,
    WorkItemStatus.RESOLVED,
  ],
  [WorkItemStatus.BLOCKED]: [
    WorkItemStatus.IN_PROGRESS,
    WorkItemStatus.CLOSED,
  ],
  [WorkItemStatus.WAITING_APPROVAL]: [
    WorkItemStatus.IN_PROGRESS,
    WorkItemStatus.RESOLVED,
  ],
  [WorkItemStatus.RESOLVED]: [
    WorkItemStatus.CLOSED,
    WorkItemStatus.IN_PROGRESS, // Reopen
  ],
  [WorkItemStatus.CLOSED]: [
    WorkItemStatus.OPEN, // Reopen
  ],
};

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  const allowed = TRANSITION_MAP[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Get all valid transitions from a given status.
 */
export function getValidTransitions(from: WorkItemStatus): WorkItemStatus[] {
  return TRANSITION_MAP[from] || [];
}

/**
 * Validate a transition, throwing if invalid.
 */
export function validateTransition(from: WorkItemStatus, to: WorkItemStatus): void {
  if (!isValidTransition(from, to)) {
    throw invalidTransitionError(from, to);
  }
}
