'use client';
import type { Task, AgentRun } from '@/lib/types';

export default function MetricsBar({ tasks, lastRun }: { tasks: Task[]; lastRun: AgentRun | null }) {
  const completedThisWeek = tasks.filter(t => {
    if (!t.completed_at) return false;
    const d = new Date(t.completed_at);
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const minutesSaved = completedThisWeek * 5;

  const running = lastRun?.status === 'running';
  const runStatus = !lastRun
    ? 'No runs yet'
    : running
      ? 'Agent running now'
      : `Last run ${new Date(lastRun.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ${lastRun.success ? '✓' : '⚠'}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-muted bg-panel border border-border rounded-xl px-3 py-2 mb-3">
      <span className="truncate flex items-center gap-1.5">
        {running && <span className="live-dot shrink-0" />}
        {runStatus}
      </span>
      <span className="shrink-0 flex items-center gap-2">
        <span>{completedThisWeek} done · ~{minutesSaved}m saved this week</span>
        <a href="/analytics" className="text-accent hover:underline" title="LLM usage analytics">📊</a>
      </span>
    </div>
  );
}
