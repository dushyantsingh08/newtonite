import { prisma } from '@/server/db';
import { SessionUser } from '@/types';
import { notFoundError } from '@/lib/errors';
import { canViewWorkItem } from '@/server/authorization';

/**
 * Get paginated history (events) for a work item.
 * Uses cursor-based pagination on (workItemId, id).
 */
export async function getWorkItemHistory(
  actor: SessionUser,
  workItemId: string,
  options: { limit?: number; cursor?: string } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  // Check the work item exists and user has access
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId },
    select: { id: true, teamId: true, requesterId: true, assigneeId: true, status: true, requiresApproval: true },
  });

  if (!item) {
    throw notFoundError('Work item not found');
  }

  const canView = await canViewWorkItem(actor, item);
  if (!canView) {
    throw notFoundError('Work item not found');
  }

  const cursor = options.cursor ? { id: options.cursor } : undefined;

  const events = await prisma.itemEvent.findMany({
    where: { workItemId },
    include: {
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
  });

  const hasMore = events.length > limit;
  const resultEvents = hasMore ? events.slice(0, limit) : events;
  const nextCursor = hasMore ? resultEvents[resultEvents.length - 1]?.id ?? null : null;

  return {
    items: resultEvents,
    nextCursor,
  };
}
