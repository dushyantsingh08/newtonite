import { NextResponse } from 'next/server';
import { requireAuth } from '@/server/auth';
import { withApiRoute } from '@/lib/api';
import { prisma } from '@/server/db';
import { getAuthorizedTeamIds } from '@/server/authorization';

export const GET = withApiRoute(async (req) => {
  const user = await requireAuth();
  const teamIds = await getAuthorizedTeamIds(user);

  const teams = await prisma.team.findMany({
    where: {
      id: { in: teamIds },
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ data: { items: teams, nextCursor: null } });
});
