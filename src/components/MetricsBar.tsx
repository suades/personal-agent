'use client';
import type { Task, AgentRun } from '@/lib/types';

export default function MetricsBar({ tasks, lastRun }: { tasks: Task[]; lastRun: AgentRun | null }) {
  const completedThisWeek = tasks.filter(t => {
    if (!t.completed_at) return false;
    const d = new Date(t.completed_at);
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const minutesSaved = completedThisWeek * 5;

  const runStatus = !lastRun
    ? 'No runs yet'
    : `Last run: ${new Date(lastRun.started_at).toLocaleString()} ${lastRun.success ? '✓' : '⚠'}`;

  return (
    <div className="flex items-center justify-between text-[11px] text-muted bg-panel border border-border rounded-xl px-3 py-2 mb-3">
      <span>{runStatus}</span>
      <span>{completedThisWeek} done · ~{minutesSaved}m saved this week</span>
    </div>
  );
}
