import { NextResponse } from 'next/server';
import { requireAuth } from '@/server/auth';
import { withApiRoute, withIdempotency } from '@/lib/api';
import { updateWorkItemSchema } from '@/lib/validation';
import { getWorkItem, updateWorkItem } from '@/server/services/work-item.service';

export const GET = withApiRoute(async (req, { params }) => {
  const user = await requireAuth();
  const { id } = await params;
  const item = await getWorkItem(user, id);
  return NextResponse.json({ data: item });
});

export const PATCH = withIdempotency(async (req, { params }, parsedBody) => {
  const user = await requireAuth();
  const { id } = await params;
  const item = await updateWorkItem(user, id, parsedBody);
  return { status: 200, data: { data: item } };
}, updateWorkItemSchema);
