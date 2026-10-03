'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Briefcase, LogOut, CheckCircle } from 'lucide-react';
import { SessionUser } from '@/types';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/me')
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(data => setUser(data.data))
      .catch(() => router.push('/login'));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-zinc-400" />
            <span className="text-lg font-bold">Operations Work Manager</span>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-sm">
              <span className="text-zinc-400">Logged in as </span>
              <span className="font-medium text-zinc-100">{user.name}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-zinc-400 hover:text-zinc-50">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl p-6">
        {children}
      </main>
    </div>
  );
}
