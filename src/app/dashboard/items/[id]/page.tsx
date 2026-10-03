'use client';

import { useState, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkItemWithRelations, ItemEventWithActor, WorkItemStatus, ApiListResponse } from '@/types';
import { format } from 'date-fns';
import Link from 'next/link';
import { ArrowLeft, UserPlus, CheckCircle, Clock, AlertCircle } from 'lucide-react';

export default function WorkItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  
  const [error, setError] = useState('');
  const [commentText, setCommentText] = useState('');

  // Fetch item
  const { data: itemData, isLoading: itemLoading } = useQuery({
    queryKey: ['work-item', id],
    queryFn: () => fetch(`/api/work-items/${id}`).then(res => {
      if (!res.ok) throw new Error('Failed to load item');
      return res.json();
    }),
    refetchInterval: 5000, // Poll every 5s for updates
  });

  const item: WorkItemWithRelations | undefined = itemData?.data;

  // Fetch history
  const { data: historyData } = useQuery({
    queryKey: ['work-item-history', id],
    queryFn: () => fetch(`/api/work-items/${id}/history`).then(res => res.json()),
    refetchInterval: 5000,
  });

  const history: ItemEventWithActor[] = historyData?.data?.items || [];

  // Mutations
  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['work-item', id] });
    queryClient.invalidateQueries({ queryKey: ['work-item-history', id] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const handleError = (err: any) => {
    setError(err.message || 'An error occurred');
    // If it's a stale version, invalidate to get latest
    if (err.message?.includes('modified by another user') || err.message?.includes('claimed')) {
      invalidateQueries();
    }
  };

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/work-items/${id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message);
    },
    onSuccess: () => { setError(''); invalidateQueries(); },
    onError: handleError,
  });

  const transitionMutation = useMutation({
    mutationFn: async (to: WorkItemStatus) => {
      const res = await fetch(`/api/work-items/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ to, expectedVersion: item?.version }),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message);
    },
    onSuccess: () => { setError(''); invalidateQueries(); },
    onError: handleError,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/work-items/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: item?.version }),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message);
    },
    onSuccess: () => { setError(''); invalidateQueries(); },
    onError: handleError,
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/work-items/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ text: commentText }),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message);
    },
    onSuccess: () => { 
      setError(''); 
      setCommentText(''); 
      invalidateQueries(); 
    },
    onError: handleError,
  });

  if (itemLoading) {
    return <div className="text-zinc-400 p-8">Loading work item...</div>;
  }

  if (!item) {
    return (
      <div className="p-8 text-center">
        <p className="text-zinc-400 mb-4">Work item not found or you don't have permission to view it.</p>
        <Link href="/dashboard"><Button variant="outline">Back to Dashboard</Button></Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Main Content */}
      <div className="lg:col-span-2 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <h1 className="text-2xl font-bold text-zinc-100">{item.title}</h1>
        </div>

        {error && (
          <div className="rounded bg-red-900/50 p-4 text-sm text-red-200 border border-red-800 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Action Failed</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Description</h3>
            <div className="text-zinc-200 whitespace-pre-wrap">{item.description}</div>
          </div>

          <div className="flex flex-wrap gap-4 pt-4 border-t border-zinc-800">
            {/* Action Buttons based on status */}
            {!item.assigneeId && (
              <Button onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}>
                <UserPlus className="mr-2 h-4 w-4" />
                Claim & Start
              </Button>
            )}

            {item.assigneeId && item.status === WorkItemStatus.OPEN && (
              <Button onClick={() => transitionMutation.mutate(WorkItemStatus.IN_PROGRESS)} disabled={transitionMutation.isPending}>
                Start Work
              </Button>
            )}

            {item.status === WorkItemStatus.IN_PROGRESS && (
              <>
                {item.requiresApproval ? (
                  <Button onClick={() => transitionMutation.mutate(WorkItemStatus.WAITING_APPROVAL)} disabled={transitionMutation.isPending}>
                    Request Approval
                  </Button>
                ) : (
                  <Button onClick={() => transitionMutation.mutate(WorkItemStatus.RESOLVED)} variant="default" disabled={transitionMutation.isPending}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Mark Resolved
                  </Button>
                )}
                <Button onClick={() => transitionMutation.mutate(WorkItemStatus.BLOCKED)} variant="outline" disabled={transitionMutation.isPending}>
                  Block
                </Button>
              </>
            )}

            {item.status === WorkItemStatus.WAITING_APPROVAL && !item.approvedById && (
              <Button onClick={() => approveMutation.mutate()} variant="secondary" disabled={approveMutation.isPending}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve
              </Button>
            )}

            {item.status === WorkItemStatus.WAITING_APPROVAL && item.approvedById && (
              <Button onClick={() => transitionMutation.mutate(WorkItemStatus.RESOLVED)} disabled={transitionMutation.isPending}>
                Mark Resolved (Approved)
              </Button>
            )}

            {item.status === WorkItemStatus.RESOLVED && (
              <Button onClick={() => transitionMutation.mutate(WorkItemStatus.CLOSED)} disabled={transitionMutation.isPending}>
                Close Item
              </Button>
            )}
          </div>
        </div>

        {/* History Timeline */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-zinc-100">Activity & Comments</h3>
          
          <form onSubmit={(e) => { e.preventDefault(); commentMutation.mutate(); }} className="flex gap-2">
            <Input 
              placeholder="Add a comment..." 
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              className="bg-zinc-900 border-zinc-800"
            />
            <Button type="submit" disabled={!commentText.trim() || commentMutation.isPending}>Comment</Button>
          </form>

          <div className="space-y-4 pt-4">
            {history.map((event) => (
              <div key={event.id} className="flex gap-4 text-sm">
                <div className="flex-none pt-1 text-zinc-500">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium text-zinc-200">{event.actor.name}</span>
                    <span className="text-xs text-zinc-500">{format(new Date(event.createdAt), 'MMM d, h:mm a')}</span>
                  </div>
                  
                  {event.type === 'COMMENTED' && (
                    <div className="text-zinc-300">{(event.metadata as any)?.text}</div>
                  )}
                  
                  {event.type === 'STATUS_CHANGED' && (
                    <div className="text-zinc-400">
                      Changed status from <span className="font-medium text-zinc-300">{(event.before as string)?.replace('_', ' ')}</span> to <span className="font-medium text-zinc-300">{(event.after as string)?.replace('_', ' ')}</span>
                    </div>
                  )}

                  {event.type === 'ASSIGNED' && (
                    <div className="text-zinc-400">Claimed this work item</div>
                  )}

                  {event.type === 'CREATED' && (
                    <div className="text-zinc-400">Created the work item</div>
                  )}
                  
                  {event.type === 'APPROVED' && (
                    <div className="text-green-400">Approved the work item</div>
                  )}

                  {event.type === 'PRIORITY_CHANGED' && (
                    <div className="text-zinc-400">
                      Changed priority from {(event.before as string)} to {(event.after as string)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sidebar Metadata */}
      <div className="space-y-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 shadow-sm space-y-4 text-sm">
          <h3 className="font-semibold text-zinc-100 text-base border-b border-zinc-800 pb-2 mb-4">Details</h3>
          
          <div className="grid grid-cols-2 gap-y-4">
            <div className="text-zinc-500">Status</div>
            <div>
              <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                {item.status.replace('_', ' ')}
              </span>
            </div>

            <div className="text-zinc-500">Priority</div>
            <div className="font-medium text-zinc-300">{item.priority}</div>

            <div className="text-zinc-500">Team</div>
            <div className="text-zinc-300">{item.team.name}</div>

            <div className="text-zinc-500">Requester</div>
            <div className="text-zinc-300">{item.requester.name}</div>

            <div className="text-zinc-500">Assignee</div>
            <div className="text-zinc-300">{item.assignee?.name || 'Unassigned'}</div>

            <div className="text-zinc-500">Approval Required</div>
            <div className="text-zinc-300">{item.requiresApproval ? 'Yes' : 'No'}</div>
            
            {item.requiresApproval && item.approvedById && (
              <>
                <div className="text-zinc-500">Approved By</div>
                <div className="text-green-400">{item.approvedBy?.name}</div>
              </>
            )}

            <div className="text-zinc-500">Last Active</div>
            <div className="text-zinc-300">{format(new Date(item.lastActivityAt), 'MMM d, h:mm a')}</div>
            
            <div className="text-zinc-500">Version</div>
            <div className="text-zinc-500 font-mono text-xs">{item.version}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
