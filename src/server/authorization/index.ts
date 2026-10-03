import { prisma } from '@/server/db';
import {
  SessionUser,
  GlobalRole,
  TeamRole,
  WorkItemStatus,
  WorkItemPriority,
} from '@/types';
import { forbiddenError, notFoundError } from '@/lib/errors';

/**
 * Cached team memberships for a user within a single request.
 * Avoids repeated DB lookups during a single API call.
 */
const membershipCache = new Map<string, Awaited<ReturnType<typeof getUserMemberships>>>();

export interface UserMembership {
  teamId: string;
  role: TeamRole;
}

/**
 * Get all team memberships for a user.
 */
export async function getUserMemberships(userId: string): Promise<UserMembership[]> {
  if (membershipCache.has(userId)) {
    return membershipCache.get(userId)!;
  }
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true, role: true },
  });
  membershipCache.set(userId, memberships);
  return memberships;
}

/**
 * Get user's role in a specific team. Returns null if not a member.
 */
export async function getUserTeamRole(userId: string, teamId: string): Promise<TeamRole | null> {
  const memberships = await getUserMemberships(userId);
  const m = memberships.find(m => m.teamId === teamId);
  return m?.role ?? null;
}

/**
 * Get team IDs that a user has access to.
 */
export async function getAuthorizedTeamIds(actor: SessionUser): Promise<string[]> {
  if (actor.globalRole === GlobalRole.ADMIN) {
    const teams = await prisma.team.findMany({ select: { id: true } });
    return teams.map(t => t.id);
  }
  const memberships = await getUserMemberships(actor.id);
  return memberships.map(m => m.teamId);
}

// ─── Work Item Authorization ─────────────────────────────────

type WorkItemForAuth = {
  id: string;
  teamId: string;
  requesterId: string;
  assigneeId: string | null;
  status: WorkItemStatus;
  requiresApproval: boolean;
};

/**
 * Can the actor view this work item?
 */
export async function canViewWorkItem(actor: SessionUser, item: WorkItemForAuth): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, item.teamId);
  return role !== null; // Any team role can view
}

/**
 * Can the actor create a work item in this team?
 */
export async function canCreateWorkItem(actor: SessionUser, teamId: string): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, teamId);
  return role === TeamRole.MEMBER || role === TeamRole.LEAD;
}

/**
 * Can the actor edit this work item (title, description, priority, dueAt)?
 */
export async function canEditWorkItem(actor: SessionUser, item: WorkItemForAuth): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, item.teamId);
  if (!role) return false;
  if (role === TeamRole.LEAD) return true;
  if (role === TeamRole.MEMBER) {
    // Members can edit items they requested or are assigned to
    return item.requesterId === actor.id || item.assigneeId === actor.id;
  }
  return false; // VIEWERs cannot edit
}

/**
 * Can the actor claim (self-assign) this work item?
 */
export async function canClaimWorkItem(actor: SessionUser, item: WorkItemForAuth): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, item.teamId);
  if (!role) return false;
  return role === TeamRole.MEMBER || role === TeamRole.LEAD;
}

/**
 * Can the actor assign this work item to another user?
 */
export async function canAssignWorkItem(
  actor: SessionUser,
  item: WorkItemForAuth,
  targetUserId: string,
): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, item.teamId);
  if (role !== TeamRole.LEAD) return false;
  // Target user must be a member of the team
  const targetRole = await getUserTeamRole(targetUserId, item.teamId);
  return targetRole !== null;
}

/**
 * Can the actor change the priority of this work item?
 */
export async function canChangePriority(actor: SessionUser, item: WorkItemForAuth): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, item.teamId);
  return role === TeamRole.LEAD || role === TeamRole.MEMBER;
}

/**
 * Can the actor transition this work item to a given status?
 */
export async function canTransition(
  actor: SessionUser,
  item: WorkItemForAuth,
  targetStatus: WorkItemStatus,
): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, item.teamId);
  if (!role || role === TeamRole.VIEWER) return false;

  // Members can transition items they're assigned to, or that they requested
  if (role === TeamRole.MEMBER) {
    return item.assigneeId === actor.id || item.requesterId === actor.id;
  }

  // LEADs can transition any item in their team
  return true;
}

/**
 * Can the actor approve this work item?
 */
export async function canApprove(actor: SessionUser, item: WorkItemForAuth): Promise<boolean> {
  if (!item.requiresApproval) return false;

  // Requester cannot approve their own item
  if (item.requesterId === actor.id) return false;

  if (actor.globalRole === GlobalRole.ADMIN) return true;

  const role = await getUserTeamRole(actor.id, item.teamId);
  return role === TeamRole.LEAD;
}

// ─── Team Authorization ──────────────────────────────────────

/**
 * Can the actor manage team memberships?
 */
export async function canManageTeam(actor: SessionUser, teamId: string): Promise<boolean> {
  if (actor.globalRole === GlobalRole.ADMIN) return true;
  const role = await getUserTeamRole(actor.id, teamId);
  return role === TeamRole.LEAD;
}

// ─── Authorization Guards ────────────────────────────────────

/**
 * Require view access to a work item. Returns 404 if not found or no access (prevents info leakage).
 */
export async function requireViewAccess(actor: SessionUser, item: WorkItemForAuth): Promise<void> {
  const allowed = await canViewWorkItem(actor, item);
  if (!allowed) {
    throw notFoundError('Work item not found');
  }
}

/**
 * Require edit access to a work item.
 */
export async function requireEditAccess(actor: SessionUser, item: WorkItemForAuth): Promise<void> {
  const canView = await canViewWorkItem(actor, item);
  if (!canView) throw notFoundError('Work item not found');
  const canEdit = await canEditWorkItem(actor, item);
  if (!canEdit) throw forbiddenError('You do not have permission to edit this work item');
}

/**
 * Clear the membership cache (call at the end of a request or after membership changes).
 */
export function clearAuthCache(): void {
  membershipCache.clear();
}
