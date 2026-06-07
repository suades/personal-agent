'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Task, AgentRun } from '@/lib/types';
import TabBar, { type Tab } from './TabBar';
import QueueTab from './QueueTab';
import NeedsYouTab from './NeedsYouTab';
import DoneTab from './DoneTab';
import AddTaskModal from './AddTaskModal';
import MetricsBar from './MetricsBar';

export default function Dashboard({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [tab, setTab] = useState<Tab>('queue');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lastRun, setLastRun] = useState<AgentRun | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let mounted = true;

    async function load() {
      const { data } = await supabase.from('tasks').select('*').order('sort_index').order('created_at');
      if (mounted && data) setTasks(data as Task[]);
      const { data: runs } = await supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(1);
      if (mounted && runs && runs[0]) setLastRun(runs[0] as AgentRun);
    }
    load();

    const channel = supabase
      .channel('tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, () => load())
      .subscribe();

    const cleanup = setInterval(() => setTasks(t => [...t]), 1000); // tick countdowns
    return () => { mounted = false; supabase.removeChannel(channel); clearInterval(cleanup); };
  }, []);

  const queued    = tasks.filter(t => t.status === 'queued');
  const needsYou  = tasks.filter(t => t.status === 'needs_confirmation');
  const done      = tasks.filter(t => t.status === 'done');

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = '/login';
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-24">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-xl font-semibold">ToDo Agent</h1>
          <p className="text-xs text-muted">{userEmail}</p>
        </div>
        <div className="flex gap-2">
          <a href="/workflows" className="text-xs text-muted hover:text-text">Workflows</a>
          <a href="/settings"  className="text-xs text-muted hover:text-text">Settings</a>
          <button onClick={signOut} className="text-xs text-muted hover:text-text">Sign out</button>
        </div>
      </header>

      <MetricsBar tasks={tasks} lastRun={lastRun} />
      <TabBar tab={tab} setTab={setTab} counts={{ queue: queued.length, needsYou: needsYou.length, done: done.length }} />

      <div className="mt-4">
        {tab === 'queue'    && <QueueTab tasks={queued} onAdd={() => setAdding(true)} />}
        {tab === 'needsYou' && <NeedsYouTab tasks={needsYou} />}
        {tab === 'done'     && <DoneTab tasks={done} />}
      </div>

      {tab === 'queue' && (
        <button onClick={() => setAdding(true)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent text-white rounded-full px-6 py-3 shadow-lg font-medium">
          + Add Task
        </button>
      )}

      {adding && <AddTaskModal userId={userId} onClose={() => setAdding(false)} />}
    </main>
  );
}
