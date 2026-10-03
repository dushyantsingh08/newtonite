import { WorkItemStatus } from '@/types';
import { Ctx, isLead, isMember } from '@/server/authorization';

type Item = { status: WorkItemStatus, requesterId: string, assigneeId: string | null, requiresApproval: boolean };
type Who = 'assignee' | 'requester' | 'lead';
type Rule = { who: Who[]; reason?: true; when?: (i: Item) => boolean };

const hasAssignee = (i: Item) => i.assigneeId !== null;

const RULES: Record<WorkItemStatus, Partial<Record<WorkItemStatus, Rule>>> = {
  [WorkItemStatus.OPEN]: { 
    [WorkItemStatus.IN_PROGRESS]: { who: ['assignee', 'lead'], when: hasAssignee },
    [WorkItemStatus.CLOSED]:      { who: ['requester', 'lead'], reason: true } 
  },
  [WorkItemStatus.IN_PROGRESS]: { 
    [WorkItemStatus.BLOCKED]:          { who: ['assignee', 'lead'], reason: true },
    [WorkItemStatus.WAITING_APPROVAL]: { who: ['assignee', 'lead'], when: i => i.requiresApproval },
    [WorkItemStatus.RESOLVED]:         { who: ['assignee', 'lead'], when: i => !i.requiresApproval } 
  },
  [WorkItemStatus.BLOCKED]: { 
    [WorkItemStatus.IN_PROGRESS]: { who: ['assignee', 'lead'], when: hasAssignee },
    [WorkItemStatus.CLOSED]:      { who: ['lead'], reason: true } 
  },
  [WorkItemStatus.WAITING_APPROVAL]: { 
    [WorkItemStatus.IN_PROGRESS]: { who: ['assignee', 'lead'], reason: true } 
  },
  [WorkItemStatus.RESOLVED]: { 
    [WorkItemStatus.CLOSED]:      { who: ['assignee', 'lead'] },
    [WorkItemStatus.IN_PROGRESS]: { who: ['lead'], reason: true, when: hasAssignee } 
  },
  [WorkItemStatus.CLOSED]: { 
    [WorkItemStatus.OPEN]:        { who: ['lead'], reason: true } 
  },
};

export function canTransition(c: Ctx, i: Item, to: WorkItemStatus) {
  const rule = RULES[i.status][to];
  if (!rule || (rule.when && !rule.when(i)) || !isMember(c)) return { ok: false, needsReason: false };
  
  const ok = (rule.who.includes('lead') && isLead(c))
          || (rule.who.includes('assignee') && c.id === i.assigneeId)
          || (rule.who.includes('requester') && c.id === i.requesterId);
          
  return { ok, needsReason: !!rule.reason };
}

export const allowedTransitions = (c: Ctx, i: Item) =>
  (Object.keys(RULES[i.status]) as WorkItemStatus[]).filter(to => canTransition(c, i, to).ok);
