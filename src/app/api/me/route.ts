import { NextResponse } from 'next/server';
import { requireAuth } from '@/server/auth';
import { withApiRoute } from '@/lib/api';

export const GET = withApiRoute(async (req) => {
  const user = await requireAuth();
  return NextResponse.json({ data: user });
});
