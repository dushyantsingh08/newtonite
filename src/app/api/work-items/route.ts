import { NextResponse } from 'next/server';
import { requireAuth } from '@/server/auth';
import { withApiRoute, withIdempotency } from '@/lib/api';
import { createWorkItemSchema } from '@/lib/validation';
import { createWorkItem, listWorkItems } from '@/server/services/work-item.service';
import { WorkItemFilters, WorkItemStatus, WorkItemPriority } from '@/types';

export const GET = withApiRoute(async (req) => {
  const user = await requireAuth();
  const { searchParams } = new URL(req.url);

  const filters: WorkItemFilters = {
    search: searchParams.get('search') || undefined,
    status: searchParams.get('status') as WorkItemStatus || undefined,
    priority: searchParams.get('priority') as WorkItemPriority || undefined,
    teamId: searchParams.get('teamId') || undefined,
    assigneeId: searchParams.get('assigneeId') || undefined,
    mine: searchParams.get('mine') === 'true',
    attention: searchParams.get('attention') === 'true',
    overdue: searchParams.get('overdue') === 'true',
    unassigned: searchParams.get('unassigned') === 'true',
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
    cursor: searchParams.get('cursor') || undefined,
  };

  const result = await listWorkItems(user, filters);
  return NextResponse.json({ data: result });
});

export const POST = withIdempotency(async (req, context, parsedBody) => {
  const user = await requireAuth();
  const item = await createWorkItem(user, parsedBody);
  return { status: 201, data: { data: item } };
}, createWorkItemSchema);
