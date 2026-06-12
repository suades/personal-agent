'use client';
import { useState } from 'react';
import type { Task } from '@/lib/types';
import TaskCard from './TaskCard';
import StepsList from './StepsList';
import { supabaseBrowser } from '@/lib/supabase/client';
import { LinkifyText } from './LinkifyText';

function fmtCountdown(expiresAt: string | null) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export default function DoneTab({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-16 text-muted animate-fade-in">
        <p className="text-4xl mb-3">✅</p>
        <p>No completed tasks in the last 10 days.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {tasks.map(task => {
        const countdown = fmtCountdown(task.expires_at);
        return (
          <TaskCard
            key={task.id}
            task={task}
            isSubtask={Boolean(task.parent_task_id)}
            expandableContent={
              <div className="space-y-3">
                {task.agent_note && (
                  <div className="text-xs text-text bg-bg border border-border rounded-lg p-3">
                    <LinkifyText text={task.agent_note} />
                  </div>
                )}

                {task.agent_steps && task.agent_steps.length > 0 && (
                  <StepsList steps={task.agent_steps} />
                )}
              </div>
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted tabular-nums">
                {countdown === 'Expired' ? 'Expired' : countdown ? `Expires in ${countdown}` : ''}
              </span>
              <Rate task={task} />
            </div>
          </TaskCard>
        );
      })}
    </div>
  );
}

function Rate({ task }: { task: Task }) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [busy, setBusy] = useState(false);

  if (task.rating === -1 && task.user_feedback) {
    return <span className="text-[11px] text-muted">Feedback sent — the agent will learn from it</span>;
  }

  async function rate(v: 1 | -1) {
    if (v === -1) {
      setShowFeedback(true);
      return;
    }
    await supabaseBrowser().from('tasks').update({ rating: v }).eq('id', task.id);
  }

  async function submitFeedback() {
    setBusy(true);
    await supabaseBrowser().from('tasks').update({ rating: -1, user_feedback: feedback }).eq('id', task.id);
    setBusy(false);
    setShowFeedback(false);
  }

  if (showFeedback) {
    return (
      <div className="flex flex-col gap-2 w-full mt-2 animate-fade-in">
        <textarea
          autoFocus
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder="What went wrong? The agent will learn from this."
          className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent resize-none"
          rows={2}
        />
        <div className="flex justify-end gap-2">
          <button onClick={() => setShowFeedback(false)} className="text-[11px] text-muted">Cancel</button>
          <button disabled={busy || !feedback.trim()} onClick={submitFeedback}
            className="text-[11px] bg-accent text-white px-2.5 py-1 rounded disabled:opacity-50">Submit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <button onClick={() => rate(1)}
        className={`text-sm px-2 py-1 rounded-lg transition-all hover:bg-panel2 hover:scale-110 ${task.rating === 1 ? 'bg-panel2 ring-1 ring-low/50' : ''}`}>👍</button>
      <button onClick={() => rate(-1)}
        className={`text-sm px-2 py-1 rounded-lg transition-all hover:bg-panel2 hover:scale-110 ${task.rating === -1 ? 'bg-panel2 ring-1 ring-high/50' : ''}`}>👎</button>
    </div>
  );
}
