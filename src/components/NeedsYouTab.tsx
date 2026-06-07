'use client';
import { useState } from 'react';
import type { Task } from '@/lib/types';
import TaskCard from './TaskCard';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function NeedsYouTab({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <div className="text-center py-16 text-muted">Nothing waiting on you. 🎉</div>;
  }
  return (
    <div className="space-y-2">
      {tasks.map(task => <ConfirmCard key={task.id} task={task} />)}
    </div>
  );
}

function ConfirmCard({ task }: { task: Task }) {
  const [busy, setBusy] = useState(false);
  const supabase = supabaseBrowser();

  async function approve() {
    setBusy(true);
    await supabase.from('tasks').update({ status: 'queued', confirmation_prompt: null }).eq('id', task.id);
    setBusy(false);
  }
  async function skip() {
    setBusy(true);
    await supabase.from('tasks').update({ status: 'skipped', agent_note: 'Skipped by user.' }).eq('id', task.id);
    setBusy(false);
  }
  async function flagUnneeded() {
    await supabase.from('tasks').update({ approval_needed_flag: false }).eq('id', task.id);
  }

  return (
    <TaskCard task={task}>
      {task.confirmation_prompt && (
        <div className="text-xs text-muted bg-bg border border-border rounded-lg p-3 mb-3 whitespace-pre-wrap">
          {task.confirmation_prompt}
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={busy} onClick={approve}
          className="flex-1 bg-accent text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">Approve</button>
        <button disabled={busy} onClick={skip}
          className="flex-1 bg-bg border border-border rounded-lg py-2 text-sm">Skip</button>
      </div>
      <button onClick={flagUnneeded} className="text-[11px] text-muted mt-2 hover:text-text">
        This didn't really need my approval →
      </button>
    </TaskCard>
  );
}
