'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkItemPriority, WorkItemStatus, DashboardStats, ApiListResponse, WorkItemWithRelations } from '@/types';
import { format } from 'date-fns';

function fetchStats() {
  return fetch('/api/dashboard/stats').then(res => res.json()).then(data => data.data as DashboardStats);
}

function fetchWorkItems(search: string) {
  return fetch(`/api/work-items?${search}`).then(res => res.json()).then(data => data.data as ApiListResponse<WorkItemWithRelations>['data']);
}

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');

  const currentStatus = searchParams.get('status') || '';
  const currentPriority = searchParams.get('priority') || '';
  const currentFilter = searchParams.get('filter') || 'attention'; // mine, attention, unassigned, all

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 30000,
  });

  const queryParams = new URLSearchParams();
  if (searchTerm) queryParams.set('search', searchTerm);
  if (currentStatus) queryParams.set('status', currentStatus);
  if (currentPriority) queryParams.set('priority', currentPriority);
  if (currentFilter === 'mine') queryParams.set('mine', 'true');
  if (currentFilter === 'attention') queryParams.set('attention', 'true');
  if (currentFilter === 'unassigned') queryParams.set('unassigned', 'true');

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['work-items', queryParams.toString()],
    queryFn: () => fetchWorkItems(queryParams.toString()),
    refetchInterval: 5000, // Poll every 5 seconds to sync data automatically
  });

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/dashboard?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter('search', searchTerm);
  };

  return (
    <div className="space-y-8">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Needs Attention" value={stats.needsAttention} active={currentFilter === 'attention'} onClick={() => setFilter('filter', 'attention')} />
          <StatCard title="My Work" value={stats.myAssigned} active={currentFilter === 'mine'} onClick={() => setFilter('filter', 'mine')} />
          <StatCard title="Unassigned" value={stats.unassigned} active={currentFilter === 'unassigned'} onClick={() => setFilter('filter', 'unassigned')} />
          <StatCard title="All Open" value={stats.openItems} active={currentFilter === 'all'} onClick={() => setFilter('filter', 'all')} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-zinc-900 p-4 rounded-lg border border-zinc-800">
        <form onSubmit={handleSearch} className="flex-1 w-full max-w-sm flex gap-2">
          <Input 
            placeholder="Search work items..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>

        <div className="flex gap-4 items-center w-full md:w-auto overflow-x-auto">
          <select 
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
            value={currentStatus}
            onChange={(e) => setFilter('status', e.target.value)}
          >
            <option value="">All Statuses</option>
            {Object.values(WorkItemStatus).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          
          <select 
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
            value={currentPriority}
            onChange={(e) => setFilter('priority', e.target.value)}
          >
            <option value="">All Priorities</option>
            {Object.values(WorkItemPriority).map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <Link href="/dashboard/new">
            <Button>New Work Item</Button>
          </Link>
        </div>
      </div>

      {/* List */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-zinc-400">Loading work items...</div>
        ) : itemsData?.items.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <p className="text-zinc-400 text-lg">No work items found matching your filters.</p>
            <Button variant="link" onClick={() => router.push('/dashboard')}>Clear filters</Button>
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-950/50 text-zinc-400">
              <tr>
                <th className="px-6 py-3 font-medium">Title</th>
                <th className="px-6 py-3 font-medium">Team</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Priority</th>
                <th className="px-6 py-3 font-medium">Assignee</th>
                <th className="px-6 py-3 font-medium">Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {itemsData?.items.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 max-w-xs truncate">
                    <Link href={`/dashboard/items/${item.id}`} className="font-medium text-zinc-100 hover:underline">
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-zinc-300">{item.team.name}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                      {item.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.priority === 'CRITICAL' ? 'bg-red-900/50 text-red-400' :
                      item.priority === 'HIGH' ? 'bg-orange-900/50 text-orange-400' :
                      item.priority === 'MEDIUM' ? 'bg-blue-900/50 text-blue-400' :
                      'bg-zinc-800 text-zinc-400'
                    }`}>
                      {item.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-zinc-300">
                    {item.assignee?.name || <span className="text-zinc-500 italic">Unassigned</span>}
                  </td>
                  <td className="px-6 py-4 text-zinc-400">
                    {item.dueAt ? format(new Date(item.dueAt), 'MMM d, yyyy') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, active, onClick }: { title: string, value: number, active: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`rounded-lg border p-4 cursor-pointer transition-all ${
        active ? 'bg-zinc-800 border-zinc-500 ring-1 ring-zinc-500' : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80'
      }`}
    >
      <div className="text-sm font-medium text-zinc-400">{title}</div>
      <div className="mt-2 text-3xl font-bold text-zinc-50">{value}</div>
    </div>
  );
}
