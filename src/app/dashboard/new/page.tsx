'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkItemPriority, ApiListResponse } from '@/types';
import Link from 'next/link';

export default function NewWorkItemPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState('');
  const [priority, setPriority] = useState<WorkItemPriority>(WorkItemPriority.MEDIUM);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [error, setError] = useState('');

  const { data: teamsData, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => fetch('/api/teams').then(res => res.json()),
  });

  const teams = (teamsData?.data?.items || []) as { id: string, name: string }[];

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/work-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(), // Client generated key
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to create work item');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['work-items'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      router.push(`/dashboard/items/${data.data.id}`);
    },
    onError: (err: any) => {
      setError(err.message);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId) {
      setError('Please select a team');
      return;
    }
    
    createMutation.mutate({
      title,
      description,
      teamId,
      priority,
      requiresApproval,
    });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Create Work Item</h1>
        <Link href="/dashboard">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-sm">
        {error && (
          <div className="rounded bg-red-900/50 p-3 text-sm text-red-200 border border-red-800">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-zinc-300">Title</label>
            <Input 
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="mt-1"
              placeholder="E.g. System outage investigation"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-300">Description</label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              className="mt-1 flex min-h-[120px] w-full rounded-md border border-zinc-800 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
              placeholder="Provide details about this work item..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-zinc-300">Team</label>
              <select
                value={teamId}
                onChange={e => setTeamId(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              >
                <option value="" disabled>{teamsLoading ? 'Loading teams...' : 'Select a team'}</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-300">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as WorkItemPriority)}
                className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              >
                {Object.values(WorkItemPriority).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex items-center gap-2 pt-2">
            <input 
              type="checkbox" 
              id="requiresApproval"
              checked={requiresApproval}
              onChange={e => setRequiresApproval(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-800 bg-zinc-950 text-zinc-300 focus:ring-zinc-500"
            />
            <label htmlFor="requiresApproval" className="text-sm font-medium text-zinc-300">
              Requires approval before resolution
            </label>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Work Item'}
          </Button>
        </div>
      </form>
    </div>
  );
}
