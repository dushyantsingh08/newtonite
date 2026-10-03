import { Prisma } from '@prisma/client';
import { SessionUser, WorkItemPriority, WorkItemStatus, WorkItemWithRelations, ItemEventWithActor, WorkItemFilters, DashboardStats, ApiListResponse } from '@/types';
import { notFoundError, staleVersionError, assignmentConflictError, forbiddenError } from '@/lib/errors';
import { ctxFor, policy, isMember } from '@/server/authorization';
import { canTransition, allowedTransitions } from '@/server/services/workflow.service';

// Helper to get an item and assert view access
async function getAssertedItem(tx: Prisma.TransactionClient, user: SessionUser, id: string) {
  const item = await tx.workItem.findUnique({
    where: { id },
    include: { team: true, requester: true, assignee: true, approvedBy: true },
  });
  if (!item) throw notFoundError('Work item not found');
  const ctx = await ctxFor(user, item.teamId);
  if (!policy.view(ctx)) throw notFoundError('Work item not found');
  return { item, ctx };
}

export async function createWorkItem(
  tx: Prisma.TransactionClient,
  user: SessionUser, 
  data: { title: string; description: string; teamId: string; priority: WorkItemPriority; requiresApproval?: boolean }
) {
  const ctx = await ctxFor(user, data.teamId);
  if (!policy.create(ctx)) throw forbiddenError();

  const requiresApproval = data.requiresApproval && policy.setApprovalRequired(ctx);

  const item = await tx.workItem.create({
    data: {
      title: data.title,
      description: data.description,
      teamId: data.teamId,
      priority: data.priority,
      status: WorkItemStatus.OPEN,
      requesterId: user.id,
      requiresApproval: !!requiresApproval,
      events: {
        create: {
          actorId: user.id,
          type: 'CREATED',
        }
      }
    },
    include: { team: true, requester: true, assignee: true, approvedBy: true }
  });
  return item;
}

export async function claimWorkItem(tx: Prisma.TransactionClient, user: SessionUser, id: string) {
  const { item, ctx } = await getAssertedItem(tx, user, id);
  if (!policy.claim(ctx, item)) throw forbiddenError('Cannot claim this item');

  const updated = await tx.workItem.updateMany({
    where: { id, assigneeId: null, version: item.version, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'WAITING_APPROVAL'] } },
    data: {
      assigneeId: user.id,
      status: WorkItemStatus.IN_PROGRESS,
      version: { increment: 1 },
      lastActivityAt: new Date(),
    }
  });

  if (updated.count === 0) {
    const current = await tx.workItem.findUnique({ where: { id }, include: { assignee: true } });
    if (current?.assigneeId) throw assignmentConflictError(current.assignee?.name || 'Unknown');
    throw staleVersionError(current!.version);
  }

  await tx.itemEvent.createMany({
    data: [
      { workItemId: id, actorId: user.id, type: 'ASSIGNED' },
      { workItemId: id, actorId: user.id, type: 'STATUS_CHANGED', before: item.status, after: WorkItemStatus.IN_PROGRESS }
    ]
  });

  return getWorkItem(tx, user, id);
}

export async function updateWorkItem(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  id: string,
  data: { title?: string; description?: string; priority?: WorkItemPriority; expectedVersion: number }
) {
  const { item, ctx } = await getAssertedItem(tx, user, id);
  if (!policy.edit(ctx, item)) throw forbiddenError();

  const updateData: any = {
    version: { increment: 1 },
    lastActivityAt: new Date(),
  };
  if (data.title) updateData.title = data.title;
  if (data.description) updateData.description = data.description;
  if (data.priority) updateData.priority = data.priority;

  const updated = await tx.workItem.updateMany({
    where: { id, version: data.expectedVersion },
    data: updateData
  });

  if (updated.count === 0) {
    const current = await tx.workItem.findUnique({ where: { id } });
    throw staleVersionError(current!.version);
  }

  if (data.priority && data.priority !== item.priority) {
    await tx.itemEvent.create({
      data: { workItemId: id, actorId: user.id, type: 'PRIORITY_CHANGED', before: item.priority, after: data.priority }
    });
  }

  return getWorkItem(tx, user, id);
}

export async function transitionWorkItem(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  id: string,
  data: { to: WorkItemStatus; expectedVersion: number }
) {
  const { item, ctx } = await getAssertedItem(tx, user, id);
  const transition = canTransition(ctx, item, data.to);
  if (!transition.ok) throw forbiddenError('Transition not allowed');

  const updated = await tx.workItem.updateMany({
    where: { id, version: data.expectedVersion },
    data: {
      status: data.to,
      version: { increment: 1 },
      lastActivityAt: new Date(),
      // Clear approval if reopening
      ...(data.to === WorkItemStatus.IN_PROGRESS && (item.status === WorkItemStatus.RESOLVED || item.status === WorkItemStatus.CLOSED) 
          ? { approvedById: null, approvedAt: null } 
          : {})
    }
  });

  if (updated.count === 0) {
    const current = await tx.workItem.findUnique({ where: { id } });
    throw staleVersionError(current!.version);
  }

  await tx.itemEvent.create({
    data: {
      workItemId: id,
      actorId: user.id,
      type: data.to === WorkItemStatus.OPEN ? 'REOPENED' : 'STATUS_CHANGED',
      before: item.status,
      after: data.to,
    }
  });

  return getWorkItem(tx, user, id);
}

export async function approveWorkItem(tx: Prisma.TransactionClient, user: SessionUser, id: string, expectedVersion: number) {
  const { item, ctx } = await getAssertedItem(tx, user, id);
  if (!policy.approve(ctx, item)) throw forbiddenError('Cannot approve this item');

  const updated = await tx.workItem.updateMany({
    where: { id, version: expectedVersion, status: WorkItemStatus.WAITING_APPROVAL },
    data: {
      status: WorkItemStatus.RESOLVED,
      approvedById: user.id,
      approvedAt: new Date(),
      version: { increment: 1 },
      lastActivityAt: new Date(),
    }
  });

  if (updated.count === 0) {
    const current = await tx.workItem.findUnique({ where: { id } });
    throw staleVersionError(current!.version);
  }

  await tx.itemEvent.createMany({
    data: [
      { workItemId: id, actorId: user.id, type: 'APPROVED' },
      { workItemId: id, actorId: user.id, type: 'STATUS_CHANGED', before: WorkItemStatus.WAITING_APPROVAL, after: WorkItemStatus.RESOLVED }
    ]
  });

  return getWorkItem(tx, user, id);
}

export async function addComment(tx: Prisma.TransactionClient, user: SessionUser, id: string, text: string) {
  const { item, ctx } = await getAssertedItem(tx, user, id);
  if (!policy.comment(ctx)) throw forbiddenError();

  const event = await tx.itemEvent.create({
    data: {
      workItemId: id,
      actorId: user.id,
      type: 'COMMENTED',
      metadata: { text }
    }
  });
  
  await tx.workItem.update({
    where: { id },
    data: { lastActivityAt: new Date() }
  });

  return event;
}

export async function getWorkItem(tx: Prisma.TransactionClient, user: SessionUser, id: string) {
  const { item, ctx } = await getAssertedItem(tx, user, id);
  return {
    ...item,
    allowedTransitions: allowedTransitions(ctx, item)
  };
}

// Queries (can just use tx as prisma)
export async function listWorkItems(tx: Prisma.TransactionClient, user: SessionUser, filters: WorkItemFilters) {
  const ctxQuery = await ctxFor(user, ''); // Just checking admin
  const teamIds = ctxQuery.isAdmin ? 
    (await tx.team.findMany({ select: { id: true } })).map(t => t.id) : 
    (await tx.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true } })).map(m => m.teamId);

  const and: Prisma.WorkItemWhereInput[] = [{ teamId: { in: teamIds } }];
  
  const now = new Date();
  const ACTIVE = [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS, WorkItemStatus.BLOCKED, WorkItemStatus.WAITING_APPROVAL];
  
  const attentionWhere = {
    status: { in: ACTIVE },
    OR: [
      { priority: WorkItemPriority.CRITICAL },
      { dueAt: { lt: now } },
      { status: WorkItemStatus.BLOCKED },
      { assigneeId: null },
      { status: WorkItemStatus.WAITING_APPROVAL }
    ]
  };

  if (filters.attention) and.push(attentionWhere);
  if (filters.mine) and.push({ assigneeId: user.id, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } });
  if (filters.unassigned) and.push({ assigneeId: null, status: { in: ACTIVE } });
  if (filters.search) and.push({ OR: [{ title: { contains: filters.search, mode: 'insensitive' } }, { description: { contains: filters.search, mode: 'insensitive' } }] });
  if (filters.status) and.push({ status: filters.status });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.overdue) and.push({ dueAt: { lt: now }, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } });

  const items = await tx.workItem.findMany({
    where: { AND: and },
    include: { team: true, requester: true, assignee: true },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });

  return { items, nextCursor: null, totalCount: items.length };
}

export async function getDashboardStats(tx: Prisma.TransactionClient, user: SessionUser): Promise<DashboardStats> {
  const ctxQuery = await ctxFor(user, '');
  const teamIds = ctxQuery.isAdmin ? 
    (await tx.team.findMany({ select: { id: true } })).map(t => t.id) : 
    (await tx.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true } })).map(m => m.teamId);

  const baseWhere = { teamId: { in: teamIds } };
  const ACTIVE = [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS, WorkItemStatus.BLOCKED, WorkItemStatus.WAITING_APPROVAL];
  const now = new Date();

  const [needsAttention, myAssigned, unassigned, openItems] = await Promise.all([
    tx.workItem.count({
      where: {
        ...baseWhere,
        status: { in: ACTIVE },
        OR: [
          { priority: WorkItemPriority.CRITICAL },
          { dueAt: { lt: now } },
          { status: WorkItemStatus.BLOCKED },
          { assigneeId: null },
          { status: WorkItemStatus.WAITING_APPROVAL }
        ]
      }
    }),
    tx.workItem.count({ where: { ...baseWhere, assigneeId: user.id, status: { in: ACTIVE } } }),
    tx.workItem.count({ where: { ...baseWhere, assigneeId: null, status: { in: ACTIVE } } }),
    tx.workItem.count({ where: { ...baseWhere, status: { notIn: [WorkItemStatus.CLOSED, WorkItemStatus.RESOLVED] } } }),
  ]);

  return { needsAttention, myAssigned, unassigned, openItems };
}
