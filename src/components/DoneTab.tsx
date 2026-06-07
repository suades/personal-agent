'use client';
import type { Task } from '@/lib/types';
import TaskCard from './TaskCard';
import { supabaseBrowser } from '@/lib/supabase/client';

function fmtCountdown(expiresAt: string | null) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring…';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export default function DoneTab({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <div className="text-center py-16 text-muted">No completed tasks in the last 10 minutes.</div>;
  }
  return (
    <div className="space-y-2">
      {tasks.map(task => (
        <TaskCard key={task.id} task={task}>
          {task.agent_note && (
            <div className="text-xs text-text bg-bg border border-border rounded-lg p-3 whitespace-pre-wrap">
              {task.agent_note}
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-muted">Expires in {fmtCountdown(task.expires_at)}</span>
            <Rate id={task.id} current={null} />
          </div>
        </TaskCard>
      ))}
    </div>
  );
}

function Rate({ id }: { id: string; current: number | null }) {
  async function rate(v: 1 | -1) {
    await supabaseBrowser().from('tasks').update({ rating: v }).eq('id', id);
  }
  return (
    <div className="flex gap-1">
      <button onClick={() => rate(1)}  className="text-xs px-2 py-0.5 rounded hover:bg-panel">👍</button>
      <button onClick={() => rate(-1)} className="text-xs px-2 py-0.5 rounded hover:bg-panel">👎</button>
    </div>
  );
}
