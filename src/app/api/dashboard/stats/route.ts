import { NextResponse } from 'next/server';
import { requireAuth } from '@/server/auth';
import { withApiRoute } from '@/lib/api';
import { getDashboardStats } from '@/server/services/work-item.service';

export const GET = withApiRoute(async (req) => {
  const user = await requireAuth();
  const stats = await getDashboardStats(user);
  return NextResponse.json({ data: stats });
});
