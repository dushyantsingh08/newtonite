import { NextResponse } from 'next/server';
import { requireAuth } from '@/server/auth';
import { withApiRoute } from '@/lib/api';
import { getWorkItemHistory } from '@/server/services/history.service';

export const GET = withApiRoute(async (req, { params }) => {
  const user = await requireAuth();
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;
  const cursor = searchParams.get('cursor') || undefined;

  const result = await getWorkItemHistory(user, id, { limit, cursor });
  return NextResponse.json({ data: result });
});
