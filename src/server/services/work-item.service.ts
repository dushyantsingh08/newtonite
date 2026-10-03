import { prisma } from '@/server/db';
import { Prisma } from '@prisma/client';
import {
  SessionUser,
  WorkItemStatus,
  WorkItemPriority,
  ItemEventType,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  TransitionInput,
  WorkItemFilters,
  GlobalRole,
} from '@/types';
import {
  notFoundError,
  staleVersionError,
  assignmentConflictError,
  forbiddenError,
  selfApprovalError,
  validationError,
} from '@/lib/errors';
import {
  canViewWorkItem,
  canCreateWorkItem,
  canEditWorkItem,
  canClaimWorkItem,
  canTransition,
  canApprove,
  canChangePriority,
  getAuthorizedTeamIds,
  requireViewAccess,
  requireEditAccess,
} from '@/server/authorization';
import { validateTransition } from './workflow.service';

// ─── Includes for queries ────────────────────────────────────

const workItemIncludes = {
  team: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.WorkItemInclude;

// ─── Create ──────────────────────────────────────────────────

export async function createWorkItem(actor: SessionUser, input: CreateWorkItemInput) {
  const canCreate = await canCreateWorkItem(actor, input.teamId);
  if (!canCreate) {
    throw forbiddenError('You do not have permission to create work items in this team');
  }

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.workItem.create({
      data: {
        title: input.title,
        description: input.description,
        teamId: input.teamId,
        priority: input.priority,
        requesterId: actor.id,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        requiresApproval: input.requiresApproval ?? false,
        status: WorkItemStatus.OPEN,
        version: 1,
      },
      include: workItemIncludes,
    });

    await tx.itemEvent.create({
      data: {
        workItemId: item.id,
        actorId: actor.id,
        type: ItemEventType.CREATED,
        after: {
          title: item.title,
          description: item.description,
          status: item.status,
          priority: item.priority,
          teamId: item.teamId,
          requiresApproval: item.requiresApproval,
          dueAt: item.dueAt?.toISOString() ?? null,
        },
      },
    });

    return item;
  });

  return result;
}

// ─── Get by ID ───────────────────────────────────────────────

export async function getWorkItem(actor: SessionUser, id: string) {
  const item = await prisma.workItem.findUnique({
    where: { id },
    include: workItemIncludes,
  });

  if (!item) {
    throw notFoundError('Work item not found');
  }

  await requireViewAccess(actor, item);

  return item;
}

// ─── Update (PATCH) ──────────────────────────────────────────

export async function updateWorkItem(actor: SessionUser, id: string, input: UpdateWorkItemInput) {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw notFoundError('Work item not found');

  await requireEditAccess(actor, item);

  // Build update data — only include fields that were provided
  const updateData: Prisma.WorkItemUpdateInput = {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  if (input.title !== undefined && input.title !== item.title) {
    updateData.title = input.title;
    changes.title = { before: item.title, after: input.title };
  }
  if (input.description !== undefined && input.description !== item.description) {
    updateData.description = input.description;
    changes.description = { before: item.description, after: input.description };
  }
  if (input.priority !== undefined && input.priority !== item.priority) {
    const allowed = await canChangePriority(actor, item);
    if (!allowed) throw forbiddenError('You do not have permission to change priority');
    updateData.priority = input.priority;
    changes.priority = { before: item.priority, after: input.priority };
  }
  if (input.dueAt !== undefined) {
    const newDueAt = input.dueAt ? new Date(input.dueAt) : null;
    const oldDueAt = item.dueAt?.toISOString() ?? null;
    const newDueAtStr = newDueAt?.toISOString() ?? null;
    if (oldDueAt !== newDueAtStr) {
      updateData.dueAt = newDueAt;
      changes.dueAt = { before: oldDueAt, after: newDueAtStr };
    }
  }

  if (Object.keys(changes).length === 0) {
    // No changes — return current item
    return prisma.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Optimistic concurrency: compare-and-set
    const updated = await tx.workItem.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        ...updateData,
        version: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    if (updated.count === 0) {
      // Re-check if item exists to distinguish 404 from stale version
      const current = await tx.workItem.findUnique({ where: { id } });
      if (!current) throw notFoundError('Work item not found');
      throw staleVersionError(current.version);
    }

    // Determine event types to create
    const events: Prisma.ItemEventCreateManyInput[] = [];

    if (changes.priority) {
      events.push({
        workItemId: id,
        actorId: actor.id,
        type: ItemEventType.PRIORITY_CHANGED,
        before: changes.priority.before as Prisma.InputJsonValue,
        after: changes.priority.after as Prisma.InputJsonValue,
      });
    }

    if (changes.dueAt) {
      events.push({
        workItemId: id,
        actorId: actor.id,
        type: ItemEventType.DUE_DATE_CHANGED,
        before: changes.dueAt.before as Prisma.InputJsonValue,
        after: changes.dueAt.after as Prisma.InputJsonValue,
      });
    }

    // Generic UPDATED for title/description changes
    const fieldChanges: Record<string, unknown> = {};
    if (changes.title) fieldChanges.title = changes.title;
    if (changes.description) fieldChanges.description = changes.description;

    if (Object.keys(fieldChanges).length > 0) {
      events.push({
        workItemId: id,
        actorId: actor.id,
        type: ItemEventType.UPDATED,
        before: Object.fromEntries(
          Object.entries(fieldChanges).map(([k, v]) => [k, (v as { before: unknown }).before]),
        ),
        after: Object.fromEntries(
          Object.entries(fieldChanges).map(([k, v]) => [k, (v as { after: unknown }).after]),
        ),
      });
    }

    if (events.length > 0) {
      await tx.itemEvent.createMany({ data: events });
    }

    return tx.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  });

  return result;
}

// ─── Claim (atomic self-assignment) ──────────────────────────

export async function claimWorkItem(actor: SessionUser, id: string) {
  const item = await prisma.workItem.findUnique({
    where: { id },
    include: { assignee: { select: { id: true, name: true, email: true } } },
  });
  if (!item) throw notFoundError('Work item not found');

  const allowed = await canClaimWorkItem(actor, item);
  if (!allowed) throw notFoundError('Work item not found');

  // Idempotent: if already assigned to the current user, return success
  if (item.assigneeId === actor.id) {
    return prisma.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  }

  // If assigned to someone else, conflict
  if (item.assigneeId !== null) {
    throw assignmentConflictError(item.assignee?.name ?? undefined);
  }

  // Atomic conditional update: only succeed if still unassigned
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workItem.updateMany({
      where: {
        id,
        assigneeId: null, // Guard: must still be unassigned
      },
      data: {
        assigneeId: actor.id,
        version: { increment: 1 },
        lastActivityAt: new Date(),
        // Auto-transition to IN_PROGRESS if OPEN
        ...(item.status === WorkItemStatus.OPEN ? { status: WorkItemStatus.IN_PROGRESS } : {}),
      },
    });

    if (updated.count === 0) {
      // Someone else claimed it between our check and update
      const current = await tx.workItem.findUnique({
        where: { id },
        include: { assignee: { select: { name: true } } },
      });
      throw assignmentConflictError(current?.assignee?.name ?? undefined);
    }

    await tx.itemEvent.create({
      data: {
        workItemId: id,
        actorId: actor.id,
        type: ItemEventType.ASSIGNED,
        after: { assigneeId: actor.id },
        metadata: { action: 'claim' },
      },
    });

    // Also record status change if auto-transitioned
    if (item.status === WorkItemStatus.OPEN) {
      await tx.itemEvent.create({
        data: {
          workItemId: id,
          actorId: actor.id,
          type: ItemEventType.STATUS_CHANGED,
          before: WorkItemStatus.OPEN as unknown as Prisma.InputJsonValue,
          after: WorkItemStatus.IN_PROGRESS as unknown as Prisma.InputJsonValue,
          metadata: { reason: 'auto-transition on claim' },
        },
      });
    }

    return tx.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  });

  return result;
}

// ─── Status Transition ──────────────────────────────────────

export async function transitionWorkItem(actor: SessionUser, id: string, input: TransitionInput) {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw notFoundError('Work item not found');

  // Authorization
  const allowed = await canTransition(actor, item, input.to);
  if (!allowed) {
    const canView = await canViewWorkItem(actor, item);
    if (!canView) throw notFoundError('Work item not found');
    throw forbiddenError('You do not have permission to transition this work item');
  }

  // Validate workflow rules
  validateTransition(item.status, input.to);

  // Check approval requirement: if requires approval, don't allow RESOLVED without approval
  if (
    item.requiresApproval &&
    input.to === WorkItemStatus.RESOLVED &&
    !item.approvedById
  ) {
    // Allow if transitioning from WAITING_APPROVAL (implicit approval flow)
    if (item.status !== WorkItemStatus.WAITING_APPROVAL) {
      throw validationError('This work item requires approval before it can be resolved');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workItem.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: input.to,
        version: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.workItem.findUnique({ where: { id } });
      if (!current) throw notFoundError('Work item not found');
      throw staleVersionError(current.version);
    }

    const eventType = input.to === WorkItemStatus.OPEN && item.status === WorkItemStatus.CLOSED
      ? ItemEventType.REOPENED
      : ItemEventType.STATUS_CHANGED;

    await tx.itemEvent.create({
      data: {
        workItemId: id,
        actorId: actor.id,
        type: eventType,
        before: item.status as unknown as Prisma.InputJsonValue,
        after: input.to as unknown as Prisma.InputJsonValue,
      },
    });

    return tx.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  });

  return result;
}

// ─── Approve ─────────────────────────────────────────────────

export async function approveWorkItem(actor: SessionUser, id: string, expectedVersion: number) {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw notFoundError('Work item not found');

  const allowed = await canApprove(actor, item);
  if (!allowed) {
    const canView = await canViewWorkItem(actor, item);
    if (!canView) throw notFoundError('Work item not found');
    if (item.requesterId === actor.id) throw selfApprovalError();
    throw forbiddenError('You do not have permission to approve this work item');
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workItem.updateMany({
      where: { id, version: expectedVersion },
      data: {
        approvedById: actor.id,
        approvedAt: new Date(),
        version: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.workItem.findUnique({ where: { id } });
      if (!current) throw notFoundError('Work item not found');
      throw staleVersionError(current.version);
    }

    await tx.itemEvent.create({
      data: {
        workItemId: id,
        actorId: actor.id,
        type: ItemEventType.APPROVED,
        metadata: { approvedById: actor.id },
      },
    });

    return tx.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  });

  return result;
}

// ─── Unassign ────────────────────────────────────────────────

export async function unassignWorkItem(actor: SessionUser, id: string, expectedVersion: number) {
  const item = await prisma.workItem.findUnique({
    where: { id },
    include: { assignee: { select: { id: true, name: true } } },
  });
  if (!item) throw notFoundError('Work item not found');

  // Only admin, lead, or the assignee themselves can unassign
  if (actor.globalRole !== GlobalRole.ADMIN && item.assigneeId !== actor.id) {
    const { canViewWorkItem } = await import('@/server/authorization');
    const canView = await canViewWorkItem(actor, item);
    if (!canView) throw notFoundError('Work item not found');
    throw forbiddenError('You do not have permission to unassign this work item');
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workItem.updateMany({
      where: { id, version: expectedVersion },
      data: {
        assigneeId: null,
        version: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.workItem.findUnique({ where: { id } });
      if (!current) throw notFoundError('Work item not found');
      throw staleVersionError(current.version);
    }

    await tx.itemEvent.create({
      data: {
        workItemId: id,
        actorId: actor.id,
        type: ItemEventType.UNASSIGNED,
        before: { assigneeId: item.assigneeId, assigneeName: item.assignee?.name },
      },
    });

    return tx.workItem.findUnique({
      where: { id },
      include: workItemIncludes,
    });
  });

  return result;
}

// ─── List / Search / Filter ──────────────────────────────────

export async function listWorkItems(actor: SessionUser, filters: WorkItemFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);

  // Resource scoping: only return items from authorized teams
  const authorizedTeamIds = await getAuthorizedTeamIds(actor);

  if (authorizedTeamIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  // Build WHERE conditions
  const where: Prisma.WorkItemWhereInput = {
    teamId: { in: authorizedTeamIds },
  };

  // Filter by specific team (must be in authorized set)
  if (filters.teamId) {
    if (!authorizedTeamIds.includes(filters.teamId)) {
      return { items: [], nextCursor: null };
    }
    where.teamId = filters.teamId;
  }

  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.priority) {
    where.priority = filters.priority;
  }
  if (filters.assigneeId) {
    where.assigneeId = filters.assigneeId;
  }
  if (filters.mine) {
    where.assigneeId = actor.id;
  }
  if (filters.unassigned) {
    where.assigneeId = null;
  }
  if (filters.overdue) {
    where.dueAt = { lt: new Date() };
    where.status = { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] };
  }

  // Attention filter
  if (filters.attention) {
    where.OR = [
      { priority: WorkItemPriority.CRITICAL },
      { dueAt: { lt: new Date() }, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } },
      { status: WorkItemStatus.BLOCKED },
      { assigneeId: null, teamId: { in: authorizedTeamIds } },
      { status: WorkItemStatus.WAITING_APPROVAL },
    ];
  }

  // Full-text search using raw SQL for tsvector
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Cursor pagination
  const cursor = filters.cursor ? { id: filters.cursor } : undefined;

  const items = await prisma.workItem.findMany({
    where,
    include: workItemIncludes,
    orderBy: [
      { lastActivityAt: 'desc' },
      { id: 'asc' },
    ],
    take: limit + 1, // Fetch one extra to determine if there are more
    ...(cursor ? { cursor, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const resultItems = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? resultItems[resultItems.length - 1]?.id ?? null : null;

  return {
    items: resultItems,
    nextCursor,
  };
}

// ─── Dashboard Stats ─────────────────────────────────────────

export async function getDashboardStats(actor: SessionUser) {
  const authorizedTeamIds = await getAuthorizedTeamIds(actor);

  if (authorizedTeamIds.length === 0) {
    return {
      totalItems: 0,
      openItems: 0,
      myAssigned: 0,
      needsAttention: 0,
      critical: 0,
      overdue: 0,
      blocked: 0,
      unassigned: 0,
    };
  }

  const baseWhere: Prisma.WorkItemWhereInput = {
    teamId: { in: authorizedTeamIds },
  };

  const [
    totalItems,
    openItems,
    myAssigned,
    critical,
    overdue,
    blocked,
    unassigned,
    waitingApproval,
  ] = await Promise.all([
    prisma.workItem.count({ where: baseWhere }),
    prisma.workItem.count({ where: { ...baseWhere, status: { in: [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS] } } }),
    prisma.workItem.count({ where: { ...baseWhere, assigneeId: actor.id, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } } }),
    prisma.workItem.count({ where: { ...baseWhere, priority: WorkItemPriority.CRITICAL, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } } }),
    prisma.workItem.count({ where: { ...baseWhere, dueAt: { lt: new Date() }, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } } }),
    prisma.workItem.count({ where: { ...baseWhere, status: WorkItemStatus.BLOCKED } }),
    prisma.workItem.count({ where: { ...baseWhere, assigneeId: null, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } } }),
    prisma.workItem.count({ where: { ...baseWhere, status: WorkItemStatus.WAITING_APPROVAL } }),
  ]);

  return {
    totalItems,
    openItems,
    myAssigned,
    needsAttention: critical + overdue + blocked + unassigned + waitingApproval,
    critical,
    overdue,
    blocked,
    unassigned,
  };
}

// ─── Comment ─────────────────────────────────────────────────

export async function addComment(actor: SessionUser, workItemId: string, text: string) {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item) throw notFoundError('Work item not found');

  const canView = await canViewWorkItem(actor, item);
  if (!canView) throw notFoundError('Work item not found');

  // Any team member can comment (not just editors)
  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.itemEvent.create({
      data: {
        workItemId,
        actorId: actor.id,
        type: ItemEventType.COMMENTED,
        metadata: { text },
      },
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    // Update last activity
    await tx.workItem.update({
      where: { id: workItemId },
      data: { lastActivityAt: new Date() },
    });

    return event;
  });

  return result;
}
