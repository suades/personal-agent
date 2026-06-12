'use client';
import { useState } from 'react';
import type { Task } from '@/lib/types';
import TaskCard from './TaskCard';
import StepsList from './StepsList';
import { supabaseBrowser } from '@/lib/supabase/client';
import { LinkifyText } from './LinkifyText';

export default function NeedsYouTab({ tasks, allTasks }: { tasks: Task[]; allTasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-16 text-muted animate-fade-in">
        <p className="text-4xl mb-3">🎉</p>
        <p>Nothing waiting on you.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {tasks.map(task => (
        <ConfirmCard key={task.id} task={task}
          subtasks={allTasks.filter(t => t.parent_task_id === task.id).sort((a, b) => a.sort_index - b.sort_index)} />
      ))}
    </div>
  );
}

/** Re-queue a task; if the user typed guidance, fold it into the description so the planner sees it. */
async function approveTask(task: Task, advice: string) {
  const supabase = supabaseBrowser();
  const updates: Record<string, unknown> = { status: 'queued', confirmation_prompt: null };
  if (advice.trim()) {
    updates.description = `${task.description ?? ''}\n\n[User guidance]: ${advice.trim()}`.trim();
  }
  await supabase.from('tasks').update(updates).eq('id', task.id);
}

function GuidanceBox({ advice, setAdvice }: { advice: string; setAdvice: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open && !advice) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-[11px] text-accent hover:underline mb-2 block">
        💬 Add guidance before approving
      </button>
    );
  }
  return (
    <textarea
      autoFocus={open}
      value={advice}
      onChange={e => setAdvice(e.target.value)}
      placeholder='Tell the agent how to do it this time… e.g. "Use Kayak, any weekend in July works, don&apos;t book anything"'
      className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent resize-none mb-2 animate-fade-in"
      rows={2}
    />
  );
}

function ConfirmCard({ task, subtasks }: { task: Task; subtasks: Task[] }) {
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState('');
  const supabase = supabaseBrowser();

  const pendingSubs = subtasks.filter(t => t.status === 'needs_confirmation');
  const doneSubs = subtasks.filter(t => t.status === 'done');

  async function approve() {
    setBusy(true);
    await approveTask(task, advice);
    // re-queue stalled subtasks too — one tap resumes the whole tree
    if (pendingSubs.length > 0) {
      await supabase.from('tasks').update({ status: 'queued', confirmation_prompt: null })
        .eq('parent_task_id', task.id).eq('status', 'needs_confirmation');
    }
    setBusy(false);
  }
  async function skip() {
    setBusy(true);
    await supabase.from('tasks').update({ status: 'skipped', agent_note: 'Skipped by user.' }).eq('id', task.id);
    if (subtasks.length > 0) {
      await supabase.from('tasks').update({ status: 'skipped', agent_note: 'Skipped with parent task.' })
        .eq('parent_task_id', task.id).in('status', ['queued', 'needs_confirmation']);
    }
    setBusy(false);
  }
  async function flagUnneeded() {
    await supabase.from('tasks').update({ approval_needed_flag: false }).eq('id', task.id);
  }

  return (
    <TaskCard task={task} isSubtask={Boolean(task.parent_task_id)}>
      {task.confirmation_prompt && (
        <div className="text-xs text-text bg-accent-soft/40 border border-accent/30 rounded-lg p-3 mb-3">
          <LinkifyText text={task.confirmation_prompt} />
        </div>
      )}
      {task.agent_note && (
        <div className="text-xs text-muted bg-bg border border-border rounded-lg p-3 mb-3">
          <LinkifyText text={task.agent_note} />
        </div>
      )}
      {task.agent_steps && task.agent_steps.length > 0 && (
        <div className="mb-3">
          <StepsList steps={task.agent_steps} />
        </div>
      )}

      {subtasks.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] uppercase tracking-wider text-muted mb-1.5">
            Subtasks · {doneSubs.length}/{subtasks.length} done
          </p>
          <div className="space-y-1.5 border-l-2 border-border/60 pl-2">
            {subtasks.map(sub => <SubtaskRow key={sub.id} task={sub} />)}
          </div>
        </div>
      )}

      <GuidanceBox advice={advice} setAdvice={setAdvice} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={approve}
          className="flex-1 bg-accent hover:bg-accent/90 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
          {pendingSubs.length > 0 ? 'Approve all' : 'Approve'}
        </button>
        <button disabled={busy} onClick={skip}
          className="flex-1 bg-bg border border-border hover:border-muted rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors">
          Skip
        </button>
      </div>
      <button onClick={flagUnneeded} className="text-[11px] text-muted mt-2 hover:text-text transition-colors">
        This didn&apos;t really need my approval →
      </button>
    </TaskCard>
  );
}

const subStatusChip: Record<string, { label: string; cls: string }> = {
  done:               { label: '✓ done',       cls: 'bg-low/15 text-low' },
  needs_confirmation: { label: '⏸ needs you',  cls: 'bg-medium/15 text-medium' },
  in_progress:        { label: 'running',      cls: 'bg-accent-soft text-accent' },
  queued:             { label: 'queued',       cls: 'bg-panel2 text-muted' },
  skipped:            { label: 'skipped',      cls: 'bg-panel2 text-muted' },
};

function SubtaskRow({ task }: { task: Task }) {
  const [open, setOpen] = useState(task.status === 'needs_confirmation');
  const [advice, setAdvice] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = supabaseBrowser();
  const chip = subStatusChip[task.status] ?? subStatusChip.queued;
  const expandable = Boolean(task.confirmation_prompt || task.agent_note || (task.agent_steps?.length ?? 0) > 0);

  async function approve() {
    setBusy(true);
    await approveTask(task, advice);
    setBusy(false);
  }
  async function skip() {
    setBusy(true);
    await supabase.from('tasks').update({ status: 'skipped', agent_note: 'Skipped by user.' }).eq('id', task.id);
    setBusy(false);
  }

  return (
    <div className="bg-bg border border-border rounded-lg p-2.5 animate-fade-in">
      <button onClick={() => expandable && setOpen(o => !o)}
        className={`w-full flex items-center gap-2 text-left ${expandable ? '' : 'cursor-default'}`}>
        {expandable && (
          <span className={`text-muted text-[9px] shrink-0 inline-block transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        )}
        <span className="text-xs font-medium flex-1 min-w-0 break-words">{task.title}</span>
        <span className={`shrink-0 text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${chip.cls}`}>
          {chip.label}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 animate-fade-in">
          {task.confirmation_prompt && (
            <div className="text-[11px] text-text bg-panel border border-border rounded-lg p-2.5">
              <LinkifyText text={task.confirmation_prompt} />
            </div>
          )}
          {task.agent_note && (
            <div className="text-[11px] text-muted bg-panel border border-border rounded-lg p-2.5">
              <LinkifyText text={task.agent_note} />
            </div>
          )}
          {task.agent_steps && task.agent_steps.length > 0 && <StepsList steps={task.agent_steps} />}

          {task.status === 'needs_confirmation' && (
            <div>
              <GuidanceBox advice={advice} setAdvice={setAdvice} />
              <div className="flex gap-2">
                <button disabled={busy} onClick={approve}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  Approve
                </button>
                <button disabled={busy} onClick={skip}
                  className="flex-1 bg-panel border border-border hover:border-muted rounded-lg py-1.5 text-xs disabled:opacity-50 transition-colors">
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
