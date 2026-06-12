'use client';
import { useState } from 'react';
import type { AgentStep } from '@/lib/types';

function toolIcon(action: string): string {
  if (action.startsWith('search.')) return '🔍';
  if (action.startsWith('browser.')) return '🌐';
  if (action.startsWith('gmail.')) return '📧';
  if (action.startsWith('calendar.')) return '📅';
  if (action.startsWith('files.')) return '📁';
  if (action === 'agent.replan') return '🔄';
  return '⚙️';
}

export default function StepsList({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);
  const screenshots = steps.filter(s => s.screenshot_url);

  return (
    <div className="text-xs space-y-2">
      {screenshots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {screenshots.map((s, i) => (
            <a key={i} href={s.screenshot_url} target="_blank" rel="noreferrer"
              className="shrink-0 group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.screenshot_url} alt={`Screenshot after ${s.action}`}
                className="h-20 w-32 object-cover object-top rounded-lg border border-border group-hover:border-accent transition-colors" />
              <span className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white px-1 rounded">
                {s.action.replace('browser.', '')}
              </span>
            </a>
          ))}
        </div>
      )}

      <button onClick={() => setOpen(!open)}
        className="text-muted hover:text-text flex items-center gap-1.5 transition-colors">
        <span className={`inline-block transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        Execution log ({steps.length} steps)
      </button>

      {open && (
        <ol className="space-y-2.5 animate-fade-in">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 mt-0.5">{toolIcon(s.action)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-mono ${s.ok ? 'text-text' : 'text-red-400'}`}>{s.action}</span>
                  {s.recovered && (
                    <span className="text-[9px] uppercase tracking-wide font-bold bg-accent-soft text-accent px-1.5 py-0.5 rounded">
                      self-healed
                    </span>
                  )}
                </div>
                {s.note && <div className="text-[11px] text-muted mt-0.5">{s.note}</div>}
                {s.args && Object.keys(s.args).length > 0 && (
                  <div className="text-[10px] text-muted/80 mt-0.5 font-mono break-all">
                    {JSON.stringify(s.args)}
                  </div>
                )}
                {s.output_snippet && (
                  <div className="text-[10px] text-green-500/80 mt-0.5 whitespace-pre-wrap break-all line-clamp-3">
                    {s.output_snippet}
                  </div>
                )}
                {s.error && (
                  <div className="text-[10px] text-red-400 mt-0.5 break-all">
                    {s.error}
                  </div>
                )}
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer"
                    className="block text-blue-400 hover:underline truncate mt-0.5 text-[11px]">
                    {s.url}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
