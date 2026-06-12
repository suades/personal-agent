'use client';
import { useEffect, useRef, useState } from 'react';
import type { AgentRun, LiveLogEntry } from '@/lib/types';

const typeStyle: Record<LiveLogEntry['type'], { icon: string; cls: string }> = {
  planning:  { icon: '🧠', cls: 'text-accent' },
  tool_call: { icon: '⚙️', cls: 'text-muted' },
  result:    { icon: '✓',  cls: 'text-low' },
  error:     { icon: '✗',  cls: 'text-high' },
  info:      { icon: '·',  cls: 'text-muted' },
};

/**
 * Real-time agent activity feed (Feature 1). Shown while agent_runs.status is
 * 'running' — entries stream in via the existing Supabase realtime subscription.
 */
export default function AgentLiveView({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const log = run.live_log ?? [];

  useEffect(() => {
    // keep the newest entry in view
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [log.length]);

  const latest = log[log.length - 1];

  return (
    <div className="bg-panel border border-low/30 rounded-xl mb-3 overflow-hidden animate-fade-in-up">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left">
        <span className="live-dot shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-low">Agent is working…</p>
          {!expanded && latest && (
            <p className="text-[11px] text-muted truncate">{latest.message}</p>
          )}
        </div>
        <span className={`text-muted text-xs transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {expanded && (
        <div ref={feedRef} className="max-h-56 overflow-y-auto px-3 pb-3 space-y-1.5">
          {log.slice(-60).map((e, i) => {
            const s = typeStyle[e.type] ?? typeStyle.info;
            return (
              <div key={`${e.ts}-${i}`} className="flex gap-2 text-[11px] leading-relaxed animate-fade-in">
                <span className={`shrink-0 w-4 text-center ${s.cls}`}>{s.icon}</span>
                <span className="text-muted tabular-nums shrink-0">
                  {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`min-w-0 break-words ${e.type === 'error' ? 'text-high' : 'text-text/90'}`}>
                  {e.message}
                </span>
              </div>
            );
          })}
          {log.length === 0 && <p className="text-[11px] text-muted">Waiting for the first update…</p>}
        </div>
      )}
    </div>
  );
}
