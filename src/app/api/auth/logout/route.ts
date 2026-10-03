import { NextResponse } from 'next/server';
import { withApiRoute } from '@/lib/api';
import { clearSession } from '@/server/auth';

export const POST = withApiRoute(async (req) => {
  await clearSession();
  return NextResponse.json({ success: true });
});
