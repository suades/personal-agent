'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Task, AgentRun } from '@/lib/types';
import TabBar, { type Tab } from './TabBar';
import QueueTab from './QueueTab';
import NeedsYouTab from './NeedsYouTab';
import DoneTab from './DoneTab';
import AddTaskModal from './AddTaskModal';
import MetricsBar from './MetricsBar';
import AgentLiveView from './AgentLiveView';

const NAV_LINKS = [
  { href: '/analytics',   label: 'Analytics' },
  { href: '/preferences', label: 'Preferences' },
  { href: '/workflows',   label: 'Workflows' },
  { href: '/settings',    label: 'Settings' },
];

export default function Dashboard({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [tab, setTab] = useState<Tab>('queue');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lastRun, setLastRun] = useState<AgentRun | null>(null);
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // close the nav menu on outside tap
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [menuOpen]);

  const queued    = tasks.filter(t => t.status === 'queued' || t.status === 'in_progress');

  // Subtasks never appear (or count) as standalone cards in Needs You / Done —
  // they render nested inside their parent's card instead. A subtask only shows
  // standalone if its parent isn't around to host it.
  const needsYouAll = tasks.filter(t => t.status === 'needs_confirmation');
  const needsYou = needsYouAll.filter(t =>
    !t.parent_task_id || !needsYouAll.some(p => p.id === t.parent_task_id));
  const done = tasks.filter(t => t.status === 'done' &&
    (!t.parent_task_id || !tasks.some(p => p.id === t.parent_task_id)));

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = '/login';
  }

  const columns: { key: Tab; label: string; count: number; dot: string; body: React.ReactNode }[] = [
    { key: 'queue',    label: 'Queue',     count: queued.length,   dot: 'bg-accent',
      body: <QueueTab tasks={queued} onAdd={() => setAdding(true)} /> },
    { key: 'needsYou', label: 'Needs You', count: needsYou.length, dot: 'bg-medium',
      body: <NeedsYouTab tasks={needsYou} allTasks={tasks} /> },
    { key: 'done',     label: 'Done',      count: done.length,     dot: 'bg-low',
      body: <DoneTab tasks={done} /> },
  ];

  return (
    <main className="min-h-screen max-w-2xl lg:max-w-6xl mx-auto px-4 pb-28 lg:pb-10">
      <header className="sticky top-0 z-40 -mx-4 px-4 h-[60px] bg-bg/80 backdrop-blur-md border-b border-border/50 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">ToDo Agent</h1>
          <p className="text-[11px] text-muted truncate">{userEmail}</p>
        </div>

        {/* desktop nav */}
        <nav className="hidden sm:flex items-center gap-3">
          <button onClick={() => setAdding(true)}
            className="hidden lg:inline-block bg-accent hover:bg-accent/90 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors mr-1">
            + New task
          </button>
          {NAV_LINKS.map(l => (
            <a key={l.href} href={l.href} className="text-xs text-muted hover:text-text transition-colors">{l.label}</a>
          ))}
          <button onClick={signOut} className="text-xs text-muted hover:text-text transition-colors">Sign out</button>
        </nav>

        {/* mobile nav */}
        <div className="sm:hidden relative" ref={menuRef}>
          <button onClick={() => setMenuOpen(o => !o)} aria-label="Menu"
            className="text-muted hover:text-text px-2 py-1 text-lg leading-none">⋯</button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-40 bg-panel border border-border rounded-xl shadow-xl py-1 animate-fade-in z-50">
              {NAV_LINKS.map(l => (
                <a key={l.href} href={l.href}
                  className="block px-4 py-2.5 text-sm text-muted hover:text-text hover:bg-panel2 transition-colors">
                  {l.label}
                </a>
              ))}
              <button onClick={signOut}
                className="block w-full text-left px-4 py-2.5 text-sm text-muted hover:text-text hover:bg-panel2 transition-colors border-t border-border/50">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="pt-3">
        {lastRun?.status === 'running' && <AgentLiveView run={lastRun} />}
        <MetricsBar tasks={tasks} lastRun={lastRun} />
      </div>

      {/* phones & tablets: tabbed layout */}
      <div className="lg:hidden">
        <TabBar tab={tab} setTab={setTab} counts={{ queue: queued.length, needsYou: needsYou.length, done: done.length }} />
        <div className="mt-4">
          {columns.find(c => c.key === tab)?.body}
        </div>
      </div>

      {/* desktop: Trello-style 3-column board */}
      <div className="hidden lg:grid grid-cols-3 gap-5 items-start mt-1">
        {columns.map(col => (
          <section key={col.key} className="min-w-0">
            <h2 className="sticky top-[60px] z-30 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted bg-bg/80 backdrop-blur-md py-2.5 px-1 -mt-1">
              <span className={`w-1.5 h-1.5 rounded-full ${col.dot}`} />
              {col.label}
              <span className="ml-auto text-[10px] bg-panel border border-border rounded-full px-2 py-0.5 tabular-nums">{col.count}</span>
            </h2>
            <div className="mt-1">{col.body}</div>
          </section>
        ))}
      </div>

      {/* mobile FAB — desktop has the header button */}
      {tab === 'queue' && (
        <button onClick={() => setAdding(true)}
          className="lg:hidden fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-accent hover:bg-accent/90 text-white rounded-full px-6 py-3 shadow-lg shadow-accent/25 font-medium transition-all hover:scale-105 active:scale-95">
          + Add Task
        </button>
      )}

      {adding && <AddTaskModal userId={userId} onClose={() => setAdding(false)} />}
    </main>
  );
}
