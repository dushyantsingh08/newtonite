import {
  GlobalRole,
  TeamRole,
  WorkItemStatus,
  WorkItemPriority,
  ItemEventType,
} from '@prisma/client';

// Re-export Prisma enums
export {
  GlobalRole,
  TeamRole,
  WorkItemStatus,
  WorkItemPriority,
  ItemEventType,
};

// ─── API Response Types ──────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: {
    items: T[];
    nextCursor: string | null;
    totalCount?: number;
  };
}

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'ASSIGNMENT_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'APPROVAL_REQUIRED'
  | 'SELF_APPROVAL'
  | 'INTERNAL_ERROR'
  | 'ALREADY_ASSIGNED';

// ─── Auth Types ──────────────────────────────────────────────

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
}

export interface AuthenticatedRequest {
  user: SessionUser;
}

// ─── Work Item Types ─────────────────────────────────────────

export interface CreateWorkItemInput {
  title: string;
  description: string;
  teamId: string;
  priority: WorkItemPriority;
  dueAt?: string | null;
  requiresApproval?: boolean;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  dueAt?: string | null;
  expectedVersion: number;
}

export interface TransitionInput {
  to: WorkItemStatus;
  expectedVersion: number;
}

export interface ClaimInput {
  expectedVersion?: number;
}

export interface CommentInput {
  text: string;
}

export interface ApproveInput {
  expectedVersion: number;
}

// ─── Filter Types ────────────────────────────────────────────

export interface WorkItemFilters {
  search?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  teamId?: string;
  assigneeId?: string;
  mine?: boolean;
  attention?: boolean;
  overdue?: boolean;
  unassigned?: boolean;
  limit?: number;
  cursor?: string;
}

// ─── Dashboard Types ─────────────────────────────────────────

export interface DashboardStats {
  totalItems: number;
  openItems: number;
  myAssigned: number;
  needsAttention: number;
  critical: number;
  overdue: number;
  blocked: number;
  unassigned: number;
}

// ─── Work Item with relations ────────────────────────────────

export interface WorkItemWithRelations {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  teamId: string;
  requesterId: string;
  assigneeId: string | null;
  requiresApproval: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  dueAt: string | null;
  version: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  team: { id: string; name: string };
  requester: { id: string; name: string; email: string };
  assignee: { id: string; name: string; email: string } | null;
  approvedBy: { id: string; name: string; email: string } | null;
}

export interface ItemEventWithActor {
  id: string;
  workItemId: string;
  actorId: string;
  type: ItemEventType;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string };
}
