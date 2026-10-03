import { prisma } from '@/server/db';
import { SessionUser, TeamRole, WorkItemStatus } from '@/types';

export type Ctx = { id: string; isAdmin: boolean; role: TeamRole | null };
type Item = { status: WorkItemStatus, requesterId: string, assigneeId: string | null, requiresApproval: boolean };

const ACTIVE: WorkItemStatus[] = [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS, WorkItemStatus.BLOCKED, WorkItemStatus.WAITING_APPROVAL];

export const isLead = (c: Ctx) => c.isAdmin || c.role === 'LEAD';
export const isMember = (c: Ctx) => isLead(c) || c.role === 'MEMBER';

export const policy = {
  view:     (c: Ctx) => c.isAdmin || c.role !== null,
  create:   (c: Ctx) => isMember(c),
  edit:     (c: Ctx, i: Item) => i.status !== WorkItemStatus.CLOSED &&
              (isLead(c) || (isMember(c) && (c.id === i.requesterId || c.id === i.assigneeId))),
  claim:    (c: Ctx, i: Item) => isMember(c) && ACTIVE.includes(i.status),
  assign:   (c: Ctx, i: Item, targetRole: TeamRole | null) =>
              isLead(c) && ACTIVE.includes(i.status) && (targetRole === 'MEMBER' || targetRole === 'LEAD'),
  unassign: (c: Ctx, i: Item) =>
              ACTIVE.includes(i.status) && (isLead(c) || (isMember(c) && c.id === i.assigneeId)),
  approve:  (c: Ctx, i: Item) => i.requiresApproval && i.status === WorkItemStatus.WAITING_APPROVAL && 
              (c.isAdmin || (isLead(c) && c.id !== i.requesterId && c.id !== i.assigneeId)),
  setApprovalRequired: (c: Ctx) => isLead(c),
  comment:  (c: Ctx) => c.isAdmin || c.role !== null, 
};

export async function ctxFor(user: SessionUser, teamId: string): Promise<Ctx> {
  // Global role should really be fetched from DB to prevent stale JWT bypass, but for now we trust session (or fetch if you prefer).
  // Fetching to be secure:
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { globalRole: true } });
  const isAdmin = dbUser?.globalRole === 'ADMIN';

  if (isAdmin) return { id: user.id, isAdmin: true, role: null };

  const m = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId: user.id, teamId } },
    select: { role: true }
  });
  return { id: user.id, isAdmin, role: m?.role ?? null };
}

export async function getAuthorizedTeamIds(user: SessionUser): Promise<string[]> {
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { globalRole: true } });
  if (dbUser?.globalRole === 'ADMIN') {
    const all = await prisma.team.findMany({ select: { id: true } });
    return all.map(t => t.id);
  }
  const memberships = await prisma.teamMembership.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  return memberships.map(m => m.teamId);
}
